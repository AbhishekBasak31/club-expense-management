// ─────────────────────────────────────────────────────────────────────────────
// Alcohol BAR and SALES — pure rules (no DB, no Express), so they are tested on their own.
//
// A bar day, per product, in ML:
//     Opening  (the bar's balance at the end of the previous day = its last PHYSICAL count)
//   + Received (stock issued from the store that day)
//   − Sold     (from the Daily Sales entry: pegs × 30 ml + large pegs × 60 ml + bottles × bottle ml)
//   − Other    (breakage, complimentary, party)
//   = Expected closing
//   Physical closing is COUNTED; Variance = Physical − Expected  (negative = short, positive = excess).
//
// Closing the day writes the day's rows to the ledger (sale / breakage / complimentary / party, plus ONE
// 'bar-count' row holding the variance), so the ledger balance after the day equals the physical count — and
// that count is the next day's opening.
// ─────────────────────────────────────────────────────────────────────────────
import { round3, EPS } from "./AlcoholStock.js";

export const OUTFLOW_TYPES = ["breakage", "complimentary", "party"];
export const DEFAULT_PEG_ML = 30;
export const DEFAULT_LARGE_PEG_ML = 60;
export const DEFAULT_TOLERANCE_ML = 30;      // within one peg either way counts as "OK"

export const round2 = (n) => Math.round(Number(n) * 100) / 100;
export const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
export const dayStartOf = (s) => new Date(`${s}T00:00:00.000Z`);
export const costPerMl = (price, unitMl) => (unitMl > 0 && Number(price) > 0 ? Number(price) / unitMl : 0);

// pegs and bottles are whole numbers a person counted; nothing can be negative
export function validateSaleLine({ pegs = 0, largePegs = 0, bottles = 0 }) {
  for (const [label, v] of [["Pegs", pegs], ["Large pegs", largePegs], ["Bottles", bottles]]) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return `${label} must be a number of 0 or more.`;
    if (!Number.isInteger(n)) return `${label} must be a whole number.`;
  }
  return null;
}

export const saleMl = ({ pegs = 0, largePegs = 0, bottles = 0 }, { pegMl = DEFAULT_PEG_ML, largePegMl = DEFAULT_LARGE_PEG_ML, unitMl }) =>
  round3(Number(pegs || 0) * pegMl + Number(largePegs || 0) * largePegMl + Number(bottles || 0) * unitMl);

export const saleAmount = ({ pegs = 0, largePegs = 0, bottles = 0 }, { pegPrice = 0, largePegPrice = 0, bottlePrice = 0 }) =>
  round2(Number(pegs || 0) * pegPrice + Number(largePegs || 0) * largePegPrice + Number(bottles || 0) * bottlePrice);

// Sum one product's BAR ledger rows into the columns of the day [d0, d1).
//   opening   = every bar row before the day
//   received  = transfers in            sold = sale rows (shown positive)
//   breakage / complimentary / party    = those rows (shown positive)
//   countAdj  = the day's 'bar-count' (variance) rows, signed
//   balanceEnd= opening + received − sold − other + countAdj
export function summariseBarDay(movements, d0, d1) {
  let opening = 0, received = 0, sold = 0, breakage = 0, complimentary = 0, party = 0, countAdj = 0;
  for (const m of movements) {
    if (m.location !== "bar") continue;
    const t = new Date(m.date).getTime();
    if (t >= d1.getTime()) continue;
    const q = Number(m.qtyMl) || 0;
    if (t < d0.getTime()) { opening += q; continue; }
    if (m.type === "transfer-in") received += q;
    else if (m.type === "sale") sold += -q;
    else if (m.type === "breakage") breakage += -q;
    else if (m.type === "complimentary") complimentary += -q;
    else if (m.type === "party") party += -q;
    else if (m.type === "bar-count") countAdj += q;
  }
  const o = round3(opening), r = round3(received), s = round3(sold), b = round3(breakage), c = round3(complimentary), p = round3(party), a = round3(countAdj);
  return { openingMl: o, receivedMl: r, soldMl: s, breakageMl: b, complimentaryMl: c, partyMl: p, countAdjMl: a, balanceEndMl: round3(o + r - s - b - c - p + a) };
}

export const expectedClosing = ({ openingMl, receivedMl, soldMl, breakageMl = 0, complimentaryMl = 0, partyMl = 0 }) =>
  round3(openingMl + receivedMl - soldMl - breakageMl - complimentaryMl - partyMl);

// uncounted → ok (within tolerance) → short / excess
export function varianceStatus(varianceMl, tolerance = DEFAULT_TOLERANCE_ML) {
  if (varianceMl === null || varianceMl === undefined) return "uncounted";
  if (Math.abs(varianceMl) <= tolerance + EPS) return "ok";
  return varianceMl < 0 ? "short" : "excess";
}

// a day may only be closed after every earlier day that has any bar/sales paperwork has been closed
export function firstBlockingDay(openBarDays, salesDays, closedKeys, dateKey) {
  const earlier = [
    ...openBarDays.map((d) => dayKey(d)),
    ...salesDays.map((d) => dayKey(d)).filter((k) => !closedKeys.has(k)),
  ].filter((k) => k < dateKey).sort();
  return earlier[0] || null;
}

export function validateOutflow({ type, bottles, looseMl }) {
  if (!OUTFLOW_TYPES.includes(type)) return `Type must be one of: ${OUTFLOW_TYPES.join(", ")}.`;
  const b = Number(bottles || 0), l = Number(looseMl || 0);
  if (!Number.isFinite(b) || !Number.isFinite(l) || b < 0 || l < 0) return "Bottles and loose ml must be 0 or more.";
  return null;
}