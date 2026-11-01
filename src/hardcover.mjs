// Hardcover GraphQL client: throttled to the free tier (60/min) and cached on disk,
// so re-running the report costs no API calls for books already looked up.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";

const URL_API = "https://api.hardcover.app/v1/graphql";
const CACHE = new URL("../data/hc-cache/", import.meta.url);
const MIN_GAP_MS = 1100;

let token;
let lastCall = 0;

async function getToken() {
  if (!token) {
    const raw = process.env.HARDCOVER_TOKEN ??
      (await readFile(new URL("../hardcover-key.txt", import.meta.url), "utf8"));
    token = raw.trim().replace(/^Bearer\s+/i, "");
  }
  return token;
}

// maxAgeDays: catalog lookups go stale (new releases); search matches don't.
export async function hc(query, variables = {}, { cache = true, maxAgeDays = Infinity } = {}) {
  const key = createHash("sha1").update(query + JSON.stringify(variables)).digest("hex");
  const file = new URL(`${key}.json`, CACHE);
  if (cache) {
    try {
      const age = (Date.now() - (await stat(file)).mtimeMs) / 86_400_000;
      if (age < maxAgeDays) return JSON.parse(await readFile(file, "utf8"));
    } catch {}
  }

  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    let res;
    try {
      res = await fetch(URL_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await getToken()}`,
          "User-Agent": "book-recs/0.1 (personal script)",
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      last = `network error: ${err.message}`; // a blip shouldn't kill a 6-minute build
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (res.status === 429) {
      last = "rate limited";
      await sleep(Number(res.headers.get("retry-after") ?? 10) * 1000);
      continue;
    }
    if (res.status >= 500) {
      last = `HTTP ${res.status}`;
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Hardcover ${res.status}: check hardcover-key.txt`);
    }
    const body = await res.json();
    if (body.errors) throw new Error(`Hardcover: ${JSON.stringify(body.errors)}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, JSON.stringify(body.data));
    return body.data;
  }
  throw new Error(`Hardcover: gave up after 5 tries (${last})`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
