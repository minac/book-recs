// Pulls the whole Readwise Books library (all shelves, with your ratings).
const BASE = "https://readwise.io/books/api/v1/books";

export async function fetchReadwise(token, pageSize = 1000) {
  const books = [];
  let url = `${BASE}?limit=${pageSize}`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Readwise ${res.status}: ${await res.text()}`);
    const page = await res.json();
    books.push(...page.results);
    url = page.next; // a full URL with the cursor, or null on the last page
  }
  return books;
}
