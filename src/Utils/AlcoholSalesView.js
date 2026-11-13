// ─────────────────────────────────────────────────────────────────────────────
// Daily Alcohol SALES — the rules, with no database and no Express, so they can be tested on their own.
//
// A sale is one LINE of a POS bill: date, bill no, time, order no, steward, the alcohol, a MEASURE (a volume UOM from
// the UOM master — Peg, Wine Glass, Wine Bottle, Beer Bottle …), quantity, discount %, discount amount, settlement
// mode and amount. The year, month and day views are all just groupings of those lines:
//     year  → one row per month      month → one row per day      day → the lines themselves (by hour)
// ─────────────────────────────────────────────────────────────────────────────
import { round3 } from "./AlcoholStock.js";
import { round2 } from "./AlcoholBar.js";

export const MAX_DAY_LINES = 5000;
export const MAX_IMPORT_ROWS = 20000;
export const LATE_HOUR_LIMIT = 6;                  // clock hours 0–5 are "after midnight": they sort after 11 PM

export const pad2 = (n) => String(n).padStart(2, "0");
export const hourKey = (h) => (h < LATE_HOUR_LIMIT ? h + 24 : h);
export const growthPct = (cur, prev) => (prev > 0 ? round2(((cur - prev) / prev) * 100) : null);

// ── dates ─────────────────────────────────────────────────────────────────────
export const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
export const monthKeyOf = (dateStr) => dateStr.slice(0, 7);
// a REAL calendar date / month — "2026-02-30" would otherwise quietly become 2 March, and "2026-13" is no month
export const isRealDate = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false; const d = new Date(`${s}T00:00:00.000Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
export const isRealMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s));
export function daysInMonth(key) { return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate(); }
export const monthDayKeys = (key) => Array.from({ length: daysInMonth(key) }, (_, i) => `${key}-${pad2(i + 1)}`);
export const previousMonthKey = (key) => { const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`; };
export const previousDay = (dateStr) => dayKey(new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - 24 * 3600 * 1000));

// 12 month keys of a year: financial (April → March, `year` is the START year) or calendar
export function yearMonthKeys(year, yearType = "fy") {
  const out = [];
  for (let i = 0; i < 12; i++) {
    if (yearType === "calendar") out.push(`${year}-${pad2(i + 1)}`);
    else { const m = ((3 + i) % 12) + 1; out.push(`${m >= 4 ? year : year + 1}-${pad2(m)}`); }
  }
  return out;
}
export const yearLabel = (year, yearType = "fy") => (yearType === "calendar" ? String(year) : `FY ${year}-${String(year + 1).slice(2)}`);

// ── small normalisers ─────────────────────────────────────────────────────────
// "9:05", "09:05", "09:05:33" → "09:05"; blank → ""; anything else → null (invalid)
export function normTime(t) {
  const s = String(t ?? "").trim();
  if (s === "") return "";
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : `${pad2(h)}:${m[2]}`;
}
export const normMode = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();

// ── one line ──────────────────────────────────────────────────────────────────
const blank = (v) => v === undefined || v === null || String(v).trim() === "";
const num = (v) => (blank(v) ? 0 : Number(v));

/**
 * Check one raw line and turn it into the stored shape.
 *   ctx.minDate         the day tracking started (YYYY-MM-DD) — earlier days are refused
 *   ctx.productOf(id)   → { id, key, name } | { error } | null
 *   ctx.measureOf(id)   → { id, name, ml } | null          (only volume UOMs are known to it)
 * Returns { line } or { error }.
 */
export function validateSaleLine(raw, ctx) {
  const r = raw || {};
  const date = String(r.date ?? "");
  if (!isRealDate(date)) return { error: "A valid date (YYYY-MM-DD) is required." };
  if (ctx.minDate && date < ctx.minDate) return { error: `Dates before tracking started (${ctx.minDate}) are not allowed.` };

  const p = ctx.productOf(r.productId);
  if (!p) return { error: "Product not found." };
  if (p.error) return { error: p.error };
  if (blank(r.uomId)) return { error: "Choose how it was sold — a volume unit from the UOM master (Peg, Wine Glass …)." };
  const m = ctx.measureOf(r.uomId);
  if (!m) return { error: "That unit is not a volume unit in the UOM master." };

  const qty = Number(r.qty);
  if (blank(r.qty) || !Number.isFinite(qty) || qty <= 0 || qty > 100000) return { error: "Quantity must be above 0." };
  const discPct = num(r.discPct), discAmt = num(r.discAmt), amount = num(r.amount);
  if (!Number.isFinite(discPct) || discPct < 0 || discPct > 100) return { error: "Disc % must be between 0 and 100." };
  if (!Number.isFinite(discAmt) || discAmt < 0) return { error: "Disc amount must be 0 or more." };
  if (!Number.isFinite(amount) || amount < 0) return { error: "Amount must be 0 or more." };
  const time = normTime(r.time);
  if (time === null) return { error: "Time must look like 21:30." };
  for (const [label, v] of [["Bill no", r.billNo], ["Order no", r.orderNo], ["Steward", r.steward], ["Settlement mode", r.settMode]]) {
    if (String(v ?? "").trim().length > 60) return { error: `${label} can be at most 60 characters.` };
  }
  const q = round3(qty);
  if (q <= 0) return { error: "Quantity must be above 0." };            // 0.0004 is above 0 but rounds to nothing
  return {
    line: {
      day: date, month: monthKeyOf(date), time, hour: time ? Number(time.slice(0, 2)) : null,
      billNo: String(r.billNo ?? "").trim(), orderNo: String(r.orderNo ?? "").trim(), steward: String(r.steward ?? "").trim(), settMode: normMode(r.settMode),
      productId: p.id, productKey: p.key, productName: p.name, uomId: m.id, uomName: m.name, uomMl: m.ml,
      qty: q, ml: round3(q * m.ml), discPct: round2(discPct), discAmt: round2(discAmt), amount: round2(amount),
    },
  };
}

// ── duplicates (a POS file imported twice must not double the day) ──────────────────────────────────────
export const signature = (l) => [l.day, l.time || "", l.billNo || "", l.orderNo || "", String(l.productKey), String(l.uomId), Number(l.qty), Number(l.amount), Number(l.discAmt || 0), Number(l.discPct || 0), l.settMode || "", l.steward || ""].join("|");
/** Split `incoming` lines into the ones that are new and the ones the day already holds (each existing line can cancel one). */
export function dedupe(existing, incoming) {
  const have = new Map();
  existing.forEach((l) => { const k = signature(l); have.set(k, (have.get(k) || 0) + 1); });
  const fresh = []; let duplicates = 0;
  incoming.forEach((l) => { const k = signature(l); const n = have.get(k) || 0; if (n > 0) { have.set(k, n - 1); duplicates++; } else fresh.push(l); });
  return { fresh, duplicates };
}

// ── ordering and sums ─────────────────────────────────────────────────────────
/** By time (lines without a time last; after-midnight hours after 11 PM), then bill no, then order no; ties keep their order. */
export function sortLines(lines) {
  const k = (l) => (l.hour == null ? Infinity : hourKey(l.hour));
  return lines.map((l, i) => [l, i]).sort(([a, i], [b, j]) => (k(a) - k(b)) || String(a.time || "").localeCompare(String(b.time || "")) || String(a.billNo || "").localeCompare(String(b.billNo || ""), undefined, { numeric: true }) || String(a.orderNo || "").localeCompare(String(b.orderNo || ""), undefined, { numeric: true }) || i - j).map(([l]) => l);
}
export const zeroTotals = () => ({ qty: 0, ml: 0, discAmt: 0, amount: 0, lines: 0 });
export const roundTotals = (t) => ({ qty: round3(t.qty), ml: round3(t.ml), discAmt: round2(t.discAmt), amount: round2(t.amount), lines: t.lines });
export function sumRows(rows) { const t = zeroTotals(); rows.forEach((r) => { t.qty += Number(r.qty) || 0; t.ml += Number(r.ml) || 0; t.discAmt += Number(r.discAmt) || 0; t.amount += Number(r.amount) || 0; t.lines += Number(r.lines) || 0; }); return roundTotals(t); }
export const totalsOfLines = (lines) => sumRows(lines.map((l) => ({ qty: l.qty, ml: l.ml, discAmt: l.discAmt, amount: l.amount, lines: 1 })));
export function bestOf(rows) { let b = null; rows.forEach((r) => { if (r.amount > 0 && (!b || r.amount > b.amount)) b = { key: r.key, amount: r.amount }; }); return b; }

/**
 * Turn database groups into the rows of a month (or year) view.
 *   groups  [{ _id: { k, p? }, productName?, qty, ml, discAmt, amount, lines }]   k = day or month key, p = productKey
 *   keys    every day/month of the period, in order
 *   split   true  → one row per (key, alcohol) — only those that sold
 *           false → one row per key, ALL of them (zero rows included), with growth against the key before
 */
export function periodRows(groups, keys, split) {
  const rnd = (g) => ({ qty: round3(g.qty), ml: round3(g.ml), discAmt: round2(g.discAmt), amount: round2(g.amount), lines: g.lines });
  if (split) {
    return groups.map((g) => ({ key: g._id.k, productId: g._id.p, productName: g.productName || "", ...rnd(g) }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.productName.localeCompare(b.productName));
  }
  const by = new Map();
  groups.forEach((g) => { const c = by.get(g._id.k) || { qty: 0, ml: 0, discAmt: 0, amount: 0, lines: 0 }; c.qty += g.qty; c.ml += g.ml; c.discAmt += g.discAmt; c.amount += g.amount; c.lines += g.lines; by.set(g._id.k, c); });
  let prev = null;
  return keys.map((k) => {
    const row = { key: k, productId: null, productName: "", ...rnd(by.get(k) || { qty: 0, ml: 0, discAmt: 0, amount: 0, lines: 0 }) };
    row.growthPct = prev == null ? null : growthPct(row.amount, prev);
    prev = row.amount;
    return row;
  });
}
/** Per-key totals of the same groups (for the chart, whatever the split) — every key present, zeros included. */
export function keyTotals(groups, keys) {
  const by = new Map(keys.map((k) => [k, { key: k, qty: 0, ml: 0, discAmt: 0, amount: 0, lines: 0 }]));
  groups.forEach((g) => { const c = by.get(g._id.k); if (!c) return; c.qty += g.qty; c.ml += g.ml; c.discAmt += g.discAmt; c.amount += g.amount; c.lines += g.lines; });
  return keys.map((k) => { const c = by.get(k); return { key: k, qty: round3(c.qty), ml: round3(c.ml), discAmt: round2(c.discAmt), amount: round2(c.amount), lines: c.lines }; });
}

// ── one day: by hour, and by settlement mode ────────────────────────────────────────
/** Hours from the first to the last that sold (gaps are zeros, after-midnight hours last); lines without a time are `untimed`. */
export function hoursSummary(lines) {
  const timed = new Map(); const untimed = { qty: 0, ml: 0, discAmt: 0, amount: 0, lines: 0 };
  lines.forEach((l) => {
    const t = l.hour == null ? untimed : (timed.get(l.hour) || timed.set(l.hour, { hour: l.hour, qty: 0, ml: 0, discAmt: 0, amount: 0, lines: 0 }).get(l.hour));
    t.qty += l.qty; t.ml += l.ml || 0; t.discAmt += l.discAmt; t.amount += l.amount; t.lines += 1;
  });
  const keys = [...timed.keys()].map(hourKey).sort((a, b) => a - b);
  const hours = [];
  if (keys.length) for (let k = keys[0]; k <= keys[keys.length - 1]; k++) { const h = k % 24; const t = timed.get(h) || { hour: h, qty: 0, ml: 0, discAmt: 0, amount: 0, lines: 0 }; hours.push({ hour: h, qty: round3(t.qty), ml: round3(t.ml), discAmt: round2(t.discAmt), amount: round2(t.amount), lines: t.lines }); }
  let peak = null; hours.forEach((h) => { if (h.amount > 0 && (!peak || h.amount > peak.amount)) peak = { hour: h.hour, amount: h.amount }; });
  return { hours, untimed: { qty: round3(untimed.qty), ml: round3(untimed.ml), discAmt: round2(untimed.discAmt), amount: round2(untimed.amount), lines: untimed.lines }, peakHour: peak };
}
export function modeSummary(lines) {
  const by = new Map();
  lines.forEach((l) => { const k = l.settMode || ""; const c = by.get(k) || { mode: k, qty: 0, ml: 0, discAmt: 0, amount: 0, lines: 0 }; c.qty += l.qty; c.ml += l.ml || 0; c.discAmt += l.discAmt; c.amount += l.amount; c.lines += 1; by.set(k, c); });
  return [...by.values()].map((c) => ({ mode: c.mode, qty: round3(c.qty), ml: round3(c.ml), discAmt: round2(c.discAmt), amount: round2(c.amount), lines: c.lines })).sort((a, b) => b.amount - a.amount || a.mode.localeCompare(b.mode));
}
export const billCount = (lines) => new Set(lines.filter((l) => l.billNo).map((l) => `${l.day || ""}|${l.billNo}`)).size;