// Entry point: Readwise (+ optional Audible) library -> Hardcover matches -> recommendations -> out/index.html.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fetchReadwise } from "./readwise.mjs";
import { loadAudible, mergeLibraries } from "./audible.mjs";
import { matchBook, addCanonicalIds } from "./match.mjs";
import { recommend } from "./recommend.mjs";
import { render } from "./render.mjs";

const at = (p) => new URL(`../${p}`, import.meta.url);
await mkdir(at("data/"), { recursive: true });
await mkdir(at("out/"), { recursive: true });

const token = (await readFile(at("api-key.txt"), "utf8")).trim();
const library = await fetchReadwise(token);
await writeFile(at("data/readwise.json"), JSON.stringify(library, null, 1));
console.log(`readwise: ${library.length} books`);

// Optional: Audible has no API, see scripts/audible-export.js.
const audible = await loadAudible(at("data/audible.json"));
if (audible.length) console.log(`audible: ${audible.length} books`);

// Search results are cached, so only new books cost Hardcover calls.
const matches = {};
const books = [...library, ...audible].filter((b) => b.status !== "deleted");
for (const [i, b] of books.entries()) {
  matches[b.id] = await matchBook(b);
  if ((i + 1) % 50 === 0) console.log(`matching ${i + 1}/${books.length}`);
}
await addCanonicalIds(matches);
await writeFile(at("data/matches.json"), JSON.stringify(matches, null, 1));
console.log(`hardcover: matched ${Object.values(matches).filter(Boolean).length}/${books.length}`);

const recs = await recommend(mergeLibraries(library, audible, matches), matches);
const stamp = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });
await writeFile(at("out/index.html"), render(recs, stamp));
const q = recs.quality;
console.log(`model: AUC ${q.auc == null ? "n/a" : q.auc.toFixed(2)} on ${q.n} rated books (loved rate ${Math.round(q.baseRate * 100)}%)`);
console.log(`wrote out/index.html: ${recs.cards.length} books`);
