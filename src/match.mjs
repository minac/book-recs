// Matches each Readwise book to a Hardcover book via search (title + first author),
// accepting a hit only when the author's last name and the title agree.
import { hc } from "./hardcover.mjs";

const SEARCH = `query($q:String!){ search(query:$q, query_type:"Book", per_page:5){ results } }`;

export const fold = (s) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    // Keep every script's letters: dropping non-Latin ones turns a Greek "Dune: Ο Μεσσίας" into "dune".
    .replace(/&/g, "and").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

// Drops a trailing "(The Murderbot Diaries, #5)".
export const cleanTitle = (t) =>
  (t ?? "").replace(/\s+/g, " ").replace(/\s*[([][^)\]]*[)\]]\s*$/, "").trim();
// Also drops the subtitle, which often differs between editions.
export const mainTitle = (t) => cleanTitle(t).split(/:| - /)[0].trim();

// Readwise mixes "Wells, Martha" with "Martha Wells" and "A, B" author lists.
export function firstAuthor(a) {
  if (!a) return "";
  const parts = a.split(",").map((s) => s.trim());
  if (parts.length === 2 && !parts[0].includes(" ")) return `${parts[1]} ${parts[0]}`;
  return parts[0].split(/ and | & /)[0].trim();
}

const lastName = (name) => fold(name).split(" ").filter((w) => w.length > 1).pop() ?? "";

// Higher is better, 0 = reject. Alternative titles rank low: God Emperor of Dune lists
// "Dune" as one. Short titles need an exact match, or "Dune" would match "Dune Messiah".
function score(hit, full, author, isbn) {
  if (isbn && hit.isbns?.includes(isbn)) return 5;
  const ln = lastName(author);
  const authorOk = (hit.author_names ?? []).some((n) => fold(n).split(" ").includes(ln));
  if (!authorOk) return 0;
  const wantFull = fold(cleanTitle(full));
  const wantMain = fold(mainTitle(full));
  if (fold(cleanTitle(hit.title)) === wantFull) return 4;
  if (fold(mainTitle(hit.title)) === wantMain) return 3;
  const alts = (hit.alternative_titles ?? []).map((t) => fold(mainTitle(t)));
  if (alts.includes(wantMain)) return 2;
  const long = wantMain.split(" ").length >= 3;
  const titles = [fold(mainTitle(hit.title)), ...alts].filter(Boolean);
  return long && titles.some((got) => got.startsWith(wantMain) || wantMain.startsWith(got)) ? 1 : 0;
}

function slim(d) {
  return {
    id: Number(d.id),
    title: d.title,
    rating: d.rating ?? null,
    ratings_count: d.ratings_count ?? 0,
    author_ids: (d.contributions ?? [])
      .filter((c) => !c.contribution || c.contribution === "Author")
      .map((c) => c.author?.id).filter(Boolean),
    author_names: d.author_names ?? [],
    series: d.featured_series?.series
      ? { id: d.featured_series.series.id, name: d.featured_series.series.name, position: d.featured_series.position }
      : null,
  };
}

export async function matchBook(rw) {
  const full = rw.product?.title ?? rw.title;
  const author = firstAuthor(rw.product?.author ?? rw.author);
  const isbn = rw.product?.isbn ?? null;
  // With the author in the query, "Summary of <title> by <author>" knock-offs can
  // crowd out the real book, so the last try is the title alone.
  const queries = [...new Set([`${cleanTitle(full)} ${author}`, `${mainTitle(full)} ${author}`, mainTitle(full)])];
  let best = null;
  for (const q of queries) {
    const data = await hc(SEARCH, { q: q.trim() });
    const hits = (data.search?.results?.hits ?? []).map((h) => h.document);
    for (const h of hits) {
      const s = score(h, full, author, isbn);
      // Within a score, the real book beats an omnibus with its title.
      if (s && (!best || s > best.s || (s === best.s && best.h.compilation && !h.compilation))) best = { h, s };
    }
    if (best?.s >= 3) break;
  }
  return best ? slim(best.h) : null;
}
