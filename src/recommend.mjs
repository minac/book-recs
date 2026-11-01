// Turns the Readwise library + Hardcover matches into book cards: the next unread book in
// each series you loved, and other books by authors you loved. Each card gets a confidence
// score from a model trained on your own ratings.
import { readFileSync } from "node:fs";
import { hc } from "./hardcover.mjs";
import { fold, mainTitle, cleanTitle, firstAuthor, lastName } from "./match.mjs";
import { features, train, evaluate, strength, LOVED } from "./model.mjs";

const MIN_CONFIDENCE = 50; // %; below this the model leans towards "you won't love it"
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

// Hardcover has junk dates like "0030-01-01". An implausible year means "unknown", and an
// unknown date doesn't count as released.
const saneYear = (y) => y >= 1450 && y <= 2100;
function released(b) {
  if (b.release_date && saneYear(Number(b.release_date.slice(0, 4)))) return b.release_date <= today;
  return saneYear(b.release_year) && b.release_year < Number(today.slice(0, 4));
}
// 1 = book, 2 = novella. Short stories (3) and the rest are noise here, and so are
// companion workbooks ("The Atomic Habits Workbook"), which Hardcover files as books.
const COMPANION = /\b(workbooks?|journals?|planners?|notebooks?|study guides?|coloring books?)\b/i;
// Hardcover book ids to never suggest, for catalog errors no rule can catch.
const SKIP = new Set(JSON.parse(readFileSync(new URL("../skip.json", import.meta.url), "utf8")).map((s) => s.id));
const isBook = (b) => (b.book_category_id == null || b.book_category_id <= 2) && !COMPANION.test(b.title) && !SKIP.has(b.id);
// Whole positions only: half positions (#1.5) are short stories, comic adaptations and
// story collections, even when Hardcover files them as books.
const countsAsEntry = (pos) => Number.isInteger(pos) && pos >= 1;

// Labels come from the evidence, not the score: on real data the score barely moves
// (most cards land within a few points), while "4 of your 5 books by her were 5★" vs
// "one book" is the difference a reader can act on.
export const LABELS = ["Strong match", "Promising", "Limited evidence"];
function label({ books, loved }) {
  if (books <= 1) return "Limited evidence";
  return loved / books >= 0.75 ? "Strong match" : "Promising";
}

const lastNames = (b) => new Set([firstAuthor(b.author), ...(b.hc?.author_names ?? [])].map(lastName).filter(Boolean));

export async function recommend(library, matches) {
  const lib = library.filter((b) => b.status !== "deleted").map((b) => ({ ...b, hc: matches[b.id] ?? null }));
  const read = lib.filter((b) => ["finished", "currently_reading", "did_not_finish"].includes(b.status));
  const shelf = lib.filter((b) => ["unsorted", "want_to_read"].includes(b.status));
  const liked = read.filter((b) => b.status === "finished" && b.rating === LOVED && b.hc);

  // Hardcover has duplicate book rows, so compare ids both ways through canonical_id, then
  // fall back to the full title plus an author's last name. Not the main title alone:
  // "Hitchhiker's Guide to the Galaxy: Mostly Harmless" exists. Not the title without an
  // author: Robinson's "Home" isn't Morrison's.
  function index(books) {
    const ids = new Set(books.flatMap((b) => [b.hc?.id, b.hc?.canonical_id]).filter(Boolean));
    const titles = new Set(books.flatMap((b) => [...lastNames(b)].map((ln) => `${fold(cleanTitle(b.title))}|${ln}`)));
    return (b, authors) =>
      ids.has(b.id) || ids.has(b.canonical_id) || authors.some((a) => titles.has(`${fold(cleanTitle(b.title))}|${lastName(a)}`));
  }
  const isRead = index(read);
  const onShelf = index(shelf);

  // ---- your ratings, for the confidence model ----
  const rated = read.filter((b) => b.status === "finished" && b.rating && b.hc);
  const ratingsByAuthor = (ids, pool, except) =>
    pool.filter((b) => b !== except && b.hc.author_ids.some((id) => ids.includes(id))).map((b) => b.rating);
  const ratingsBySeries = (name, pool, except) =>
    pool.filter((b) => b !== except && b.hc.featured && fold(b.hc.featured.name) === fold(name)).map((b) => b.rating);
  const toRow = (b, pool) => ({
    x: features({
      author: ratingsByAuthor(b.hc.author_ids, pool, b),
      series: b.hc.featured ? ratingsBySeries(b.hc.featured.name, pool, b) : [],
    }),
    y: b.rating === LOVED ? 1 : 0,
  });
  const predict = train(rated.map((b) => toRow(b, rated)));
  const quality = evaluate(rated, toRow);
  // evidence: your ratings the card rests on (the series' books for a series card, the
  // author's for an author card). Cards sort by its strength, which grows with every loved
  // book; the model's mean-based score can't tell 1 of 1 loved from 4 of 4.
  const score = (evidenceRatings, author, series) => {
    const confidence = Math.round(100 * predict(features({ author, series })));
    const books = evidenceRatings.length;
    const loved = evidenceRatings.filter((r) => r === LOVED).length;
    const evidence = { books, loved };
    return { confidence, strength: strength(loved, books, quality.baseRate), evidence, label: label(evidence) };
  };

  // ---- series: only the next book ----
  const seriesRead = new Map(); // featured series id -> your read books in it
  const started = new Set(); // every series you've read in, by id and by name
  for (const b of read) {
    for (const s of b.hc?.series ?? []) started.add(s.id).add(fold(s.name));
    const f = b.hc?.featured;
    if (!f) continue;
    if (!seriesRead.has(f.id)) seriesRead.set(f.id, []);
    seriesRead.get(f.id).push(b);
  }
  const likedSeriesIds = [...new Set(liked.map((b) => b.hc.featured?.id).filter(Boolean))];

  const seriesData = [];
  for (const ids of chunks(likedSeriesIds, 10)) {
    seriesData.push(...(await hc(SERIES_Q, { ids }, { maxAgeDays: CATALOG_DAYS })).series);
  }

  // Pass 1: where your books sit in each series. A position read in one copy of a series
  // counts as read in a same-named duplicate (The Phoenix Project).
  const readByName = new Set();
  const positionOf = new Map(); // `${series id}:${book key}` -> position
  for (const s of seriesData) {
    const authors = (seriesRead.get(s.id) ?? []).flatMap((b) => b.hc.author_names);
    for (const bs of s.book_series) {
      if (bs.position == null || !isRead(bs.book, authors)) continue;
      readByName.add(`${fold(s.name)}#${bs.position}`);
      positionOf.set(`${s.id}:${bs.book.canonical_id ?? bs.book.id}`, bs.position);
    }
  }

  const cards = [];
  const shownIds = new Set();
  for (const s of seriesData) {
    const mine = seriesRead.get(s.id) ?? [];
    const authors = [...new Set(mine.flatMap((b) => b.hc.author_names))];
    const readPositions = new Set();
    const byPosition = new Map(); // first canonical row per position is the most-read (query order)
    for (const bs of s.book_series) {
      if (bs.position == null) continue;
      // Any row at a position counts as read: translations and duplicates share positions.
      if (readByName.has(`${fold(s.name)}#${bs.position}`)) readPositions.add(bs.position);
      if (!countsAsEntry(bs.position) || bs.book.canonical_id) continue;
      if (!byPosition.has(bs.position)) byPosition.set(bs.position, bs.book);
    }
    const furthest = Math.max(0, ...readPositions);
    const unread = [...byPosition]
      .filter(([pos, book]) => !readPositions.has(pos) && !isRead(book, authors) && released(book) && isBook(book))
      .sort((a, b) => a[0] - b[0]);
    for (const [, book] of unread) shownIds.add(book.id); // keeps the author section from offering them
    // The next book is the first one after where you stopped; if you're past the end,
    // the first one you skipped.
    const [position, book] = unread.find(([pos]) => pos > furthest) ?? unread[0] ?? [];
    if (!book) continue;
    const pos = (b) => positionOf.get(`${s.id}:${b.hc.canonical_id ?? b.hc.id}`) ?? null;
    const myRatings = mine.filter((b) => b.rating && b.status === "finished");
    const authorIds = [...new Set(mine.flatMap((b) => b.hc.author_ids))];
    cards.push({
      kind: "series", ...book, position, skipped: position < furthest, onShelf: onShelf(book, authors),
      seriesName: s.name,
      authorName: authors[0] ?? "",
      because: myRatings.map((b) => ({ title: b.hc.title, rating: b.rating, position: pos(b) }))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      ...score(myRatings.map((b) => b.rating), ratingsByAuthor(authorIds, rated), myRatings.map((b) => b.rating)),
    });
  }

  // ---- authors ----
  const authorLikes = new Map(); // author id -> liked library books
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
      if (shownIds.has(b.id) || isRead(b, [a.name]) || !released(b) || !isBook(b)) continue;
      if ((b.users_count ?? 0) < AUTHOR_MIN_READERS) continue;
      // From another series, only suggest the entry point, and only if you haven't started it.
      const fs = b.featured_book_series;
      if (fs?.series && (started.has(fs.series.id) || started.has(fold(fs.series.name)) ||
        (fs.position != null && fs.position !== 1))) continue;
      shownIds.add(b.id);
      cards.push({
        kind: "author", ...b, onShelf: onShelf(b, [a.name]),
        seriesName: fs?.series ? fs.series.name : null,
        authorName: a.name,
        because: authorLikes.get(a.id).map((x) => ({ title: x.hc.title, rating: x.rating })),
        ...score(ratingsByAuthor([a.id], rated), ratingsByAuthor([a.id], rated), []),
      });
      if (++picks === AUTHOR_PICKS) break;
    }
  }
  cards.sort((a, b) => LABELS.indexOf(a.label) - LABELS.indexOf(b.label) ||
    b.strength - a.strength || b.confidence - a.confidence || (b.rating ?? 0) - (a.rating ?? 0));
  // An author pick resting on one book is noise next to the stronger ones. A series pick
  // stays even then: it's the sequel to a book you rated 5★, which is the point of the page.
  const thin = (c) => c.kind === "author" && c.label === "Limited evidence";
  const likely = cards.filter((c) => c.confidence >= MIN_CONFIDENCE);
  const shown = likely.filter((c) => !thin(c));

  const unmatched = lib.filter((b) => !b.hc && b.status === "finished").map((b) => ({ title: mainTitle(b.title), author: b.author }));
  return {
    cards: shown, unmatched, quality,
    stats: { read: read.length, liked: liked.length, loved: LOVED,
      belowConfidence: cards.length - likely.length, thinAuthorPicks: likely.length - shown.length },
  };
}
