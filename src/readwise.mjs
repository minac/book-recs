// Pulls the whole Readwise Books library (all shelves, with your ratings).
const BASE = "https://readwise.io/books/api/v1/books";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchReadwise(token, pageSize = 1000) {
  const books = [];
  let url = `${BASE}?limit=${pageSize}`;
  let failures = 0;
  while (url) {
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    } catch (err) {
      if (++failures > 4) throw new Error(`Readwise: network error: ${err.message}`);
      await sleep(2 ** failures * 1000);
      continue;
    }
    if (res.status === 429) {
      await sleep(Number(res.headers.get("retry-after") ?? 5) * 1000);
      continue;
    }
    if (res.status >= 500 && ++failures <= 4) {
      await sleep(2 ** failures * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Readwise ${res.status}: ${await res.text()}`);
    const page = await res.json();
    books.push(...page.results);
    url = page.next; // a full URL with the cursor, or null on the last page
    failures = 0;
  }
  return books;
}
