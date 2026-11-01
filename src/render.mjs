// Renders the recommendations as one static HTML page: a grid of book cards.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Hardcover has junk dates like "0030-01-01"; show nothing rather than that.
const year = (b) => {
  const y = Number((b.release_date ?? String(b.release_year ?? "")).slice(0, 4));
  return y >= 1450 ? String(y) : "";
};
const stars = (r) => "★".repeat(Math.round(r));

function why(c) {
  if (c.kind === "series") {
    const read = c.because.map((b) => `${b.position != null ? `#${b.position}` : esc(b.title)} ${stars(b.rating)}`).join(", ");
    const where = c.skipped ? `the first one you skipped in ${esc(c.seriesName)}` : `next in ${esc(c.seriesName)}`;
    return `#${c.position}, ${where}. You read ${read}.`;
  }
  const liked = c.because.map((b) => esc(b.title)).join(", ");
  const series = c.seriesName ? ` Starts ${esc(c.seriesName)}.` : "";
  return `Because you loved ${liked}.${series}`;
}

const TONE = { "Strong match": "high", Promising: "mid", "Limited evidence": "low" };

function evidence(c) {
  const { books, loved } = c.evidence;
  const by = c.kind === "series" ? `in ${esc(c.seriesName)}` : `by ${esc(c.authorName)}`;
  return books === 1
    ? `Based on 1 of your books ${by}.`
    : `Based on ${books} of your books ${by}: ${loved} rated 5★.`;
}

function card(c) {
  const cover = c.image?.url ? `<img src="${esc(c.image.url)}" alt="" loading="lazy">` : `<div class="nocover"></div>`;
  return `<a class="card" href="https://hardcover.app/books/${esc(c.slug)}" target="_blank" rel="noopener">
    ${cover}
    <div class="body">
      <span class="conf ${TONE[c.label]}">${esc(c.label)}</span>
      <span class="evidence">${evidence(c)}</span>
      <span class="title">${esc(c.title)}</span>
      <span class="author">${[esc(c.authorName), year(c)].filter(Boolean).join(" · ")}</span>
      <span class="why">${why(c)}</span>
      <span class="meta">★${(c.rating ?? 0).toFixed(2)} from ${c.ratings_count} on Hardcover${c.onShelf ? ` · <span class="tag">on your shelf</span>` : ""}</span>
    </div></a>`;
}

export function render({ cards, unmatched, quality, stats }, generatedAt) {
  const series = cards.filter((c) => c.kind === "series");
  const authors = cards.filter((c) => c.kind === "author");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Book recs</title>
<style>
:root { --bg:#fbfaf7; --fg:#1f1d1a; --muted:#6b665e; --card:#fff; --line:#e7e3dc; --accent:#8a4b2a; --tag:#efe6d8;
  --high:#2f7d4f; --mid:#9a6b12; --low:#8a8478; }
@media (prefers-color-scheme: dark) { :root { --bg:#171614; --fg:#ece8e1; --muted:#a39d93; --card:#211f1c; --line:#34312c;
  --accent:#e0a37f; --tag:#3a3129; --high:#6cc58f; --mid:#e2b04f; --low:#8f897e; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui, -apple-system, sans-serif; }
main { max-width:1200px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:26px; margin:0 0 4px; } h2 { font-size:19px; margin:36px 0 12px; }
.sub, footer { color:var(--muted); font-size:14px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(270px, 1fr)); gap:12px; }
.card { display:flex; gap:12px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px;
  color:var(--fg); text-decoration:none; }
.card:hover { border-color:var(--accent); }
.card img, .nocover { flex:0 0 84px; width:84px; height:126px; object-fit:cover; border-radius:4px; background:var(--line); }
.body { display:flex; flex-direction:column; gap:3px; min-width:0; }
.conf { font-weight:700; font-size:15px; line-height:1.2; } .high { color:var(--high); } .mid { color:var(--mid); } .low { color:var(--low); }
.evidence { color:var(--muted); font-size:12px; margin-bottom:4px; }
.title { font-weight:600; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.author, .why, .meta { color:var(--muted); font-size:12.5px; }
.why { color:var(--fg); }
.tag { background:var(--tag); border-radius:4px; padding:0 4px; color:var(--fg); }
footer { margin-top:40px; }
</style></head><body><main>
<h1>What to read next</h1>
<p class="sub">Picked from ${stats.liked} books you rated ${stats.loved}★. Only books that are already out.
Strong match: at least 2 of your books in that series (or by that author), and three quarters or more of them ${stats.loved}★. Limited evidence: just 1 of your books. Promising: the rest. The more books you loved, the higher a card sits.
Hidden: ${stats.thinAuthorPicks} author picks that rest on just 1 of your books, and ${stats.belowConfidence} books that looked unlikely to be ${stats.loved}★ reads. Series picks always show. Updated ${esc(generatedAt)}.</p>
<h2>Next in your series</h2>
<div class="grid">${series.map(card).join("\n")}</div>
<h2>More from authors you loved</h2>
<div class="grid">${authors.map(card).join("\n")}</div>
<footer>Within a label, cards are sorted by a score from a small model trained on your ${quality.n} rated books. ${quality.auc == null
  ? "There aren't enough rated books (or enough variety in your ratings) to test it yet."
  : `Tested on your own history, it ranks a book you loved above one you didn't ${Math.round(quality.auc * 100)}% of the time (50% would be a coin flip).`} You rated ${Math.round(quality.baseRate * 100)}% of your books ${stats.loved}★.
${unmatched.length ? `<br>Not found on Hardcover, so left out: ${unmatched.map((u) => `${esc(u.title)} (${esc(u.author)})`).join("; ")}.` : ""}
<br>Data from Readwise Books and <a href="https://hardcover.app">Hardcover</a>.</footer>
</main></body></html>`;
}
