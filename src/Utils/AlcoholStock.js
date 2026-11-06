// ─────────────────────────────────────────────────────────────────────────────
// Alcohol stock — pure rules (no DB, no Express), so they are tested on their own.
//
// THE LEDGER: every stock change is one row in AlcoholStockMovement, in ML, with a date,
// a product and a LOCATION (store | bar). A balance is simply the sum of the rows.
//   opening       store  +   the counted stock on the tracking start date
//   receipt       store  +   a purchase line received into stock
//   transfer-out  store  −   issued to the bar          } one transfer = two rows sharing
//   transfer-in   bar    +   received by the bar        } a transferId
//   adjustment    store  ±   a count correction, with a reason
// (later phases add the bar's own rows: sale, breakage, complimentary, party, bar-count)
// ─────────────────────────────────────────────────────────────────────────────
import { toBase } from "./Uom.resolver.js";

export const MOVEMENT_TYPES = ["opening", "receipt", "transfer-out", "transfer-in", "adjustment", "sale", "breakage", "complimentary", "party", "bar-count"];
export const MONTH_RE = /^\d{4}-\d{2}$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EPS = 0.0005;

export const round3 = (n) => Math.round(Number(n) * 1000) / 1000;
export const normName = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

// "2026-11" → [1 Nov 00:00 UTC, 1 Dec 00:00 UTC)
export function monthBounds(month) {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

// bottles + loose ml → ml, and back. Whole bottles plus the leftover, never fractions of a bottle.
export const toMl = ({ bottles = 0, looseMl = 0 }, unitMl) => round3(Number(bottles || 0) * unitMl + Number(looseMl || 0));
export function splitMl(ml, unitMl) {
  const sign = ml < 0 ? -1 : 1;
  const a = Math.abs(ml);
  const b = Math.floor(a / unitMl + 1e-9);
  return { bottles: sign * b, looseMl: sign * round3(a - b * unitMl) };
}

// How many ml is ONE of this product's own unit? A product on "750 ml Bottle" answers 750 directly; one on a
// legacy generic Bottle answers through its conversion. Anything else is not ready for stock.
export function unitMlOf(product, uoms, conversions) {
  if (!product.uomId) return { ok: false, reason: "The product has no unit — give it a sized bottle unit." };
  const r = toBase({ uoms, conversions, uomId: product.uomId, qty: 1 });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.base !== "ml") return { ok: false, reason: "The product's unit is not measured in ml." };
  return { ok: true, ml: r.baseQty };
}

// Sum the STORE rows for one product into the month's columns.
//   opening   = everything before the month + any 'opening' row dated inside it
//   received  = receipts in the month          toBar = transfers out in the month (shown positive)
//   adjustment= signed adjustments in the month
//   balance   = opening + received − toBar + adjustment   (rows dated after the month are ignored)
export function summariseStore(movements, monthStart, monthEnd) {
  let opening = 0, received = 0, toBar = 0, adjustment = 0;
  for (const m of movements) {
    if (m.location !== "store") continue;
    const t = new Date(m.date).getTime();
    if (t >= monthEnd.getTime()) continue;
    const q = Number(m.qtyMl) || 0;
    if (t < monthStart.getTime() || m.type === "opening") { opening += q; continue; }
    if (m.type === "receipt") received += q;
    else if (m.type === "transfer-out") toBar += -q;
    else if (m.type === "adjustment") adjustment += q;
  }
  const o = round3(opening), r = round3(received), b = round3(toBar), a = round3(adjustment);
  return { openingMl: o, receivedMl: r, toBarMl: b, adjustmentMl: a, balanceMl: round3(o + r - b + a) };
}

// out → low → over → ok, or "unset" when no Min/Max has been given. min / max are in BOTTLES.
export function levelStatus({ balanceMl, unitMl, min = 0, max = 0 }) {
  const bottles = balanceMl / unitMl;
  if (balanceMl <= EPS) return "out";
  if (min > 0 && bottles <= min + 1e-9) return "low";
  if (max > 0 && bottles > max + 1e-9) return "over";
  if (!(min > 0) && !(max > 0)) return "unset";
  return "ok";
}

// Bottles to order to get back up to Max, counting what is already awaiting receipt and already requested.
// null when no Max is set (no basis for a suggestion).
export function suggestOrder({ balanceMl, awaitingMl = 0, requestedMl = 0, unitMl, max = 0 }) {
  if (!(max > 0)) return null;
  const need = max - (balanceMl + awaitingMl + requestedMl) / unitMl;
  return need > 1e-9 ? Math.ceil(need - 1e-9) : 0;
}

// Validates a Min/Max/par/lead-time update; returns an error message or null.
export function validateLevels({ min, max, barPar, leadTimeDays }) {
  for (const [label, v] of [["Min", min], ["Max", max], ["Bar par", barPar], ["Lead time", leadTimeDays]]) {
    if (v === undefined) continue;
    const n = Number(v);
    if (v === null || v === "" || !Number.isFinite(n) || n < 0) return `${label} must be a number of 0 or more.`;
  }
  if (min !== undefined && max !== undefined && Number(max) > 0 && Number(min) > Number(max)) return "Min cannot be above Max.";
  return null;
}