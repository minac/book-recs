// Turns the Readwise library + Hardcover matches into book cards: the next unread book in
// each series you loved, and other books by authors you loved. Each card gets a confidence
// score from a model trained on your own ratings.
import { hc } from "./hardcover.mjs";
import { fold, mainTitle, cleanTitle } from "./match.mjs";
import { features, train, evaluate, LOVE_MIN } from "./model.mjs";

export const LIKE_MIN = 4.5;
export const COMMUNITY_MIN = 4.0; // Hardcover's average rating; Goodreads has no public API
export const COMMUNITY_MIN_RATINGS = 50; // below this, a handful of fans sets the average
const communityOk = (b) => (b.rating ?? 0) >= COMMUNITY_MIN && (b.ratings_count ?? 0) >= COMMUNITY_MIN_RATINGS;
const AUTHOR_MIN_READERS = 25; // hides workbooks, summaries and other catalog noise
const AUTHOR_PICKS = 3;
const CATALOG_DAYS = 7;

const BOOK = `id title slug release_date release_year users_count rating ratings_count book_category_id compilation image { url }`;

// Duplicates (canonical_id set) are fetched too: your read copy may be one of them.
const SERIES_Q = `query($ids:[Int!]){ series(where:{id:{_in:$ids}}){ id name
  book_series(where:{compilation:{_eq:false}}, order_by:[{position:asc},{book:{users_count:desc}}]){
    position book { ${BOOK} canonical_id } } } }`;

const AUTHORS_Q = `query($ids:[Int!]){ authors(where:{id:{_in:$ids}}){ id name
  contributions(where:{contributable_type:{_eq:"Book"}, book:{canonical_id:{_is_null:true}, compilation:{_eq:false}}}, order_by:{book:{users_count:desc}}, limit:30){
    contribution book { ${BOOK} featured_book_series { position series { id name } } } } } }`;

const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const today = new Date().toISOString().slice(0, 10);

function released(b) {
  if (b.release_date) return b.release_date <= today;
  return b.release_year != null && b.release_year < Number(today.slice(0, 4));
}
// 1 = book, 2 = novella. Short stories (3) and the rest are noise here.
const isBook = (b) => b.book_category_id == null || b.book_category_id <= 2;

export async function recommend(readwise, matches) {
  const lib = readwise.filter((b) => b.status !== "deleted").map((b) => ({ ...b, hc: matches[b.id] ?? null }));
  const read = lib.filter((b) => ["finished", "currently_reading", "did_not_finish"].includes(b.status));
  const shelf = lib.filter((b) => ["unsorted", "want_to_read"].includes(b.status));
  const liked = read.filter((b) => b.status === "finished" && (b.rating ?? 0) >= LIKE_MIN && b.hc);

  const readIds = new Set(read.map((b) => b.hc?.id).filter(Boolean));
  const shelfIds = new Set(shelf.map((b) => b.hc?.id).filter(Boolean));
  // Hardcover has duplicate book rows, so also follow canonical_id and compare full
  // titles. Not main titles: "Hitchhiker's Guide to the Galaxy: Mostly Harmless" exists.
  const readTitles = new Set(read.map((b) => fold(cleanTitle(b.title))));
  const shelfTitles = new Set(shelf.map((b) => fold(cleanTitle(b.title))));
  const known = (ids, titles) => (b) =>
    ids.has(b.id) || ids.has(b.canonical_id) || titles.has(fold(cleanTitle(b.title)));
  const isRead = known(readIds, readTitles);
  const onShelf = known(shelfIds, shelfTitles);

  // ---- your ratings, for the confidence model ----
  const rated = read.filter((b) => b.status === "finished" && b.rating && b.hc);
  const ratingsByAuthor = (ids, except) =>
    rated.filter((b) => b !== except && b.hc.author_ids.some((id) => ids.includes(id))).map((b) => b.rating);
  const ratingsBySeries = (name, except) =>
    rated.filter((b) => b !== except && b.hc.series && fold(b.hc.series.name) === fold(name)).map((b) => b.rating);

  const rows = rated.map((b) => ({
    x: features({
      community: b.hc.rating, ratingsCount: b.hc.ratings_count,
      author: ratingsByAuthor(b.hc.author_ids, b),
      series: b.hc.series ? ratingsBySeries(b.hc.series.name, b) : [],
    }),
    y: b.rating >= LOVE_MIN ? 1 : 0,
  }));
  const predict = train(rows);
  const quality = evaluate(rows);
  const confidence = (book, author, series) =>
    Math.round(100 * predict(features({ community: book.rating, ratingsCount: book.ratings_count, author, series })));

  // ---- series: only the next book ----
  const seriesRead = new Map(); // series id -> your read books in it
  // Hardcover can hold one series twice under the same name (The Phoenix Project).
  const readByName = new Set();
  for (const b of read) {
    const s = b.hc?.series;
    if (!s) continue;
    readByName.add(`${fold(s.name)}#${s.position}`);
    if (!seriesRead.has(s.id)) seriesRead.set(s.id, []);
    seriesRead.get(s.id).push(b);
  }
  const likedSeriesIds = [...new Set(liked.map((b) => b.hc.series?.id).filter(Boolean))];

  const seriesData = [];
  for (const ids of chunks(likedSeriesIds, 10)) {
    seriesData.push(...(await hc(SERIES_Q, { ids }, { maxAgeDays: CATALOG_DAYS })).series);
  }

  const cards = [];
  const shownIds = new Set();
  let hidden = 0;
  for (const s of seriesData) {
    const mine = seriesRead.get(s.id) ?? [];
    const readPositions = new Set(mine.map((b) => b.hc.series.position));
    const byPosition = new Map(); // first canonical row per position is the most-read (query order)
    for (const bs of s.book_series) {
      if (bs.position == null) continue;
      // Any row at a position counts as read: translations and duplicates share positions.
      if (isRead(bs.book) || readByName.has(`${fold(s.name)}#${bs.position}`)) readPositions.add(bs.position);
      if (!Number.isInteger(bs.position) || bs.position < 1 || bs.book.canonical_id) continue;
      if (!byPosition.has(bs.position)) byPosition.set(bs.position, bs.book);
    }
    const furthest = Math.max(0, ...readPositions);
    const unread = [...byPosition]
      .filter(([pos, book]) => !readPositions.has(pos) && !isRead(book) && released(book) && isBook(book))
      .sort((a, b) => a[0] - b[0]);
    for (const [, book] of unread) shownIds.add(book.id); // keeps the author section from offering them
    // The next book is the first one after where you stopped; if you're past the end,
    // the first one you skipped. If it fails the community bar, don't jump over it.
    const [position, book] = unread.find(([pos]) => pos > furthest) ?? unread[0] ?? [];
    if (!book) continue;
    if (!communityOk(book)) { hidden++; continue; }
    const myRatings = mine.filter((b) => b.rating && b.status === "finished");
    const authorIds = [...new Set(mine.flatMap((b) => b.hc.author_ids))];
    cards.push({
      kind: "series", ...book, position, skipped: position < furthest, onShelf: onShelf(book),
      seriesName: s.name,
      authorName: mine[0]?.hc.author_names[0] ?? "",
      because: myRatings.sort((a, b) => a.hc.series.position - b.hc.series.position)
        .map((b) => ({ title: b.hc.title, rating: b.rating, position: b.hc.series.position })),
      confidence: confidence(book, ratingsByAuthor(authorIds), myRatings.map((b) => b.rating)),
    });
  }

  // ---- authors ----
  const authorLikes = new Map(); // author id -> liked readwise books
  for (const b of liked) {
    for (const id of b.hc.author_ids) {
      if (!authorLikes.has(id)) authorLikes.set(id, []);
      authorLikes.get(id).push(b);
    }
  }
  const authorData = [];
  for (const ids of chunks([...authorLikes.keys()], 10)) {
    authorData.push(...(await hc(AUTHORS_Q, { ids }, { maxAgeDays: CATALOG_DAYS })).authors);
  }

  for (const a of authorData) {
    const seen = new Set();
    let picks = 0;
    for (const c of a.contributions) {
      const b = c.book;
      if (c.contribution && c.contribution !== "Author") continue;
      if (seen.has(fold(mainTitle(b.title)))) continue;
      seen.add(fold(mainTitle(b.title)));
      // shownIds also stops a co-written book from showing once per co-author.
      if (shownIds.has(b.id) || isRead(b) || !released(b) || !isBook(b)) continue;
      if ((b.users_count ?? 0) < AUTHOR_MIN_READERS || !communityOk(b)) continue;
      // From another series, only suggest the entry point, and only if you haven't started it.
      const fs = b.featured_book_series;
      if (fs?.series && (seriesRead.has(fs.series.id) || (fs.position != null && fs.position !== 1))) continue;
      shownIds.add(b.id);
      cards.push({
        kind: "author", ...b, onShelf: onShelf(b),
        seriesName: fs?.series ? fs.series.name : null,
        authorName: a.name,
        because: authorLikes.get(a.id).map((x) => ({ title: x.hc.title, rating: x.rating })),
        confidence: confidence(b, ratingsByAuthor([a.id]), []),
      });
      if (++picks === AUTHOR_PICKS) break;
    }
  }
  cards.sort((a, b) => b.confidence - a.confidence || (b.rating ?? 0) - (a.rating ?? 0));

  const unmatched = lib.filter((b) => !b.hc && b.status === "finished").map((b) => ({ title: mainTitle(b.title), author: b.author }));
  return {
    cards, hidden, unmatched, quality,
    stats: { read: read.length, liked: liked.length, likeMin: LIKE_MIN, loveMin: LOVE_MIN,
      communityMin: COMMUNITY_MIN, communityMinRatings: COMMUNITY_MIN_RATINGS },
  };
}
