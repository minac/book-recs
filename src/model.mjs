// Confidence that you'll love a book: a small logistic regression trained on your own
// rated books. "Loved" = you rated it exactly LOVED, the same bar that picks recommendations.
export const LOVED = 5;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// author / series: your ratings of OTHER books by that author / in that series.
// No Hardcover community rating: on real data it predicted the reader's ratings no better
// than chance.
export function features({ author = [], series = [] }) {
  const am = mean(author);
  const sm = mean(series);
  return [
    1,
    am != null ? 1 : 0,
    am != null ? am - 4 : 0,
    sm != null ? 1 : 0,
    sm != null ? sm - 4 : 0,
  ];
}

// How strongly your record with a series or author says "you'll love the next one":
// a cautious (20th percentile) estimate of your 5★ rate there, starting from your overall
// rate as if you'd read priorBooks average books. A deeper record ranks higher, even
// with one miss: 4 of 5 loved (0.54) beats 2 of 2 (0.51), and 1 of 1 sits at 0.36.
export function strength(loved, books, baseRate, { priorBooks = 2, percentile = 0.2, steps = 2000 } = {}) {
  const a = loved + priorBooks * baseRate;
  const b = books - loved + priorBooks * (1 - baseRate);
  const density = [];
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const x = (i + 0.5) / steps;
    const d = Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x));
    density.push(d);
    total += d;
  }
  let acc = 0;
  for (let i = 0; i < steps; i++) {
    acc += density[i];
    if (acc / total >= percentile) return (i + 0.5) / steps;
  }
  return 1;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const dot = (w, x) => w.reduce((t, wi, i) => t + wi * x[i], 0);

export function train(rows, { lambda = 1, steps = 4000, lr = 0.1 } = {}) {
  if (!rows.length) return () => 0.5; // no history: no opinion
  let w = new Array(rows[0].x.length).fill(0);
  for (let s = 0; s < steps; s++) {
    const g = w.map((wi, i) => (i ? lambda * wi : 0) / rows.length);
    for (const { x, y } of rows) {
      const err = sigmoid(dot(w, x)) - y;
      for (let i = 0; i < w.length; i++) g[i] += (err * x[i]) / rows.length;
    }
    w = w.map((wi, i) => wi - lr * g[i]);
  }
  return (x) => sigmoid(dot(w, x));
}

// 5-fold cross-validation on your history, so the page can say how far to trust it.
// toRow(item, pool) builds an item's row from the ratings in pool only. Each fold builds
// every row from its training books, so a held-out rating never leaks into training.
export function evaluate(items, toRow) {
  const labels = items.map((it) => toRow(it, items).y);
  const baseRate = labels.length ? labels.filter(Boolean).length / labels.length : 0;
  const preds = [];
  for (let k = 0; k < 5; k++) {
    const pool = items.filter((_, i) => i % 5 !== k);
    const test = items.filter((_, i) => i % 5 === k);
    if (!pool.length || !test.length) continue;
    const predict = train(pool.map((it) => toRow(it, pool)));
    for (const it of test) {
      const r = toRow(it, pool);
      preds.push({ p: predict(r.x), y: r.y });
    }
  }
  const pos = preds.filter((r) => r.y);
  const neg = preds.filter((r) => !r.y);
  if (!pos.length || !neg.length) return { auc: null, baseRate, n: items.length };
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0;
  return { auc: wins / (pos.length * neg.length), baseRate, n: items.length };
}
