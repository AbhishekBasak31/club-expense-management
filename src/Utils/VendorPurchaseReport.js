// ─────────────────────────────────────────────────────────────────────────────
// VENDOR PURCHASE REPORT — what was bought from ONE vendor, product by product, laid out against time. Pure rules (no DB).
//   view "month" : one column per DAY of the range      — each day: purchased unit price · qty · total price
//   view "year"  : one column per MONTH of the range    — each month: total qty · total amount
//   both views end with a final column pair (total qty · total amount) and a total row at the bottom.
// A product bought twice on one day at different rates shows one line per rate in that day's cell.
// Total price = the line's net amount (after discount, with GST) — the same basis as the Purchase Ledger.
// ─────────────────────────────────────────────────────────────────────────────
export const VIEWS = ["month", "year"];
export const MAX_DAYS = 93;
export const MAX_MONTHS = 36;
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
export const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const DAY = 24 * 3600 * 1000;
const dayStart = (s) => new Date(`${s}T00:00:00.000Z`).getTime();
const keyOfDay = (t) => new Date(t).toISOString().slice(0, 10);

export function buckets(view, from, to) {
  const out = [];
  if (view === "month") {
    for (let t = dayStart(from); t <= dayStart(to); t += DAY) { const k = keyOfDay(t); out.push({ key: k, label: String(Number(k.slice(8))) }); }
  } else {
    const [fy, fm] = from.split("-").map(Number), [ty, tm] = to.split("-").map(Number);
    for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) { const k = `${y}-${String(m).padStart(2, "0")}`; out.push({ key: k, label: k }); }
  }
  return out;
}

const productKey = (d) => String(d || "").trim().toLowerCase().replace(/\s+/g, " ");

/** lines = [{ date, description, uom, qty, unitPrice, amount }] — one per purchased item of the vendor. */
export function buildVendorGrid({ view, from, to, lines }) {
  const columns = buckets(view, from, to);
  const index = new Set(columns.map((c) => c.key));
  const bucketOf = (iso) => (view === "year" ? iso.slice(0, 7) : iso.slice(0, 10));
  const products = new Map();
  for (const l of lines) {
    const iso = new Date(l.date).toISOString(), b = bucketOf(iso);
    if (!index.has(b)) continue;
    const k = productKey(l.description);
    if (!k) continue;
    if (!products.has(k)) products.set(k, { key: k, name: String(l.description).trim(), uom: l.uom || "", raw: new Map() });
    const p = products.get(k);
    if (!p.uom && l.uom) p.uom = l.uom;
    if (!p.raw.has(b)) p.raw.set(b, []);
    p.raw.get(b).push({ qty: Number(l.qty) || 0, price: round2(l.unitPrice), amount: Number(l.amount) || 0 });
  }
  const rows = [...products.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
    const cells = {};
    let qty = 0, amount = 0;
    for (const [b, list] of p.raw) {
      if (view === "month") {
        const byRate = new Map();
        for (const e of list) { const h = byRate.get(e.price) || { price: e.price, qty: 0, total: 0 }; h.qty += e.qty; h.total += e.amount; byRate.set(e.price, h); }
        cells[b] = [...byRate.values()].sort((x, y) => x.price - y.price).map((h) => ({ price: h.price, qty: round3(h.qty), total: round2(h.total) }));
      } else {
        cells[b] = { qty: round3(list.reduce((t, e) => t + e.qty, 0)), total: round2(list.reduce((t, e) => t + e.amount, 0)) };
      }
      qty += list.reduce((t, e) => t + e.qty, 0); amount += list.reduce((t, e) => t + e.amount, 0);
    }
    return { key: p.key, name: p.name, uom: p.uom, cells, totalQty: round3(qty), totalAmount: round2(amount) };
  });

  const totals = { qty: round3(rows.reduce((t, r) => t + r.totalQty, 0)), amount: round2(rows.reduce((t, r) => t + r.totalAmount, 0)), cells: {} };
  for (const c of columns) {
    let q = 0, a = 0;
    for (const r of rows) {
      const x = r.cells[c.key];
      if (!x) continue;
      if (Array.isArray(x)) x.forEach((e) => { q += e.qty; a += e.total; }); else { q += x.qty; a += x.total; }
    }
    totals.cells[c.key] = { qty: round3(q), total: round2(a) };
  }
  return { columns, rows, totals };
}