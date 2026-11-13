import { randomUUID } from "crypto";
import { AlcoholDailySale } from "../Model/AlcoholDailySales.model.js";
import { AlcoholSaleLine } from "../Model/AlcoholSalesLine.modal.js";
import { AlcoholBarDay } from "../Model/AlcoholBarDay.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { round3, normName } from "../Utils/AlcoholStock.js";
import { round2, dayKey, dayStartOf, costPerMl } from "../Utils/AlcoholBar.js";
import {
  MAX_DAY_LINES, MAX_IMPORT_ROWS, isRealDate, isRealMonth, growthPct, previousDay, previousMonthKey, monthDayKeys, yearMonthKeys, yearLabel,
  validateSaleLine, dedupe, sortLines, periodRows, keyTotals, sumRows, bestOf, totalsOfLines, hoursSummary, modeSummary, billCount, zeroTotals, roundTotals,
} from "../Utils/AlcoholSalesView.js";
import { daysBetween } from "../Utils/AlcoholStockReport.js";
import { loadContext } from "./AlcoholStock.controller.js";

// ─────────────────────────────────────────────────────────────────────────────
// DAILY ALCOHOL SALES. A sale is one LINE of a POS bill — bill no, time, order no, steward, the alcohol, a MEASURE
// (a volume UOM: Peg, Wine Glass, Wine Bottle, Beer Bottle …), qty, discount, settlement mode, amount. One document
// per line (AlcoholSaleLine); AlcoholDailySale is only the day's header (POS total, notes, totals).
// Sales reach the stock ledger when the bar day is CLOSED; a closed day's sales are locked.
// ─────────────────────────────────────────────────────────────────────────────
const uid = (req) => req.user?.userId ?? null;
const DAY = 24 * 3600 * 1000;
const DEFAULT_MODES = ["CASH", "CARD", "UPI", "PAYTM"];
const priceOf = (p) => Number(p.currentPrice ?? p.purchasePrice) || 0;

async function checkDate(dateStr, ctx) {
  if (!isRealDate(dateStr)) return "A valid date (YYYY-MM-DD) is required.";
  if (!ctx.startDate) return "Start tracking first — set the opening stock.";
  return "";
}

// What a sale can be measured in: the UOMs whose type is VOLUME (Peg, Wine Glass, Beer Bottle, Litre …), smallest first.
export const measuresOf = (ctx) => ctx.uoms
  .filter((u) => u.type === "volume" && Number(u.baseFactor) > 0 && u.isActive !== false)
  .map((u) => ({ uomId: String(u._id), name: u.name, ml: Number(u.baseFactor) }))
  .sort((a, b) => a.ml - b.ml || a.name.localeCompare(b.name));

const lineCtx = (ctx, minDate) => {
  const ms = new Map(measuresOf(ctx).map((m) => [m.uomId, m]));
  return {
    minDate,
    productOf: (id) => {
      const item = ctx.byId.get(String(id));
      if (!item) return null;
      if (item.unitMl == null) return { error: `${item.product.name} has no bottle unit yet.` };
      return { id: item.product._id, key: String(item.product._id), name: item.product.name };
    },
    measureOf: (id) => { const m = ms.get(String(id)); return m ? { id: m.uomId, name: m.name, ml: m.ml } : null; },
  };
};

const toApiLine = (l) => ({
  _id: String(l._id), date: l.day, billNo: l.billNo || "", time: l.time || "", hour: l.hour ?? null, orderNo: l.orderNo || "", steward: l.steward || "",
  productId: String(l.productId), productName: l.productName || "", uomId: String(l.uomId), uomName: l.uomName || "",
  qty: l.qty, discPct: l.discPct || 0, discAmt: l.discAmt || 0, settMode: l.settMode || "", amount: l.amount || 0, ml: l.ml || 0,
});

const aggTotals = async (match) => {
  const [g] = await AlcoholSaleLine.aggregate([{ $match: match }, { $group: { _id: null, qty: { $sum: "$qty" }, ml: { $sum: "$ml" }, discAmt: { $sum: "$discAmt" }, amount: { $sum: "$amount" }, lines: { $sum: 1 } } }]);
  return g ? roundTotals(g) : roundTotals(zeroTotals());
};
const groupPeriod = (match, field, split) => AlcoholSaleLine.aggregate([
  { $match: match },
  { $group: { _id: split ? { k: `$${field}`, p: "$productKey" } : { k: `$${field}` }, productName: { $first: "$productName" }, qty: { $sum: "$qty" }, ml: { $sum: "$ml" }, discAmt: { $sum: "$discAmt" }, amount: { $sum: "$amount" }, lines: { $sum: 1 } } },
]);

// the type / brand / product filters, turned into the list of product keys they allow (null = no filter)
const filterIds = (ctx, q) => {
  const { type, brand, productId } = q;
  if (!(type || brand || productId)) return null;
  return ctx.items.filter(({ product: p }) => (!productId || String(p._id) === String(productId)) && (!type || normName(p.baseCategoryName) === normName(type)) && (!brand || normName(p.brandName) === normName(brand))).map((i) => String(i.product._id));
};
const withIds = (match, ids) => (ids ? { ...match, productKey: { $in: ids } } : match);
const nameOfKey = (ctx, key, fallback) => ctx.byId.get(String(key))?.product.name || fallback || "";

// refresh a day's header from its lines (and set the POS total / notes when given)
async function refreshHeader(d0, dateStr, fields, req) {
  const t = await aggTotals({ day: dateStr });
  const data = { lineCount: t.lines, totalQty: t.qty, totalMl: t.ml, totalDiscount: t.discAmt, totalAmount: t.amount, updatedBy: uid(req), ...fields };
  const doc = await AlcoholDailySale.findOne({ date: d0 });
  if (doc) { Object.assign(doc, data); await doc.save(); } else await AlcoholDailySale.create({ date: d0, ...data, createdBy: uid(req) });
  return t;
}
// write a batch of new lines; if anything fails part-way, take back what was written
async function insertBatch(docs, batchId) {
  if (!docs.length) return;
  try { await AlcoholSaleLine.insertMany(docs); } catch (e) { await AlcoholSaleLine.deleteMany({ batchId }); throw e; }
}
const asDoc = (l, d0, batchId, source, req) => ({ ...l, date: d0, batchId, source, createdBy: uid(req) });

// GET /alcohol-sales/meta — what the pages need to fill their selects
export const getSalesMeta = async (req, res) => {
  const ctx = await loadContext();
  const [modes, stewards] = await Promise.all([AlcoholSaleLine.aggregate([{ $group: { _id: "$settMode" } }]), AlcoholSaleLine.aggregate([{ $group: { _id: "$steward" } }])]);
  const products = ctx.items.filter((i) => i.unitMl != null).map(({ product: p, unitMl }) => ({ productId: String(p._id), productName: p.name, brandName: p.brandName || "", alcoholType: p.baseCategoryName || "", unitMl }))
    .sort((a, b) => a.productName.localeCompare(b.productName));
  return sendSuccess(res, {
    started: !!ctx.startDate, startDate: ctx.startDate ? dayKey(ctx.startDate) : null, measures: measuresOf(ctx), products,
    settModes: [...new Set([...DEFAULT_MODES, ...modes.map((m) => m._id).filter(Boolean)])].sort(),
    stewards: stewards.map((s) => s._id).filter(Boolean).sort((a, b) => a.localeCompare(b)).slice(0, 300),
  });
};

// a day's header and all its lines, in the shape both GET /day and PUT /day return
async function loadDay(date) {
  const d0 = dayStartOf(date);
  const [doc, lines, barDay] = await Promise.all([AlcoholDailySale.findOne({ date: d0 }).lean(), AlcoholSaleLine.find({ day: date }).lean(), AlcoholBarDay.findOne({ date: d0 }).lean()]);
  const sorted = sortLines(lines).map(toApiLine);
  return { date, saved: !!doc || lines.length > 0, locked: barDay?.status === "closed", posTotal: doc?.posTotal ?? null, notes: doc?.notes || "", lines: sorted, totals: { ...totalsOfLines(sorted), bills: billCount(sorted) } };
}

// GET /alcohol-sales/day?date=YYYY-MM-DD — a day's header and all its lines
export const getSalesDay = async (req, res) => {
  const { date } = req.query;
  const ctx = await loadContext();
  const bad = await checkDate(date, ctx);
  if (bad) return sendError(res, bad);
  return sendSuccess(res, await loadDay(date));
};

// PUT /alcohol-sales/day { date, posTotal?, notes?, lines:[{ billNo, time, orderNo, steward, productId, uomId, qty, discPct, discAmt, settMode, amount }] }
// Replaces the day's lines and returns the saved day (the same shape as GET /day). An empty list is a real answer — "nothing alcoholic was sold today".
export const saveSalesDay = async (req, res) => {
  const { date, lines, posTotal, notes } = req.body || {};
  const ctx = await loadContext();
  const bad = await checkDate(date, ctx);
  if (bad) return sendError(res, bad);
  if (!Array.isArray(lines)) return sendError(res, "lines must be a list.");
  if (lines.length > MAX_DAY_LINES) return sendError(res, `At most ${MAX_DAY_LINES.toLocaleString("en-IN")} lines in a day.`);
  if (posTotal !== undefined && posTotal !== null && posTotal !== "" && !(Number.isFinite(Number(posTotal)) && Number(posTotal) >= 0)) return sendError(res, "The POS total must be 0 or more.");
  const d0 = dayStartOf(date);
  const barDay = await AlcoholBarDay.findOne({ date: d0 }).lean();
  if (barDay?.status === "closed") return sendError(res, `The bar day ${date} is closed — reopen it in Bar Allocation to change its sales.`, 409);

  const vctx = lineCtx(ctx, null);                                // no date floor: back dates are allowed
  const batchId = randomUUID(); const out = [];
  for (let i = 0; i < lines.length; i++) {
    const v = validateSaleLine({ ...(lines[i] || {}), date }, vctx);
    if (v.error) return sendError(res, `Row ${i + 1}: ${v.error}`);
    out.push(asDoc(v.line, d0, batchId, "manual", req));
  }
  await insertBatch(out, batchId);
  await AlcoholSaleLine.deleteMany({ day: date, batchId: { $ne: batchId } });          // the previous lines of the day
  const pos = posTotal === undefined || posTotal === null || posTotal === "" ? null : Number(posTotal);
  const t = await refreshHeader(d0, date, { posTotal: pos, notes: String(notes || "").trim() }, req);
  return sendSuccess(res, await loadDay(date), `Sales saved: ${t.lines} line${t.lines === 1 ? "" : "s"}, ₹${t.amount.toLocaleString("en-IN")}.`);
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /alcohol-sales/import { dryRun?, mode: "replace" | "add", rows: [{ date, time, billNo, orderNo, steward, productId, uomId, qty, discPct, discAmt, settMode, amount }] }
// A POS file, already read and matched to products and measures by the page. One call can cover many days.
// `dryRun` checks everything and writes nothing. A day whose bar day is CLOSED is skipped (its sales are locked).
// "replace" swaps a day's lines for the file's; "add" adds the file's lines, skipping any the day already holds
// (so importing the same file twice never doubles a day).
// ─────────────────────────────────────────────────────────────────────────────
export const importSales = async (req, res) => {
  const { rows, mode = "replace" } = req.body || {};
  const dryRun = req.body?.dryRun === true;
  if (!Array.isArray(rows) || rows.length === 0) return sendError(res, "rows must be a non-empty list.");
  if (rows.length > MAX_IMPORT_ROWS) return sendError(res, `At most ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} rows at a time.`);
  if (!["replace", "add"].includes(mode)) return sendError(res, "mode must be replace or add.");
  const ctx = await loadContext();
  if (!ctx.startDate) return sendError(res, "Start tracking first — set the opening stock.");
  const vctx = lineCtx(ctx, null);                                // no date floor: back dates are allowed

  const byDay = new Map(); const errors = []; let rejected = 0; let accepted = 0;
  rows.forEach((r, index) => {
    const v = validateSaleLine(r, vctx);
    if (v.error) { rejected++; if (errors.length < 50) errors.push({ index, error: v.error }); return; }
    accepted++;
    if (!byDay.has(v.line.day)) byDay.set(v.line.day, []);
    byDay.get(v.line.day).push(v.line);
  });

  const dates = [];
  for (const [date, incoming] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const d0 = dayStartOf(date);
    const ft = totalsOfLines(incoming);
    const info = { date, rows: incoming.length, bills: billCount(incoming), products: new Set(incoming.map((l) => l.productKey)).size, qty: ft.qty, ml: ft.ml, discAmt: ft.discAmt, amount: ft.amount, duplicates: 0, existing: 0, writing: incoming.length };
    const barDay = await AlcoholBarDay.findOne({ date: d0 }).lean();
    if (barDay?.status === "closed") { dates.push({ ...info, status: "skipped-closed" }); continue; }

    let toWrite = incoming;
    info.existing = await AlcoholSaleLine.countDocuments({ day: date });          // what the day holds now
    if (mode === "add") {
      const existing = await AlcoholSaleLine.find({ day: date }).lean();
      const d = dedupe(existing, incoming);
      toWrite = d.fresh; info.duplicates = d.duplicates; info.writing = d.fresh.length;
    }
    if (!dryRun) {
      const batchId = randomUUID();
      await insertBatch(toWrite.map((l) => asDoc(l, d0, batchId, "import", req)), batchId);
      if (mode === "replace") await AlcoholSaleLine.deleteMany({ day: date, batchId: { $ne: batchId } });
      await refreshHeader(d0, date, {}, req);
    }
    dates.push({ ...info, status: dryRun ? "would-save" : "saved" });
  }
  const count = (st) => dates.filter((d) => d.status === st).length;
  const done = dryRun ? count("would-save") : count("saved");
  const savedRows = dates.filter((d) => d.status !== "skipped-closed").reduce((t, d) => t + d.writing, 0);      // rows on a skipped day, and duplicates, do not count
  const dups = dates.reduce((t, d) => t + d.duplicates, 0);
  const tail = dups ? ` (${dups} duplicate line${dups === 1 ? "" : "s"} skipped)` : "";
  return sendSuccess(res, {
    dryRun, mode, rowsReceived: rows.length, rowsAccepted: accepted, rowsRejected: rejected, errors, dates,
    summary: { days: dates.length, saved: done, skippedClosed: count("skipped-closed"), duplicates: dups },
  }, dryRun ? `Checked ${savedRows} line${savedRows === 1 ? "" : "s"} — ${done} day${done === 1 ? "" : "s"} ready to import${tail}.` : `Imported ${savedRows} line${savedRows === 1 ? "" : "s"} into ${done} day${done === 1 ? "" : "s"}${tail}.`);
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /alcohol-sales/view?level=year&year=2026[&yearType=fy|calendar]  |  level=month&month=YYYY-MM  |  level=day&date=YYYY-MM-DD
//   optional: split=false (one row per month/day instead of one per month/day × alcohol), type, brand, productId
// The listing page. year → a row per month, month → a row per day, day → the bill lines themselves (with an hour summary).
// Every figure is a grouping of the same saved lines, so each level adds up to the level above it.
// ─────────────────────────────────────────────────────────────────────────────
export const getSalesView = async (req, res) => {
  const { level } = req.query;
  if (!["year", "month", "day"].includes(level)) return sendError(res, "level must be year, month or day.");
  const split = req.query.split !== "false";
  const ctx = await loadContext();
  const ids = filterIds(ctx, req.query);
  const filters = { type: req.query.type || null, brand: req.query.brand || null, productId: req.query.productId || null };
  const named = (rows) => rows.map((r) => (r.productId ? { ...r, productName: nameOfKey(ctx, r.productId, r.productName) } : r)).sort((a, b) => a.key.localeCompare(b.key) || (a.productName || "").localeCompare(b.productName || ""));

  if (level === "day") {
    const { date } = req.query;
    if (!isRealDate(date)) return sendError(res, "A valid date (YYYY-MM-DD) is required.");
    const prevDate = previousDay(date), d0 = dayStartOf(date);
    const [doc, docs, barDay, prev] = await Promise.all([
      AlcoholDailySale.findOne({ date: d0 }).lean(), AlcoholSaleLine.find(withIds({ day: date }, ids)).lean(), AlcoholBarDay.findOne({ date: d0 }).lean(), aggTotals(withIds({ day: prevDate }, ids)),
    ]);
    const lines = sortLines(docs).map((l) => ({ ...toApiLine(l), productName: nameOfKey(ctx, l.productKey, l.productName) }));
    const totals = totalsOfLines(lines); const h = hoursSummary(lines);
    return sendSuccess(res, {
      level, date, split, filters, saved: !!doc || docs.length > 0, locked: barDay?.status === "closed", posTotal: doc?.posTotal ?? null, notes: doc?.notes || "",
      lines, totals: { ...totals, bills: billCount(lines) }, hours: h.hours, untimed: h.untimed, peakHour: h.peakHour, modes: modeSummary(lines),
      previous: { label: "previous day", date: prevDate, amount: prev.amount, changePct: growthPct(totals.amount, prev.amount) },
    });
  }

  if (level === "month") {
    const { month } = req.query;
    if (!isRealMonth(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
    const keys = monthDayKeys(month), prevKey = previousMonthKey(month);
    const [groups, prev] = await Promise.all([groupPeriod(withIds({ month }, ids), "day", split), aggTotals(withIds({ month: prevKey }, ids))]);
    const rows = named(periodRows(groups, keys, split));
    const chart = keyTotals(groups, keys); const totals = sumRows(chart);
    const salesDays = chart.filter((c) => c.lines > 0).length;
    return sendSuccess(res, {
      level, month, split, filters, rows, days: chart, totals, salesDays, avgPerSalesDay: salesDays ? round2(totals.amount / salesDays) : 0, best: bestOf(chart),
      previous: { label: "previous month", month: prevKey, amount: prev.amount, changePct: growthPct(totals.amount, prev.amount) },
    });
  }

  const year = Number(req.query.year);
  const yearType = req.query.yearType === "calendar" ? "calendar" : "fy";
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return sendError(res, "A valid year (2000–2100) is required.");
  const keys = yearMonthKeys(year, yearType), prevKeys = yearMonthKeys(year - 1, yearType);
  const range = (ks) => ({ month: { $gte: ks[0], $lte: ks[11] } });
  const [groups, prev, dayGroups] = await Promise.all([
    groupPeriod(withIds(range(keys), ids), "month", split), aggTotals(withIds(range(prevKeys), ids)),
    AlcoholSaleLine.aggregate([{ $match: withIds(range(keys), ids) }, { $group: { _id: "$day" } }]),
  ]);
  const rows = named(periodRows(groups, keys, split));
  const chart = keyTotals(groups, keys); const totals = sumRows(chart);
  const salesDays = dayGroups.length;
  return sendSuccess(res, {
    level, year, yearType, label: yearLabel(year, yearType), split, filters, rows, months: chart, totals, salesDays, avgPerSalesDay: salesDays ? round2(totals.amount / salesDays) : 0, best: bestOf(chart),
    previous: { label: `previous ${yearType === "fy" ? "financial year" : "year"}`, year: year - 1, amount: prev.amount, changePct: growthPct(totals.amount, prev.amount) },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /alcohol-sales/report?from&to&groupBy=product|brand|type|day|steward|mode[&type&brand&productId&includeUnsold=true]
// The Analysis tab: what sold, what it cost to pour, and the trend against the period of the same length before.
// ─────────────────────────────────────────────────────────────────────────────
export const getSalesReport = async (req, res) => {
  const { from, to } = req.query;
  const groupBy = req.query.groupBy || "product";
  if (!isRealDate(from) || !isRealDate(to)) return sendError(res, "'from' and 'to' dates (YYYY-MM-DD) are required.");
  if (from > to) return sendError(res, "'from' must not be after 'to'.");
  if (!["product", "brand", "type", "day", "steward", "mode"].includes(groupBy)) return sendError(res, "groupBy must be product, brand, type, day, steward or mode.");
  const ctx = await loadContext();
  const ids = filterIds(ctx, req.query);
  const range = (a, b) => withIds({ day: { $gte: a, $lte: b } }, ids);
  const field = { day: "$day", steward: "$steward", mode: "$settMode" }[groupBy] || null;
  const [groups, dayGroups] = await Promise.all([
    AlcoholSaleLine.aggregate([{ $match: range(from, to) }, { $group: { _id: { g: field, p: "$productKey" }, productName: { $first: "$productName" }, qty: { $sum: "$qty" }, ml: { $sum: "$ml" }, discAmt: { $sum: "$discAmt" }, amount: { $sum: "$amount" }, lines: { $sum: 1 } } }]),
    AlcoholSaleLine.aggregate([{ $match: range(from, to) }, { $group: { _id: "$day" } }]),
  ]);
  const by = new Map();
  for (const g of groups) {
    const item = ctx.byId.get(String(g._id.p)); const p = item?.product;
    const [key, label] = groupBy === "day" ? [g._id.g, g._id.g]
      : groupBy === "brand" ? [p?.brandName || "(no brand)", p?.brandName || "(no brand)"]
      : groupBy === "type" ? [p?.baseCategoryName || "(no type)", p?.baseCategoryName || "(no type)"]
      : groupBy === "steward" ? [g._id.g || "(no steward)", g._id.g || "(no steward)"]
      : groupBy === "mode" ? [g._id.g || "(no mode)", g._id.g || "(no mode)"]
      : [String(g._id.p), nameOfKey(ctx, g._id.p, g.productName)];
    const c = by.get(key) || { key, label, qty: 0, ml: 0, discAmt: 0, amount: 0, cost: 0, lines: 0 };
    c.qty += g.qty; c.ml += g.ml; c.discAmt += g.discAmt; c.amount += g.amount; c.lines += g.lines;
    c.cost += g.ml * costPerMl(p ? priceOf(p) : 0, item?.unitMl);
    by.set(key, c);
  }
  // alcohol that sold NOTHING in the period — what a "slow sellers" list is really about
  if (groupBy === "product" && req.query.includeUnsold === "true") {
    for (const { product: p, unitMl } of ctx.items) {
      const k = String(p._id);
      if (unitMl == null || by.has(k) || (ids && !ids.includes(k))) continue;
      by.set(k, { key: k, label: p.name, qty: 0, ml: 0, discAmt: 0, amount: 0, cost: 0, lines: 0 });
    }
  }
  const total = round2([...by.values()].reduce((t, g) => t + g.amount, 0));
  const rows = [...by.values()].map((g) => ({
    key: g.key, label: g.label, qty: round3(g.qty), ml: round3(g.ml), discAmt: round2(g.discAmt), amount: round2(g.amount), cost: round2(g.cost), lines: g.lines,
    pourCostPct: g.amount > 0 ? round2((g.cost / g.amount) * 100) : null, share: total > 0 ? round2((g.amount / total) * 100) : 0,
  })).sort((a, b) => (groupBy === "day" ? a.label.localeCompare(b.label) : b.amount - a.amount));
  const t = (k) => rows.reduce((s, r) => s + r[k], 0);
  // the period of the same length straight before this one, for the trend
  const span = daysBetween(from, to);
  const prevTo = previousDay(from);
  const prevFrom = dayKey(new Date(dayStartOf(prevTo).getTime() - (span - 1) * DAY));
  const prev = await aggTotals(range(prevFrom, prevTo));
  return sendSuccess(res, {
    from, to, groupBy, days: dayGroups.length, rows,
    previous: { from: prevFrom, to: prevTo, amount: prev.amount, ml: prev.ml, changePct: growthPct(total, prev.amount) },
    totals: { qty: round3(t("qty")), ml: round3(t("ml")), discAmt: round2(t("discAmt")), amount: total, cost: round2(t("cost")), pourCostPct: total > 0 ? round2((t("cost") / total) * 100) : null, lines: t("lines") },
  });
};
 