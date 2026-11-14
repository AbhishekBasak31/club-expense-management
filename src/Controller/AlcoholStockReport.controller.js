
import { AlcoholStockMovement } from "../Model/AlcoholStockMovement.model.js";
import { AlcoholBarDay } from "../Model/AlcoholBarDay.model.js";
import { ExpenseEntry } from "../Model/Expense.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { DATE_RE, EPS, round3, normName } from "../Utils/AlcoholStock.js";
import { round2, costPerMl } from "../Utils/AlcoholBar.js";
import {
  REPORT_NAMES, STATEMENT_GROUPS, MAX_STATEMENT_DAYS, MAX_STATEMENT_MONTHS, DEFAULT_COVER_DAYS, dayStartOf, dayKeyOf, daysBetween, monthKeys, monthWindow,
  balancesAsOf, rangeActivity, classifyStock, receiptValue, groupReceipts, monthlyRows,
  windowStats, statementRow, addStatementRows, hasMovement, statementBuckets,
} from "../Utils/AlcoholStockReport.js";
import { loadContext } from "./AlcoholStock.controller.js";


// ─────────────────────────────────────────────────────────────────────────────
// ALCOHOL STOCK REPORTS — GET /alcohol-stock/report?name=…&from=…&to=…[&productId&type&brand…]
//
//   valuation  — what is on hand AS ON `to`, store and bar, valued at the current purchase price
//   movements  — the ledger itself: every row in the period (the audit trail)
//   receiving  — purchases received into the store, by line / vendor / month / product / brand
//   slow       — stock that is not moving: dead (nothing moved in the period) or slow (long cover)
//   monthly    — purchase vs consumption, month by month, reconciled to the closing stock
//   consumption — what each alcohol used: sold, breakage, complimentary, party, count variance, and what really left (rows per alcohol, day or month)
//   movement   — a stock statement: opening, received, issued to the bar, adjusted, consumed, count variance, closing (same row choices)
//
// All of them read the same ledger the Stock List, the Bar register and the variance report read, so none can
// disagree. `from`/`to` are inclusive dates; the page offers day, month and financial-year presets.
// ─────────────────────────────────────────────────────────────────────────────
const DAY = 24 * 3600 * 1000;
const MAX_MOVEMENTS = 5000;
const RECEIVING_GROUPS = ["line", "vendor", "month", "product", "brand"];
const priceOf = (p) => Number(p.currentPrice ?? p.purchasePrice) || 0;

// receipt → its purchase line, so the report can show vendor, bill and what it cost
async function loadReceiptDetails(receipts, ctx) {
  const entryIds = [...new Set(receipts.filter((m) => m.refType === "purchase-line").map((m) => String(m.refId).split(":")[0]))];
  const entries = entryIds.length ? await ExpenseEntry.find({ _id: { $in: entryIds } }).lean() : [];
  const items = new Map();
  for (const e of entries) for (const it of e.items || []) items.set(`${e._id}:${it._id}`, { entry: e, item: it });
  const out = new Map();
  for (const m of receipts) {
    const hit = items.get(String(m.refId));
    const unitMl = ctx.byId.get(String(m.productId))?.unitMl ?? null;
    const receivedBottles = unitMl ? m.qtyMl / unitMl : 0;
    const billed = Number(hit?.item?.qty) > 0 ? Number(hit.item.qty) : 1;
    out.set(String(m._id ?? m.refId), {
      found: !!hit, vendorName: hit?.item?.vendorName || "", billNo: hit?.item?.billNo || "", referenceNumber: hit?.entry?.referenceNumber || "",
      unitPrice: Number(hit?.item?.unitPrice) || 0,
      value: hit && unitMl ? receiptValue({ amount: hit.item.amount, billedQty: billed, receivedBottles }) : 0,
    });
  }
  return out;
}
const keyOfReceipt = (m) => String(m._id ?? m.refId);

export const getStockReport = async (req, res) => {
  const { name, from, to, productId, type, brand } = req.query;
  if (!REPORT_NAMES.includes(name)) return sendError(res, `name must be one of: ${REPORT_NAMES.join(", ")}.`);
  if (!to || !DATE_RE.test(to)) return sendError(res, "A valid 'to' date (YYYY-MM-DD) is required.");
  const fromDate = name === "valuation" ? (from && DATE_RE.test(from) ? from : to) : from;
  if (!fromDate || !DATE_RE.test(fromDate)) return sendError(res, "A valid 'from' date (YYYY-MM-DD) is required.");
  if (fromDate > to) return sendError(res, "'from' must not be after 'to'.");

  const ctx = await loadContext();
  if (!ctx.startDate) return sendError(res, "Start tracking first — set the opening stock.");
  if (productId && !ctx.byId.has(String(productId))) return sendError(res, "That product was not found.", 404);

  const hasFilter = !!(productId || type || brand);
  const pass = (p) => (!productId || String(p._id) === String(productId))
    && (!type || normName(p.baseCategoryName) === normName(type))
    && (!brand || normName(p.brandName) === normName(brand));
  const allowed = new Set(ctx.items.filter((i) => pass(i.product)).map((i) => String(i.product._id)));
  const include = (pid) => (hasFilter ? allowed.has(pid) : true);
  const d0 = dayStartOf(fromDate), d1 = new Date(dayStartOf(to).getTime() + DAY);
  const filters = { productId: productId || null, type: type || null, brand: brand || null };
  const meta = (p) => ({ productId: String(p._id), productName: p.name, brandName: p.brandName || "", alcoholType: p.baseCategoryName || "" });

  // ── valuation (as on `to`) ────────────────────────────────────────────────
  if (name === "valuation") {
    const bal = balancesAsOf(await AlcoholStockMovement.find({ date: { $lt: d1 } }).lean(), d1);
    const includeZero = req.query.includeZero === "true";
    let rows = ctx.items.filter((i) => allowed.has(String(i.product._id)) && i.unitMl != null).map(({ product: p, unitMl }) => {
      const b = bal.get(String(p._id)) || { storeMl: 0, barMl: 0 };
      const totalMl = round3(b.storeMl + b.barMl);
      const price = priceOf(p), cpm = costPerMl(price, unitMl);
      return { ...meta(p), unitMl, storeMl: b.storeMl, barMl: b.barMl, totalMl, pricePerBottle: price, storeValue: round2(b.storeMl * cpm), barValue: round2(b.barMl * cpm), totalValue: round2(totalMl * cpm), share: 0 };
    }).filter((r) => includeZero || r.totalMl !== 0);
    const total = round2(rows.reduce((t, r) => t + r.totalValue, 0));
    rows = rows.map((r) => ({ ...r, share: total > 0 ? round2((r.totalValue / total) * 100) : 0 })).sort((a, b) => b.totalValue - a.totalValue || a.productName.localeCompare(b.productName));
    const sum = (k) => round3(rows.reduce((t, r) => t + r[k], 0));
    return sendSuccess(res, {
      name, asOn: to, filters, rows,
      unpriced: rows.filter((r) => r.totalMl > 0 && r.pricePerBottle <= 0).length,    // stock the valuation cannot price
      totals: { storeMl: sum("storeMl"), barMl: sum("barMl"), totalMl: sum("totalMl"), storeValue: round2(rows.reduce((t, r) => t + r.storeValue, 0)), barValue: round2(rows.reduce((t, r) => t + r.barValue, 0)), totalValue: total },
    });
  }

  // ── movement register ─────────────────────────────────────────────────────
  if (name === "movements") {
    const { movementType, location } = req.query;
    let rows = await AlcoholStockMovement.find({ date: { $gte: d0, $lt: d1 } }).sort({ date: 1, createdAt: 1 }).lean();
    rows = rows.filter((m) => include(String(m.productId)) && (!movementType || m.type === movementType) && (!location || m.location === location));
    const truncated = rows.length > MAX_MOVEMENTS;
    if (truncated) rows = rows.slice(0, MAX_MOVEMENTS);
    const byType = new Map();
    rows.forEach((m) => { const x = byType.get(m.type) || { type: m.type, count: 0, qtyMl: 0 }; x.count++; x.qtyMl += Number(m.qtyMl) || 0; byType.set(m.type, x); });
    return sendSuccess(res, {
      name, from: fromDate, to, filters: { ...filters, movementType: movementType || null, location: location || null }, truncated,
      rows: rows.map((m) => ({
        date: dayKeyOf(m.date), productId: String(m.productId), productName: m.productName || ctx.byId.get(String(m.productId))?.product.name || "",
        unitMl: ctx.byId.get(String(m.productId))?.unitMl ?? null, location: m.location, type: m.type, qtyMl: round3(m.qtyMl), noteNo: m.noteId || "", remark: m.remark || "",
      })),
      summary: [...byType.values()].map((x) => ({ ...x, qtyMl: round3(x.qtyMl) })).sort((a, b) => a.type.localeCompare(b.type)),
    });
  }

  // ── receiving ─────────────────────────────────────────────────────────────
  if (name === "receiving") {
    const groupBy = req.query.groupBy || "line";
    if (!RECEIVING_GROUPS.includes(groupBy)) return sendError(res, `groupBy must be one of: ${RECEIVING_GROUPS.join(", ")}.`);
    const receipts = (await AlcoholStockMovement.find({ type: "receipt", date: { $gte: d0, $lt: d1 } }).lean()).filter((m) => include(String(m.productId)));
    const details = await loadReceiptDetails(receipts, ctx);
    const lines = receipts.map((m) => {
      const d = details.get(keyOfReceipt(m)); const item = ctx.byId.get(String(m.productId));
      return {
        date: dayKeyOf(m.date), productId: String(m.productId), productName: m.productName || item?.product.name || "", brandName: item?.product.brandName || "",
        alcoholType: item?.product.baseCategoryName || "", unitMl: item?.unitMl ?? null, vendorName: d.vendorName, billNo: d.billNo, referenceNumber: d.referenceNumber,
        receivedMl: round3(m.qtyMl), unitPrice: d.unitPrice, value: d.value,
      };
    });
    const g = groupReceipts(lines, groupBy);
    return sendSuccess(res, { name, from: fromDate, to, groupBy, filters, rows: g.rows, totals: g.totals, unmatched: receipts.filter((m) => !details.get(keyOfReceipt(m)).found).length });
  }

  // ── slow and dead stock ───────────────────────────────────────────────────
  if (name === "slow") {
    const coverLimit = req.query.coverDays === undefined || req.query.coverDays === "" ? DEFAULT_COVER_DAYS : Number(req.query.coverDays);
    if (!Number.isFinite(coverLimit) || coverLimit < 1 || coverLimit > 3650) return sendError(res, "coverDays must be between 1 and 3650.");
    const movements = await AlcoholStockMovement.find({ date: { $lt: d1 } }).lean();
    const bal = balancesAsOf(movements, d1), act = rangeActivity(movements, d0, d1), days = daysBetween(fromDate, to);
    const rank = { dead: 0, slow: 1, ok: 2 };
    const rows = ctx.items.filter((i) => allowed.has(String(i.product._id)) && i.unitMl != null).flatMap(({ product: p, unitMl }) => {
      const b = bal.get(String(p._id)) || { storeMl: 0, barMl: 0 }; const a = act.get(String(p._id));
      const totalMl = round3(b.storeMl + b.barMl);
      const usedMl = Math.max(a?.issuedMl || 0, a?.consumedMl || 0);
      const c = classifyStock({ totalMl, usedMl, days, coverLimitDays: coverLimit });
      if (c.cls === "none") return [];
      const last = a?.lastOutAt ?? null;
      return [{ ...meta(p), unitMl, totalMl, issuedMl: a?.issuedMl || 0, consumedMl: a?.consumedMl || 0, usedMl: round3(usedMl), coverDays: c.coverDays, cls: c.cls,
        lastMovedOn: last === null ? null : dayKeyOf(new Date(last)), daysSinceMoved: last === null ? null : Math.round((dayStartOf(to) - last) / DAY),
        stockValue: round2(totalMl * costPerMl(priceOf(p), unitMl)) }];
    }).sort((x, y) => rank[x.cls] - rank[y.cls] || (x.cls === "slow" ? y.coverDays - x.coverDays : y.stockValue - x.stockValue) || x.productName.localeCompare(y.productName));
    const by = (cls) => { const r = rows.filter((x) => x.cls === cls); return { count: r.length, value: round2(r.reduce((t, x) => t + x.stockValue, 0)) }; };
    return sendSuccess(res, { name, from: fromDate, to, days, coverDays: coverLimit, filters, rows, summary: { dead: by("dead"), slow: by("slow"), ok: by("ok") } });
  }

  // ── consumption and movement ──────────────────────────────────────────────
  // The same ledger read two ways: `movement` is the stock statement, `consumption` is what the bar used. Rows are one per alcohol
  // (default), or one per day / month for a trend. Consumption reaches the ledger when a bar day is CLOSED, so `closedDates` says
  // which days of the period are in; the page points out the days that are not.
  if (name === "consumption" || name === "movement") {
    const by = req.query.groupBy || "product";
    if (!STATEMENT_GROUPS.includes(by)) return sendError(res, `groupBy must be one of: ${STATEMENT_GROUPS.join(", ")}.`);
    if (by === "day" && daysBetween(fromDate, to) > MAX_STATEMENT_DAYS) return sendError(res, `By day needs a period of at most ${MAX_STATEMENT_DAYS} days.`);
    if (by === "month" && monthKeys(fromDate, to).length > MAX_STATEMENT_MONTHS) return sendError(res, `By month needs a period of at most ${MAX_STATEMENT_MONTHS} months.`);
    const includeZero = req.query.includeZero === "true";
    const movements = (await AlcoholStockMovement.find({ date: { $lt: d1 } }).lean()).filter((m) => include(String(m.productId)) && ctx.byId.get(String(m.productId))?.unitMl != null);
    const cpmOf = (pid) => { const i = ctx.byId.get(pid); return i && i.unitMl ? costPerMl(priceOf(i.product), i.unitMl) : 0; };
    const rowsOf = (w0, w1) => [...windowStats(movements, w0, w1)].map(([pid, st]) => ({ pid, row: statementRow(st, cpmOf(pid)) }));
    const whole = rowsOf(d0, d1);
    const wanted = (r) => includeZero || (name === "consumption" ? Math.abs(r.consumedMl) > EPS || Math.abs(r.varianceMl) > EPS : hasMovement(r));
    let rows, totals;
    if (by === "product") {
      rows = whole.filter((x) => wanted(x.row)).map(({ pid, row }) => ({ ...meta(ctx.byId.get(pid).product), unitMl: ctx.byId.get(pid).unitMl, ...row }));
      totals = addStatementRows(rows);
      rows = rows.map((r) => ({ ...r, share: name === "consumption" && totals.consumedMl > 0 ? round2((r.consumedMl / totals.consumedMl) * 100) : 0 }))
        .sort((a, b) => (name === "consumption" ? b.consumedMl - a.consumedMl : 0) || a.productName.localeCompare(b.productName));
    } else {
      rows = statementBuckets(fromDate, to, by).map((b) => ({ key: b.key, ...addStatementRows(rowsOf(b.d0, b.d1).map((x) => x.row)) }));
      totals = addStatementRows(whole.map((x) => x.row));
    }
    const closed = await AlcoholBarDay.find({ status: "closed", date: { $gte: d0, $lt: d1 } }).lean();
    return sendSuccess(res, {
      name, from: fromDate, to, groupBy: by, days: daysBetween(fromDate, to), filters, rows, totals,
      closedDates: closed.map((d) => dayKeyOf(d.date)).sort(),
    });
  }

  // ── monthly purchase vs consumption ───────────────────────────────────────
  const months = monthKeys(fromDate, to);
  if (months.length > 36) return sendError(res, "At most 36 months at a time.");
  const end = monthWindow(months[months.length - 1]).d1;
  const movements = await AlcoholStockMovement.find({ date: { $lt: end } }).lean();
  const receipts = movements.filter((m) => m.type === "receipt" && include(String(m.productId)));
  const details = await loadReceiptDetails(receipts, ctx);
  const rows = monthlyRows({
    movements, months, include,
    valueOfReceipt: (m) => details.get(keyOfReceipt(m))?.value ?? 0,
    costPerMlOf: (pid) => { const i = ctx.byId.get(pid); return i && i.unitMl ? costPerMl(priceOf(i.product), i.unitMl) : 0; },
  });
  const sum = (k) => round3(rows.reduce((t, r) => t + r[k], 0));
  return sendSuccess(res, {
    name, from: fromDate, to, filters, rows,
    totals: { openingMl: rows[0].openingMl, receivedMl: sum("receivedMl"), receivedValue: round2(rows.reduce((t, r) => t + r.receivedValue, 0)), consumedMl: sum("consumedMl"),
      consumedValue: round2(rows.reduce((t, r) => t + r.consumedValue, 0)), varianceMl: sum("varianceMl"), adjustmentMl: sum("adjustmentMl"), openingEntryMl: sum("openingEntryMl"), closingMl: rows[rows.length - 1].closingMl, closingValue: rows[rows.length - 1].closingValue },
  });
};