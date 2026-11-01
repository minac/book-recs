// Confidence that you'll love a book: a small logistic regression trained on your own
// rated books. "Love" = you rated it LOVE_MIN or more, the bar you set for recommendations.
export const LOVE_MIN = 4.5;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// author / series: your ratings of OTHER books by that author / in that series.
export function features({ community, ratingsCount, author = [], series = [] }) {
  const am = mean(author);
  const sm = mean(series);
  return [
    1,
    community != null ? community - 4 : 0,
    community != null ? Math.log10(ratingsCount + 1) - 2 : 0,
    am != null ? 1 : 0,
    am != null ? am - 4 : 0,
    sm != null ? 1 : 0,
    sm != null ? sm - 4 : 0,
  ];
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const dot = (w, x) => w.reduce((t, wi, i) => t + wi * x[i], 0);

export function train(rows, { lambda = 1, steps = 4000, lr = 0.1 } = {}) {
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
export function evaluate(rows) {
  const preds = [];
  for (let k = 0; k < 5; k++) {
    const test = rows.filter((_, i) => i % 5 === k);
    const predict = train(rows.filter((_, i) => i % 5 !== k));
    for (const r of test) preds.push({ p: predict(r.x), y: r.y });
  }
  const pos = preds.filter((r) => r.y);
  const neg = preds.filter((r) => !r.y);
  let wins = 0;
  for (const a of pos) for (const b of neg) wins += a.p > b.p ? 1 : a.p === b.p ? 0.5 : 0;
  return { auc: wins / (pos.length * neg.length), baseRate: pos.length / preds.length, n: preds.length };
}
