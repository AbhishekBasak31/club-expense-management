import mongoose from "mongoose";
import { AlcoholStockMovement } from "../Model/AlcoholStockMovement.model.js";
import { AlcoholBarDay } from "../Model/AlcoholBarDay.model.js";
import { AlcoholDailySale } from "../Model/AlcoholDailySales.model.js";
import { AlcoholSaleLine } from "../Model/AlcoholSalesLine.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { DATE_RE, EPS, round3, toMl, splitMl } from "../Utils/AlcoholStock.js";
import {
  DEFAULT_PEG_ML, DEFAULT_LARGE_PEG_ML, DEFAULT_TOLERANCE_ML, round2, dayKey, dayStartOf, costPerMl,
  summariseBarDay, expectedClosing, varianceStatus, firstBlockingDay, validateOutflow,
  GRID_VIEWS, MAX_GRID_DAYS, MAX_GRID_MONTHS, buildConsumptionGrid, gridBuckets,
} from "../Utils/AlcoholBar.js";
import { loadContext, storeOutflowLimit, lastClosedDayKey, nextNoteNo } from "./AlcoholStock.controller.js";



// A REAL calendar date: "2026-02-30" would quietly become 2 March and "2026-13-45" is no date at all.
// Kept in this file on purpose, so the bar controller works whichever version of the stock controller is installed.
const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// ─────────────────────────────────────────────────────────────────────────────
// ALCOHOL BAR — Phase 2: issue notes (store → bar), the daily bar register, closing a day, and the variance report.
//
// While a day is OPEN its counts and breakage / complimentary / party live in a draft (AlcoholBarDay); sales come
// from that day's Daily Sales entry. CLOSING writes the day to the ledger — sale, other-use and ONE 'bar-count' row
// holding the variance — so the bar's ledger balance equals the physical count, and that count is the next day's
// opening. A day can only be closed after every earlier day with paperwork is closed; REOPENING removes exactly
// the rows that closing wrote, and only for the latest closed day.
// ─────────────────────────────────────────────────────────────────────────────
const uid = (req) => req.user?.userId ?? null;
const DAY = 24 * 3600 * 1000;
const textOf = (ml, unitMl) => { const s = splitMl(ml, unitMl); return `${s.bottles} btl${s.looseMl ? ` + ${s.looseMl} ml` : ""}`; };
export const pegSizes = (uoms) => ({
  pegMl: uoms.find((u) => u.type === "volume" && /^peg$/i.test(u.name))?.baseFactor ?? DEFAULT_PEG_ML,
  largePegMl: uoms.find((u) => u.type === "volume" && /^large\s*peg$/i.test(u.name))?.baseFactor ?? DEFAULT_LARGE_PEG_ML,
});

// ── the register, built from the ledger plus the open day's draft and sales ──────────────────────────────────
function buildRegister(ctx, dateStr, movements, dayDoc, soldMlByKey, tolerance) {
  const d0 = dayStartOf(dateStr), d1 = new Date(d0.getTime() + DAY);
  const byProduct = new Map();
  movements.forEach((m) => { const k = String(m.productId); if (!byProduct.has(k)) byProduct.set(k, []); byProduct.get(k).push(m); });
  const closed = dayDoc?.status === "closed";
  const counts = new Map((dayDoc?.counts || []).map((c) => [String(c.productId), c.physicalMl]));
  const other = new Map();
  (dayDoc?.outflows || []).forEach((o) => { const k = String(o.productId); const x = other.get(k) || { breakage: 0, complimentary: 0, party: 0 }; x[o.type] += Number(o.ml) || 0; other.set(k, x); });

  const rows = [];
  for (const { product: p, unitMl } of ctx.items) {
    if (unitMl == null) continue;
    const pid = String(p._id);
    const s = summariseBarDay(byProduct.get(pid) || [], d0, d1);
    let soldMl, breakageMl, complimentaryMl, partyMl, physicalMl, varianceMl;
    if (closed) {
      ({ soldMl, breakageMl, complimentaryMl, partyMl } = s); physicalMl = s.balanceEndMl; varianceMl = s.countAdjMl;
    } else {
      soldMl = round3(Number(soldMlByKey.get(pid)) || 0);
      const o = other.get(pid) || {};
      breakageMl = round3(o.breakage || 0); complimentaryMl = round3(o.complimentary || 0); partyMl = round3(o.party || 0);
      physicalMl = counts.has(pid) ? counts.get(pid) : null;
    }
    const expectedMl = expectedClosing({ openingMl: s.openingMl, receivedMl: s.receivedMl, soldMl, breakageMl, complimentaryMl, partyMl });
    if (!closed) varianceMl = physicalMl === null ? null : round3(physicalMl - expectedMl);
    const active = s.openingMl !== 0 || s.receivedMl !== 0 || soldMl !== 0 || breakageMl !== 0 || complimentaryMl !== 0 || partyMl !== 0 || physicalMl !== null;
    if (!active) continue;
    const cpm = costPerMl(Number(p.currentPrice ?? p.purchasePrice) || 0, unitMl);
    rows.push({
      productId: pid, productName: p.name, brandName: p.brandName || "", alcoholType: p.baseCategoryName || "", unitMl,
      openingMl: s.openingMl, receivedMl: s.receivedMl, soldMl, breakageMl, complimentaryMl, partyMl, expectedMl,
      physicalMl, varianceMl, status: varianceStatus(varianceMl, tolerance),
      varianceValue: varianceMl === null ? null : round2(varianceMl * cpm), costPerMl: cpm, barPar: Number(p.barParLevel) || 0,
    });
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName));
  const val = (f) => round2(rows.filter(f).reduce((t, r) => t + (r.varianceValue || 0), 0));
  const summary = {
    products: rows.length, counted: rows.filter((r) => r.physicalMl !== null).length, uncounted: rows.filter((r) => r.status === "uncounted").length,
    ok: rows.filter((r) => r.status === "ok").length, short: rows.filter((r) => r.status === "short").length, excess: rows.filter((r) => r.status === "excess").length,
    shortValue: val((r) => (r.varianceValue || 0) < 0), excessValue: val((r) => (r.varianceValue || 0) > 0), netValue: val(() => true),
  };
  return { rows, summary, closed };
}

async function loadRegister(dateStr, tolerance) {
  const ctx = await loadContext();
  const d0 = dayStartOf(dateStr), d1 = new Date(d0.getTime() + DAY);
  const [movements, dayDoc, saleDoc, sold] = await Promise.all([
    AlcoholStockMovement.find({ location: "bar", date: { $lt: d1 } }).lean(),
    AlcoholBarDay.findOne({ date: d0 }).lean(),
    AlcoholDailySale.findOne({ date: d0 }).lean(),
    // what the day's sale lines poured, per product: ml and amount
    AlcoholSaleLine.aggregate([{ $match: { day: dateStr } }, { $group: { _id: "$productKey", ml: { $sum: "$ml" }, amount: { $sum: "$amount" } } }]),
  ]);
  const soldMlByKey = new Map(sold.map((g) => [String(g._id), g.ml]));
  const hasSales = !!saleDoc || sold.length > 0;       // a saved day with no lines is a real answer: "nothing sold"
  const salesMl = round3(sold.reduce((t, g) => t + g.ml, 0)), salesAmount = Math.round(sold.reduce((t, g) => t + g.amount, 0) * 100) / 100;
  return { ctx, dayDoc, saleDoc, hasSales, salesMl, salesAmount, ...buildRegister(ctx, dateStr, movements, dayDoc, soldMlByKey, tolerance) };
}

const readTolerance = (q) => (q !== undefined && q !== "" && Number.isFinite(Number(q)) && Number(q) >= 0 ? Number(q) : DEFAULT_TOLERANCE_ML);

// Dates must be real calendar dates. Tracking must have started — but any date is allowed, back dates included.
async function checkDay(dateStr, ctx) {
  if (!isRealDate(dateStr)) return { error: "A valid date (YYYY-MM-DD) is required." };
  if (!ctx.startDate) return { error: "Start tracking first — set the opening stock." };
  return {};
}

// GET /alcohol-bar/register?date=YYYY-MM-DD[&tolerance=30]
export const getRegister = async (req, res) => {
  const tolerance = readTolerance(req.query.tolerance);
  const ctx0 = await loadContext();
  const bad = await checkDay(req.query.date, ctx0);
  if (bad.error) return sendError(res, bad.error);
  const date = req.query.date;
  const r = await loadRegister(date, tolerance);
  const d0 = dayStartOf(date);
  const [earlierOpen, earlierSales, closedDays] = await Promise.all([
    AlcoholBarDay.find({ status: "open", date: { $lt: d0 } }).lean(),
    AlcoholDailySale.find({ date: { $lt: d0 } }).select({ date: 1 }).lean(),
    AlcoholBarDay.find({ status: "closed" }).select({ date: 1 }).lean(),
  ]);
  const closedKeys = new Set(closedDays.map((d) => dayKey(d.date)));
  const blockedBy = r.closed ? null : firstBlockingDay(earlierOpen.map((d) => d.date), earlierSales.map((d) => d.date), closedKeys, date);
  const laterClosed = closedDays.some((d) => dayKey(d.date) > date);
  return sendSuccess(res, {
    date, started: true, status: r.closed ? "closed" : "open", closedAt: r.dayDoc?.closedAt || null,
    hasSales: r.hasSales, salesMl: r.salesMl, salesAmount: r.salesAmount,
    blockedBy, canReopen: r.closed && !laterClosed, tolerance,
    reopenedAt: r.dayDoc?.reopenedAt || null, reopenReason: r.dayDoc?.reopenReason || "",
    outflows: (r.dayDoc?.outflows || []).map((o) => ({ productId: String(o.productId), type: o.type, ml: o.ml, remark: o.remark || "" })),
    rows: r.rows, summary: r.summary,
  });
};

// PUT /alcohol-bar/day { date, counts:[{productId,bottles,looseMl}], outflows:[{productId,type,bottles,looseMl,remark}] }
// Saves the DRAFT of an open day (replacing the previous draft).
export const saveDay = async (req, res) => {
  const { date, counts, outflows } = req.body || {};
  const ctx = await loadContext();
  const bad = await checkDay(date, ctx);
  if (bad.error) return sendError(res, bad.error);
  const lastClosed = await lastClosedDayKey();
  if (lastClosed && date <= lastClosed) return sendError(res, `The bar day ${lastClosed} is closed — ${date === lastClosed ? "reopen it to change it" : "this date is before it"}.`, 409);
  if ((counts !== undefined && !Array.isArray(counts)) || (outflows !== undefined && !Array.isArray(outflows))) return sendError(res, "counts and outflows must be lists.");

  const cOut = new Map();
  for (const c of counts || []) {
    const item = ctx.byId.get(String(c?.productId));
    if (!item || item.unitMl == null) return sendError(res, "A counted product was not found or has no bottle unit.");
    const b = Number(c.bottles || 0), l = Number(c.looseMl || 0);
    if (!Number.isFinite(b) || !Number.isFinite(l) || b < 0 || l < 0) return sendError(res, `Count for ${item.product.name}: bottles and loose ml must be 0 or more.`);
    cOut.set(String(item.product._id), { productId: item.product._id, physicalMl: toMl({ bottles: b, looseMl: l }, item.unitMl) });
  }
  const oOut = [];
  for (const o of outflows || []) {
    const item = ctx.byId.get(String(o?.productId));
    if (!item || item.unitMl == null) return sendError(res, "A product in the other uses was not found or has no bottle unit.");
    const err = validateOutflow(o);
    if (err) return sendError(res, `${item.product.name}: ${err}`);
    const ml = toMl({ bottles: o.bottles, looseMl: o.looseMl }, item.unitMl);
    if (ml <= 0) return sendError(res, `${item.product.name}: enter a quantity greater than 0.`);
    oOut.push({ productId: item.product._id, type: o.type, ml, remark: String(o.remark || "").trim() });
  }

  const d0 = dayStartOf(date);
  const doc = await AlcoholBarDay.findOne({ date: d0 });
  if (doc) {
    if (doc.status === "closed") return sendError(res, `The bar day ${date} is closed — reopen it to change it.`, 409);
    if (counts !== undefined) doc.counts = [...cOut.values()];
    if (outflows !== undefined) doc.outflows = oOut;
    doc.updatedBy = uid(req);
    await doc.save();
  } else {
    await AlcoholBarDay.create({ date: d0, status: "open", counts: [...cOut.values()], outflows: oOut, updatedBy: uid(req) });
  }
  return sendSuccess(res, { date, counts: cOut.size, outflows: oOut.length }, "Draft saved.");
};

// POST /alcohol-bar/close { date, confirmNoSales? }
export const closeDay = async (req, res) => {
  const { date, confirmNoSales } = req.body || {};
  const ctx = await loadContext();
  const bad = await checkDay(date, ctx);
  if (bad.error) return sendError(res, bad.error);
  const d0 = dayStartOf(date);
  const doc = await AlcoholBarDay.findOne({ date: d0 });
  if (doc?.status === "closed") return sendError(res, `The bar day ${date} is already closed.`, 409);

  const [earlierOpen, earlierSales, closedDays] = await Promise.all([
    AlcoholBarDay.find({ status: "open", date: { $lt: d0 } }).lean(),
    AlcoholDailySale.find({ date: { $lt: d0 } }).select({ date: 1 }).lean(),
    AlcoholBarDay.find({ status: "closed" }).select({ date: 1 }).lean(),
  ]);
  const blocked = firstBlockingDay(earlierOpen.map((d) => d.date), earlierSales.map((d) => d.date), new Set(closedDays.map((d) => dayKey(d.date))), date);
  if (blocked) return sendError(res, `Close ${blocked} first — a day can only be closed after the days before it.`, 409);
  if (closedDays.some((d) => dayKey(d.date) > date)) return sendError(res, "A later day is already closed.", 409);

  const r = await loadRegister(date, DEFAULT_TOLERANCE_ML);
  if (!r.hasSales && !confirmNoSales) return sendError(res, "No sales have been entered for this day — close it anyway?", 409);
  if (r.rows.length === 0) return sendError(res, "There is nothing to close — no stock at the bar and no activity on this day.", 400);
  const missing = r.rows.filter((x) => x.physicalMl === null);
  if (missing.length) return sendError(res, `Count missing for ${missing.slice(0, 5).map((x) => x.productName).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""} (${missing.length}).`);

  const outByKey = new Map();
  (doc?.outflows || []).forEach((o) => { const k = `${o.productId}|${o.type}`; const x = outByKey.get(k) || { productId: o.productId, type: o.type, ml: 0, remarks: [] }; x.ml += o.ml; if (o.remark) x.remarks.push(o.remark); outByKey.set(k, x); });
  const nameOf = new Map(r.rows.map((x) => [x.productId, x.productName]));
  const base = (pid) => ({ productId: pid, productName: nameOf.get(String(pid)) || "", date: d0, location: "bar", refType: "day-close", refId: date, createdBy: uid(req) });
  const made = [];
  try {
    for (const row of r.rows) {
      if (row.soldMl > EPS) made.push(await AlcoholStockMovement.create({ ...base(row.productId), type: "sale", qtyMl: -row.soldMl, remark: "Daily sales" }));
    }
    for (const o of outByKey.values()) {
      made.push(await AlcoholStockMovement.create({ ...base(o.productId), type: o.type, qtyMl: -round3(o.ml), remark: o.remarks.join("; ") || (o.type[0].toUpperCase() + o.type.slice(1)) }));
    }
    for (const row of r.rows) {
      if (Math.abs(row.varianceMl) > EPS) made.push(await AlcoholStockMovement.create({ ...base(row.productId), type: "bar-count", qtyMl: row.varianceMl, remark: `Closing count: ${row.varianceMl < 0 ? "short" : "excess"} ${textOf(Math.abs(row.varianceMl), row.unitMl)}` }));
    }
  } catch (e) {
    await AlcoholStockMovement.deleteMany({ refType: "day-close", refId: date });          // nothing half-written
    return sendError(res, "Could not close the day — nothing was changed. Please try again.", 500);
  }
  if (doc) { doc.status = "closed"; doc.closedAt = new Date(); doc.closedBy = uid(req); doc.updatedBy = uid(req); await doc.save(); }
  else await AlcoholBarDay.create({ date: d0, status: "closed", counts: r.rows.map((x) => ({ productId: x.productId, physicalMl: x.physicalMl })), closedAt: new Date(), closedBy: uid(req), updatedBy: uid(req) });
  return sendSuccess(res, { date, rows: made.length, summary: r.summary }, `Bar day ${date} closed.`, 201);
};

// POST /alcohol-bar/reopen { date, reason } — only the LATEST closed day; removes exactly the rows that closing wrote
export const reopenDay = async (req, res) => {
  const { date, reason } = req.body || {};
  if (!isRealDate(date)) return sendError(res, "A valid date (YYYY-MM-DD) is required.");
  const why = String(reason || "").trim();
  if (why.length < 3) return sendError(res, "A reason is required (at least 3 characters).");
  const d0 = dayStartOf(date);
  const doc = await AlcoholBarDay.findOne({ date: d0 });
  if (!doc || doc.status !== "closed") return sendError(res, `The bar day ${date} is not closed.`, 409);
  const later = await AlcoholBarDay.find({ status: "closed", date: { $gt: d0 } }).lean();
  if (later.length) return sendError(res, `Reopen ${dayKey(later.sort((a, b) => new Date(b.date) - new Date(a.date))[0].date)} first — only the latest closed day can be reopened.`, 409);
  const del = await AlcoholStockMovement.deleteMany({ refType: "day-close", refId: date });
  doc.status = "open"; doc.closedAt = null; doc.reopenedAt = new Date(); doc.reopenedBy = uid(req); doc.reopenReason = why; doc.updatedBy = uid(req);
  await doc.save();
  return sendSuccess(res, { date, removedRows: del.deletedCount ?? 0 }, `Bar day ${date} reopened.`);
};

// POST /alcohol-bar/issues { date, remark?, lines:[{productId,bottles,looseMl}] } — one note, several products
export const createIssue = async (req, res) => {
  const { date, remark, lines } = req.body || {};
  const ctx = await loadContext();
  const bad = await checkDay(date, ctx);
  if (bad.error) return sendError(res, bad.error);
  if (!Array.isArray(lines) || lines.length === 0) return sendError(res, "Add at least one product to the issue note.");
  if (lines.length > 200) return sendError(res, "At most 200 lines per note.");
  const lastClosed = await lastClosedDayKey();
  if (lastClosed && date <= lastClosed) return sendError(res, `The bar day ${lastClosed} is already closed — issue on a later date.`, 409);

  // all lines are checked BEFORE anything is written; the same product twice in one note is added up
  const per = new Map();
  for (const ln of lines) {
    const item = ctx.byId.get(String(ln?.productId));
    if (!item) return sendError(res, "A product on the note was not found.");
    if (item.unitMl == null) return sendError(res, `${item.product.name} has no bottle unit yet.`);
    const b = Number(ln.bottles || 0), l = Number(ln.looseMl || 0);
    if (!Number.isFinite(b) || !Number.isFinite(l) || b < 0 || l < 0) return sendError(res, `${item.product.name}: bottles and loose ml must be 0 or more.`);
    const ml = toMl({ bottles: b, looseMl: l }, item.unitMl);
    if (ml <= 0) return sendError(res, `${item.product.name}: enter a quantity greater than 0.`);
    const k = String(item.product._id);
    per.set(k, { item, ml: round3((per.get(k)?.ml || 0) + ml) });
  }
  const when = dayStartOf(date);
  for (const { item, ml } of per.values()) {
    const { asOf, available } = await storeOutflowLimit(item.product._id, when);
    if (ml > available + EPS) {
      return sendError(res, available + EPS >= asOf
        ? `${item.product.name}: only ${textOf(Math.max(asOf, 0), item.unitMl)} in store on that date — cannot issue ${textOf(ml, item.unitMl)}.`
        : `${item.product.name}: only ${textOf(Math.max(available, 0), item.unitMl)} can be taken out on that date — a later day's stock would go below zero.`, 409);
    }
  }

  const noteNo = await nextNoteNo(date);
  const made = [];
  for (const { item, ml } of per.values()) {
    const transferId = new mongoose.Types.ObjectId().toString();
    const base = { productId: item.product._id, productName: item.product.name, date: when, refType: "transfer", refId: transferId, transferId, noteId: noteNo, remark: String(remark || "").trim(), createdBy: uid(req) };
    await AlcoholStockMovement.create({ ...base, location: "store", type: "transfer-out", qtyMl: -ml });
    await AlcoholStockMovement.create({ ...base, location: "bar", type: "transfer-in", qtyMl: ml });
    made.push({ productId: String(item.product._id), productName: item.product.name, ml });
  }
  return sendSuccess(res, { noteNo, lines: made }, `Issue note ${noteNo}: ${made.length} product${made.length === 1 ? "" : "s"} sent to the bar.`, 201);
};

// GET /alcohol-bar/issues?from&to — the issue register, built from the ledger
export const getIssues = async (req, res) => {
  const { from, to } = req.query;
  if (!isRealDate(from) || !isRealDate(to)) return sendError(res, "'from' and 'to' dates (YYYY-MM-DD) are required.");
  if (from > to) return sendError(res, "'from' must not be after 'to'.");
  const ctx = await loadContext();
  const rows = await AlcoholStockMovement.find({ type: "transfer-out", location: "store", date: { $gte: dayStartOf(from), $lt: new Date(dayStartOf(to).getTime() + DAY) } }).sort({ date: 1, createdAt: 1 }).lean();
  const notes = new Map();
  rows.forEach((m) => {
    const key = m.noteId || `T-${String(m.transferId).slice(-6)}`;
    const n = notes.get(key) || { noteNo: m.noteId || "", key, date: dayKey(m.date), remark: m.remark || "", lines: [], totalMl: 0 };
    const item = ctx.byId.get(String(m.productId));
    n.lines.push({ productId: String(m.productId), productName: m.productName || item?.product.name || "", unitMl: item?.unitMl ?? null, ml: round3(-m.qtyMl) });
    n.totalMl = round3(n.totalMl + -m.qtyMl);
    notes.set(key, n);
  });
  const out = [...notes.values()];
  return sendSuccess(res, { notes: out, count: out.length, lines: out.reduce((t, n) => t + n.lines.length, 0) });
};

// GET /alcohol-bar/variance?from&to — sales vs actual use, over CLOSED days (those are the days in the ledger)
export const getVariance = async (req, res) => {
  const { from, to } = req.query;
  if (!isRealDate(from) || !isRealDate(to)) return sendError(res, "'from' and 'to' dates (YYYY-MM-DD) are required.");
  if (from > to) return sendError(res, "'from' must not be after 'to'.");
  const ctx = await loadContext();
  const d0 = dayStartOf(from), d1 = new Date(dayStartOf(to).getTime() + DAY);
  const [movements, closedDays] = await Promise.all([
    AlcoholStockMovement.find({ location: "bar", date: { $lt: d1 } }).lean(),
    AlcoholBarDay.find({ status: "closed", date: { $gte: d0, $lt: d1 } }).lean(),
  ]);
  const byProduct = new Map();
  movements.forEach((m) => { const k = String(m.productId); if (!byProduct.has(k)) byProduct.set(k, []); byProduct.get(k).push(m); });
  const rows = [];
  for (const { product: p, unitMl } of ctx.items) {
    if (unitMl == null) continue;
    const s = summariseBarDay(byProduct.get(String(p._id)) || [], d0, d1);
    const otherMl = round3(s.breakageMl + s.complimentaryMl + s.partyMl);
    if (s.receivedMl === 0 && s.soldMl === 0 && otherMl === 0 && s.countAdjMl === 0 && s.openingMl === 0) continue;
    const cpm = costPerMl(Number(p.currentPrice ?? p.purchasePrice) || 0, unitMl);
    const theoreticalMl = round3(s.soldMl + otherMl);
    rows.push({
      productId: String(p._id), productName: p.name, brandName: p.brandName || "", alcoholType: p.baseCategoryName || "", unitMl,
      openingMl: s.openingMl, receivedMl: s.receivedMl, soldMl: s.soldMl, breakageMl: s.breakageMl, complimentaryMl: s.complimentaryMl, partyMl: s.partyMl,
      varianceMl: s.countAdjMl, closingMl: s.balanceEndMl, theoreticalMl, actualMl: round3(s.openingMl + s.receivedMl - s.balanceEndMl),
      variancePct: theoreticalMl > 0 ? round2((s.countAdjMl / theoreticalMl) * 100) : null, varianceValue: round2(s.countAdjMl * cpm),
    });
  }
  rows.sort((a, b) => a.productName.localeCompare(b.productName));
  const sum = (k) => round3(rows.reduce((t, r) => t + r[k], 0));
  const shortValue = round2(rows.filter((r) => r.varianceValue < 0).reduce((t, r) => t + r.varianceValue, 0));
  const excessValue = round2(rows.filter((r) => r.varianceValue > 0).reduce((t, r) => t + r.varianceValue, 0));
  return sendSuccess(res, {
    from, to, closedDays: closedDays.length, rows,
    totals: { soldMl: sum("soldMl"), theoreticalMl: sum("theoreticalMl"), actualMl: sum("actualMl"), varianceMl: sum("varianceMl"), shortValue, excessValue, netValue: round2(shortValue + excessValue) },
  });
};

// ── consumption grid: ?view=day|month|year&from=YYYY-MM-DD[&to=YYYY-MM-DD] ─────────────────────────────────────
//   day  — one date, split into the hours it sold in;  month — the days from..to;  year — the months from..to
export const getConsumptionGrid = async (req, res) => {
  const view = String(req.query.view || "");
  if (!GRID_VIEWS.includes(view)) return sendError(res, `view must be one of: ${GRID_VIEWS.join(", ")}.`);
  const from = String(req.query.from || ""), to = view === "day" ? from : String(req.query.to || "");
  if (!isRealDate(from) || !isRealDate(to)) return sendError(res, "'from' and 'to' dates (YYYY-MM-DD) are required.");
  if (from > to) return sendError(res, "'from' must not be after 'to'.");
  if (view === "month" && gridBuckets("month", from, to).length > MAX_GRID_DAYS) return sendError(res, `The monthly view shows at most ${MAX_GRID_DAYS} days.`);
  if (view === "year" && gridBuckets("year", from, to).length > MAX_GRID_MONTHS) return sendError(res, `The yearly view shows at most ${MAX_GRID_MONTHS} months.`);
  const ctx = await loadContext();
  const d1 = new Date(dayStartOf(to).getTime() + DAY);
  const [barMovements, lines, closedDays] = await Promise.all([
    AlcoholStockMovement.find({ location: "bar", date: { $lt: d1 } }).lean(),
    AlcoholSaleLine.find({ day: { $gte: from, $lte: to } }).lean(),
    AlcoholBarDay.find({ status: "closed", date: { $gte: dayStartOf(from), $lt: d1 } }).lean(),
  ]);
  const products = ctx.items.filter((i) => i.unitMl != null).map(({ product: p, unitMl }) => ({ productId: String(p._id), productName: p.name, alcoholType: p.baseCategoryName || "", unitMl }));
  const grid = buildConsumptionGrid({ view, from, to, products, barMovements, lines });
  return sendSuccess(res, { view, from, to, closedDays: closedDays.length, ...grid });
};

 