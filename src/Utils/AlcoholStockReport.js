// ─────────────────────────────────────────────────────────────────────────────
// Alcohol STOCK REPORTS — pure rules (no DB, no Express), so they are tested on their own.
// Every report reads the same ledger (AlcoholStockMovement), so the reports, the Alcohol Stock List, the Bar
// register and the variance report can never disagree.
//
// Quantities are ML. A product's value is its ml × cost per ml, where cost per ml = the product's CURRENT purchase
// price ÷ its bottle ml — so valuation is "at today's price", and the pages say so.
// ─────────────────────────────────────────────────────────────────────────────
import { round3, EPS } from "./AlcoholStock.js";
import { round2 } from "./AlcoholBar.js";

export const REPORT_NAMES = ["valuation", "movements", "receiving", "slow", "monthly", "consumption", "movement"];
export const STATEMENT_GROUPS = ["product", "day", "month"];   // consumption / movement: one row per alcohol, per day, or per month
export const MAX_STATEMENT_DAYS = 93;                          // "by day" needs a range this short
export const MAX_STATEMENT_MONTHS = 36;
export const CONSUMPTION_TYPES = ["sale", "breakage", "complimentary", "party"];   // what leaves the bar for good
export const OUT_TYPES = ["transfer-out", ...CONSUMPTION_TYPES];                   // anything that "moves" stock on
export const DEFAULT_COVER_DAYS = 90;                                              // more than this many days of cover = slow
const DAY = 24 * 3600 * 1000;

export const pad2 = (n) => String(n).padStart(2, "0");
export const dayStartOf = (s) => new Date(`${s}T00:00:00.000Z`);
export const dayKeyOf = (d) => new Date(d).toISOString().slice(0, 10);

// Indian financial year: 1 April – 31 March. "2026-11-07" → 2026-04-01 … 2027-03-31
export function fyBounds(dateStr) {
  const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}-${String(start + 1).slice(2)}` };
}

// every calendar month the range touches: 2026-04-15 … 2026-06-02 → ['2026-04','2026-05','2026-06']
export function monthKeys(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${pad2(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
export function monthWindow(key) {
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  return { d0: new Date(Date.UTC(y, m - 1, 1)), d1: new Date(Date.UTC(y, m, 1)) };
}
// inclusive number of days in [from, to]
export const daysBetween = (from, to) => Math.round((dayStartOf(to) - dayStartOf(from)) / DAY) + 1;

export const groupByProduct = (movements) => {
  const m = new Map();
  for (const r of movements) { const k = String(r.productId); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};

// store and bar balances on the evening of the day before d1 (i.e. every row dated before d1)
export function balancesAsOf(movements, d1) {
  const out = new Map();
  for (const r of movements) {
    if (new Date(r.date).getTime() >= d1.getTime()) continue;
    const k = String(r.productId);
    const b = out.get(k) || { storeMl: 0, barMl: 0 };
    if (r.location === "bar") b.barMl += Number(r.qtyMl) || 0; else b.storeMl += Number(r.qtyMl) || 0;
    out.set(k, b);
  }
  for (const b of out.values()) { b.storeMl = round3(b.storeMl); b.barMl = round3(b.barMl); }
  return out;
}

// what happened to each product inside [d0, d1) — plus the last day anything moved on, up to d1
export function rangeActivity(movements, d0, d1) {
  const out = new Map();
  const get = (k) => { if (!out.has(k)) out.set(k, { receivedMl: 0, issuedMl: 0, soldMl: 0, breakageMl: 0, complimentaryMl: 0, partyMl: 0, consumedMl: 0, lastOutAt: null }); return out.get(k); };
  for (const r of movements) {
    const t = new Date(r.date).getTime();
    if (t >= d1.getTime()) continue;
    const a = get(String(r.productId));
    const q = Number(r.qtyMl) || 0;
    if (OUT_TYPES.includes(r.type) && (a.lastOutAt === null || t > a.lastOutAt)) a.lastOutAt = t;
    if (t < d0.getTime()) continue;
    if (r.type === "receipt") a.receivedMl += q;
    else if (r.type === "transfer-out") a.issuedMl += -q;
    else if (r.type === "sale") { a.soldMl += -q; a.consumedMl += -q; }
    else if (r.type === "breakage") { a.breakageMl += -q; a.consumedMl += -q; }
    else if (r.type === "complimentary") { a.complimentaryMl += -q; a.consumedMl += -q; }
    else if (r.type === "party") { a.partyMl += -q; a.consumedMl += -q; }
  }
  for (const a of out.values()) for (const k of ["receivedMl", "issuedMl", "soldMl", "breakageMl", "complimentaryMl", "partyMl", "consumedMl"]) a[k] = round3(a[k]);
  return out;
}

// Dead = nothing moved in the period. Slow = what is on hand would last longer than `coverLimitDays` at the period's
// pace. "Used" is the larger of what was issued to the bar and what was consumed, so a bar that has not closed its
// days yet (no sales in the ledger) is still judged by what it was given.
export function classifyStock({ totalMl, usedMl, days, coverLimitDays = DEFAULT_COVER_DAYS }) {
  if (!(totalMl > EPS)) return { cls: "none", coverDays: null };
  if (!(usedMl > EPS)) return { cls: "dead", coverDays: null };
  const coverDays = round2(totalMl / (usedMl / Math.max(days, 1)));
  return { cls: coverDays > coverLimitDays ? "slow" : "ok", coverDays };
}

// a short delivery is valued in proportion: 8 of 12 invoiced bottles = 8/12 of the line amount
export function receiptValue({ amount, billedQty, receivedBottles }) {
  const a = Number(amount) || 0, q = Number(billedQty) || 0;
  if (a <= 0 || q <= 0) return 0;
  return round2(a * Math.min(1, receivedBottles / q));
}

// Receiving report grouping: line | vendor | month | product | brand
export function groupReceipts(lines, groupBy) {
  const total = (rows) => ({ lines: rows.reduce((t, r) => t + r.lines, 0), receivedMl: round3(rows.reduce((t, r) => t + r.receivedMl, 0)), value: round2(rows.reduce((t, r) => t + r.value, 0)) });
  if (groupBy === "line") {
    const rows = [...lines].sort((a, b) => a.date.localeCompare(b.date) || a.productName.localeCompare(b.productName));
    return { rows, totals: total(rows.map((r) => ({ lines: 1, receivedMl: r.receivedMl, value: r.value }))) };
  }
  const keyOf = (l) => groupBy === "vendor" ? [l.vendorName || "(no vendor)", l.vendorName || "(no vendor)"]
    : groupBy === "month" ? [l.date.slice(0, 7), l.date.slice(0, 7)]
    : groupBy === "brand" ? [l.brandName || "(no brand)", l.brandName || "(no brand)"]
    : [l.productId, l.productName];
  const groups = new Map();
  for (const l of lines) {
    const [key, label] = keyOf(l);
    const g = groups.get(key) || { key, label, lines: 0, receivedMl: 0, value: 0, unitMl: groupBy === "product" ? l.unitMl : null };
    g.lines += 1; g.receivedMl += l.receivedMl; g.value += l.value;
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => ({ ...g, receivedMl: round3(g.receivedMl), value: round2(g.value) }))
    .sort((a, b) => (groupBy === "month" ? a.key.localeCompare(b.key) : b.value - a.value || a.label.localeCompare(b.label)));
  return { rows, totals: total(rows) };
}

// Purchase vs consumption, month by month, over the products that pass `include`.
//   closing = opening + opening-stock entered + received + store adjustments − consumed + bar-count variance
// (transfers store → bar cancel out). Consumption and stock are valued at today's cost per ml; receipts at what the
// purchase actually cost.
export function monthlyRows({ movements, months, valueOfReceipt, costPerMlOf, include }) {
  const byProduct = groupByProduct(movements.filter((m) => include(String(m.productId))));
  return months.map((key) => {
    const { d0, d1 } = monthWindow(key);
    const x = { openingMl: 0, openingEntryMl: 0, receivedMl: 0, receivedValue: 0, adjustmentMl: 0, consumedMl: 0, consumedValue: 0, varianceMl: 0, closingMl: 0, closingValue: 0 };
    for (const [pid, list] of byProduct) {
      const cpm = costPerMlOf(pid);
      let open = 0, close = 0;
      for (const m of list) {
        const t = new Date(m.date).getTime();
        if (t >= d1.getTime()) continue;
        const q = Number(m.qtyMl) || 0;
        close += q;
        if (t < d0.getTime()) { open += q; continue; }
        if (m.type === "opening") x.openingEntryMl += q;
        else if (m.type === "receipt") { x.receivedMl += q; x.receivedValue += valueOfReceipt(m); }
        else if (m.type === "adjustment") x.adjustmentMl += q;
        else if (CONSUMPTION_TYPES.includes(m.type)) { x.consumedMl += -q; x.consumedValue += -q * cpm; }
        else if (m.type === "bar-count") x.varianceMl += q;
      }
      x.openingMl += open; x.closingMl += close; x.closingValue += close * cpm;
    }
    return {
      month: key, openingMl: round3(x.openingMl), openingEntryMl: round3(x.openingEntryMl), receivedMl: round3(x.receivedMl), receivedValue: round2(x.receivedValue),
      adjustmentMl: round3(x.adjustmentMl), consumedMl: round3(x.consumedMl), consumedValue: round2(x.consumedValue), varianceMl: round3(x.varianceMl),
      closingMl: round3(x.closingMl), closingValue: round2(x.closingValue),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSUMPTION and MOVEMENT reports. Both are the same ledger read two ways, so they always agree with each other and
// with the Stock List:
//
//   closing = opening + opening stock entered + received + adjustments − consumed + count variance
//
// (issuing to the bar moves stock from the store to the bar and changes no total).
//   consumed  = sold + breakage + complimentary + party — what the bar RECORDED as gone, written to the ledger when the
//               bar day is closed
//   variance  = the physical count against what was expected (negative = short, positive = excess), also written at close
//   actual    = consumed − variance — what really left the bar: a shortage is stock that was drunk but never rung up
// ─────────────────────────────────────────────────────────────────────────────
const blankStats = () => ({ openStoreMl: 0, openBarMl: 0, openingEntryMl: 0, receivedMl: 0, adjustmentMl: 0, issuedMl: 0, soldMl: 0, breakageMl: 0, complimentaryMl: 0, partyMl: 0, varianceMl: 0, closeStoreMl: 0, closeBarMl: 0 });

/** What happened to each product in [d0, d1): its balances before d0 and at the end, and every kind of movement in between. */
export function windowStats(movements, d0, d1) {
  const out = new Map();
  for (const r of movements) {
    const t = new Date(r.date).getTime();
    if (t >= d1.getTime()) continue;
    const k = String(r.productId);
    if (!out.has(k)) out.set(k, blankStats());
    const a = out.get(k);
    const q = Number(r.qtyMl) || 0, bar = r.location === "bar";
    if (bar) a.closeBarMl += q; else a.closeStoreMl += q;
    if (t < d0.getTime()) { if (bar) a.openBarMl += q; else a.openStoreMl += q; continue; }
    if (r.type === "opening") a.openingEntryMl += q;
    else if (r.type === "receipt") a.receivedMl += q;
    else if (r.type === "adjustment") a.adjustmentMl += q;
    else if (r.type === "transfer-out") a.issuedMl += -q;
    else if (r.type === "sale") a.soldMl += -q;
    else if (r.type === "breakage") a.breakageMl += -q;
    else if (r.type === "complimentary") a.complimentaryMl += -q;
    else if (r.type === "party") a.partyMl += -q;
    else if (r.type === "bar-count") a.varianceMl += q;
  }
  for (const a of out.values()) for (const k of Object.keys(a)) a[k] = round3(a[k]);
  return out;
}

/** One report row from a product's stats, with `cpm` = cost per ml (values are at today's purchase price). */
export function statementRow(s, cpm = 0) {
  const openingMl = round3(s.openStoreMl + s.openBarMl), closingMl = round3(s.closeStoreMl + s.closeBarMl);
  const consumedMl = round3(s.soldMl + s.breakageMl + s.complimentaryMl + s.partyMl);
  const actualMl = round3(consumedMl - s.varianceMl);
  return {
    openingMl, openingEntryMl: s.openingEntryMl, receivedMl: s.receivedMl, issuedMl: s.issuedMl, adjustmentMl: s.adjustmentMl,
    soldMl: s.soldMl, breakageMl: s.breakageMl, complimentaryMl: s.complimentaryMl, partyMl: s.partyMl, consumedMl, varianceMl: s.varianceMl, actualMl,
    closingMl, closingStoreMl: s.closeStoreMl, closingBarMl: s.closeBarMl,
    openingValue: round2(openingMl * cpm), closingValue: round2(closingMl * cpm), consumedValue: round2(consumedMl * cpm), actualValue: round2(actualMl * cpm),
  };
}
export const STATEMENT_ML = ["openingMl", "openingEntryMl", "receivedMl", "issuedMl", "adjustmentMl", "soldMl", "breakageMl", "complimentaryMl", "partyMl", "consumedMl", "varianceMl", "actualMl", "closingMl", "closingStoreMl", "closingBarMl"];
export const STATEMENT_VALUE = ["openingValue", "closingValue", "consumedValue", "actualValue"];
/** Add rows up (every quantity and every value). */
export function addStatementRows(rows) {
  const t = {};
  for (const k of STATEMENT_ML) t[k] = round3(rows.reduce((s, r) => s + r[k], 0));
  for (const k of STATEMENT_VALUE) t[k] = round2(rows.reduce((s, r) => s + r[k], 0));
  return t;
}
/** Anything at all to show for this product in the movement report. */
export const hasMovement = (r) => ["openingMl", "closingMl", "openingEntryMl", "receivedMl", "issuedMl", "adjustmentMl", "consumedMl", "varianceMl"].some((k) => Math.abs(r[k]) > EPS);

/** The days or months of [from, to] as windows, clipped to the range so the buckets always add up to the whole. */
export function statementBuckets(from, to, groupBy) {
  const end = new Date(dayStartOf(to).getTime() + DAY), start = dayStartOf(from);
  if (groupBy === "day") {
    const out = [];
    for (let t = start.getTime(); t < end.getTime(); t += DAY) { const d0 = new Date(t); out.push({ key: dayKeyOf(d0), d0, d1: new Date(t + DAY) }); }
    return out;
  }
  return monthKeys(from, to).map((key) => {
    const w = monthWindow(key);
    return { key, d0: w.d0.getTime() < start.getTime() ? start : w.d0, d1: w.d1.getTime() > end.getTime() ? end : w.d1 };
  });
}