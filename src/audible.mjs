// Turns data/audible.json (exported from the Audible library page, which has no API)
// into library records shaped like Readwise's, so the rest of the pipeline treats them alike.
import { readFile } from "node:fs/promises";

const DNF_AFTER_DAYS = 183; // unfinished and added over 6 months ago = did not finish

// export: { dnfFrom?, books: [{ asin, title, by, series, progress, added }] }, newest first.
// progress is "Finished", "3h 2m left" (started), "8h 59m" (not started) or null.
// dnfFrom names a title: it and every older unfinished title count as DNF, which
// covers titles with no purchase date (Audible Plus, gifts).
export async function loadAudible(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return []; // no export: Audible is optional
    throw err;
  }
  // A broken export must fail loudly: silently dropping it would bring finished
  // audiobooks back as recommendations.
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`data/audible.json is not valid JSON (${err.message}); re-run scripts/audible-export.js`);
  }
  const cutoff = data.dnfFrom ? data.books.findIndex((b) => b.title === data.dnfFrom) : -1;
  const oldEnough = (added) => added && (Date.now() - Date.parse(added)) / 86_400_000 > DNF_AFTER_DAYS;

  return data.books.map((b, i) => {
    let status;
    if (b.progress === "Finished") status = "finished";
    else if ((cutoff >= 0 && i >= cutoff) || oldEnough(b.added)) status = "did_not_finish";
    else if (b.progress?.endsWith("left")) status = "currently_reading";
    else status = "unsorted";
    return { id: `audible:${b.asin}`, title: b.title, author: b.by, status, rating: null, product: null, source: "audible" };
  });
}

// Readwise wins on ratings; otherwise keep whichever status says you got further.
const RANK = { unsorted: 0, want_to_read: 0, currently_reading: 1, did_not_finish: 2, finished: 3 };

// Two copies are the same book when they resolve to the same main Hardcover row.
const bookKey = (m) => m && (m.canonical_id ?? m.id);

export function mergeLibraries(readwise, audible, matches) {
  const byHc = new Map(readwise.filter((b) => matches[b.id]).map((b) => [bookKey(matches[b.id]), b]));
  const merged = readwise.map((b) => ({ ...b }));
  const index = new Map(merged.map((b) => [b.id, b]));
  for (const a of audible) {
    const twin = matches[a.id] && byHc.get(bookKey(matches[a.id]));
    if (!twin) { merged.push(a); continue; }
    const mine = index.get(twin.id);
    if (RANK[a.status] > (RANK[mine.status] ?? 0)) mine.status = a.status;
  }
  return merged;
}
