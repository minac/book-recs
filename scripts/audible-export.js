// Paste into Chrome's DevTools console on https://www.audible.com/library/titles while
// signed in. Audible has no API, so this reads your library pages and purchase history
// and copies data/audible.json's contents to the clipboard. Nothing leaves your browser.
(async () => {
  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const get = async (url) => new DOMParser().parseFromString(await (await fetch(url, { credentials: "include" })).text(), "text/html");

  // Library, newest purchase first. progress: "Finished", "3h 2m left", "8h 59m" (not started).
  const books = [];
  for (let page = 1; page <= 50; page++) {
    const doc = await get(`/library/titles?pageSize=50&page=${page}&sortBy=PURCHASE_DATE.dsc`);
    const rows = [...doc.querySelectorAll(".adbl-library-content-row")];
    for (const row of rows) {
      const lis = [...row.querySelectorAll("li")].map((li) => clean(li.textContent)).filter(Boolean);
      const progress = [...row.querySelectorAll("span.bc-color-secondary")]
        .filter((s) => !s.className.includes("bc-pub-hidden"))
        .map((s) => clean(s.textContent))
        .find((t) => /^(Finished|(\d+h ?)?(\d+m ?)?left|\d+h( \d+m)?|\d+m)$/.test(t)) || null;
      books.push({
        asin: row.id.replace("adbl-library-content-row-", ""),
        title: lis[0],
        by: (lis.find((l) => l.startsWith("By:")) || "").replace(/^By:\s*/, ""),
        series: (lis.find((l) => l.startsWith("Series:")) || "").replace(/^Series:\s*/, "") || null,
        progress,
        added: null,
      });
    }
    if (rows.length < 50) break;
  }

  // Purchase dates live on a separate page, one year at a time. Titles from Audible Plus
  // or gifts have no purchase, so they keep added: null.
  const years = [...(await get("/account/purchase-history")).querySelectorAll('select[name="df"] option')]
    .map((o) => o.value).filter((v) => /^\d{4}$/.test(v));
  const orders = [];
  for (const year of years) {
    const doc = await get(`/account/purchase-history?tf=orders&df=${year}&ps=40`);
    for (const tr of doc.querySelectorAll("tr")) {
      const text = clean(tr.textContent);
      const d = text.match(/(\d{2})-(\d{2})-(\d{4})/);
      if (d) orders.push({ title: norm(text.split(" By: ")[0]), added: `${d[3]}-${d[1]}-${d[2]}` });
    }
  }
  for (const b of books) {
    const t = norm(b.title);
    b.added = orders.find((o) => o.title && (t.startsWith(o.title) || o.title.startsWith(t)))?.added ?? null;
  }

  const out = { exportedAt: new Date().toISOString().slice(0, 10), dnfFrom: null, books };
  copy(JSON.stringify(out, null, 1)); // DevTools console helper
  console.log(`Copied ${books.length} books (${books.filter((b) => b.added).length} with a purchase date). Save them as data/audible.json.`);
})();
