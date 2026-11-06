import mongoose from "mongoose";
import { AlcoholStockMovement } from "../Model/AlcoholStockMovement.model.js";
import { AlcoholStockConfig } from "../Model/AlcoholStockConfig.model.js";
import { AlcoholPurchaseRequirement } from "../Model/AlcoholpurchaseReq.modal.js";
import { ExpenseEntry } from "../Model/Expense.modal.js";
import { Product } from "../Model/product.model.js";
import { UOM } from "../Model/uom.model.js";
import { ProductConversion } from "../Model/productconv.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import {
  MONTH_RE, DATE_RE, EPS, round3, normName, monthBounds, toMl, splitMl, unitMlOf,
  summariseStore, levelStatus, suggestOrder, validateLevels,
} from "../Utils/AlcoholStock.js";

// ─────────────────────────────────────────────────────────────────────────────
// ALCOHOL STOCK — Phase 1: the ledger + the Alcohol Stock List (the STORE side).
//
// Everything is in ML in the ledger; the pages show bottles + loose ml. Min / Max / bar par are in BOTTLES, in the
// product's own unit. Min is the existing Product.reorderLevel.
//
// • "Alcohol product" = an active, non-capital Product whose sub-category is Alcohol, matched to purchase lines by
//   NAME (trimmed, case-insensitive) — the same convention the rest of the app uses.
// • A product is READY for stock only when its unit resolves to ml (a sized bottle unit, or a conversion).
// • Dates: a purchase line's date is its incurredDate (invoice date for older entries) — the same date the Alcohol
//   Purchase Report and the P&L use, so the stock list and those reports agree.
// • Purchases enter stock only when RECEIVED (once per line), from the tracking start date on.
// ─────────────────────────────────────────────────────────────────────────────
const uid = (req) => req.user?.userId ?? null;
const ALCOHOL_RE = /^\s*alcohol\s*$/i;
const DAY = 24 * 3600 * 1000;
const dayStart = (s) => new Date(`${s}T00:00:00.000Z`);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const monthKeyOf = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const toBottlesText = (ml, unitMl) => { const s = splitMl(ml, unitMl); return `${s.bottles} btl${s.looseMl ? ` + ${s.looseMl} ml` : ""}`; };

// ── shared loading ───────────────────────────────────────────────────────────
async function loadContext() {
  const [products, uoms, conversions, config] = await Promise.all([
    Product.find({ isActive: true }).lean(),
    UOM.find({}).lean(),
    ProductConversion.find({ isActive: true }).lean(),
    AlcoholStockConfig.findOne({ key: "main" }).lean(),
  ]);
  const convByProduct = new Map();
  conversions.forEach((c) => {
    const k = String(c.productId);
    if (!convByProduct.has(k)) convByProduct.set(k, []);
    convByProduct.get(k).push(c);
  });
  const items = products
    .filter((p) => normName(p.subCategoryName) === "alcohol" && p.expenseType !== "capital")
    .map((p) => {
      const u = unitMlOf(p, uoms, convByProduct.get(String(p._id)) || []);
      return { product: p, unitMl: u.ok ? u.ml : null, reason: u.ok ? "" : u.reason };
    });
  const byId = new Map(items.map((i) => [String(i.product._id), i]));
  return { items, byId, startDate: config?.trackingStartDate ? new Date(config.trackingStartDate) : null };
}

// Purchase lines of alcohol since the tracking start: matched by product NAME, plus anything categorised Alcohol
// (so lines for a product that does not exist yet are reported instead of silently ignored).
export function buildPendingPipeline(startDate, names) {
  return [
    { $match: { status: "final", $or: [{ incurredDate: { $gte: startDate } }, { incurredDate: null, date: { $gte: startDate } }] } },
    { $unwind: "$items" },
    { $match: { "items.isVoucher": { $ne: true }, "items.isAllowance": { $ne: true } } },
    { $project: {
        _id: 0, entryId: "$_id", itemId: "$items._id", referenceNumber: 1,
        billNo: "$items.billNo", date: { $ifNull: ["$incurredDate", "$date"] },
        vendorName: "$items.vendorName", description: "$items.description",
        qty: "$items.qty", unitPrice: "$items.unitPrice", amount: "$items.amount",
        subCategoryName: "$items.subCategoryName", groupName: "$items.groupName",
        nameKey: { $toLower: { $trim: { input: { $ifNull: ["$items.description", ""] } } } },
    } },
    { $match: { $or: [{ nameKey: { $in: names } }, { subCategoryName: ALCOHOL_RE }, { groupName: ALCOHOL_RE }] } },
    { $sort: { date: 1, referenceNumber: 1 } },
  ];
}

async function findPending(ctx) {
  if (!ctx.startDate) return { started: false, lines: [], unmatched: [], receivedKeys: new Set() };
  const names = [...new Set(ctx.items.map((i) => normName(i.product.name)))];
  const [raw, received] = await Promise.all([
    ExpenseEntry.aggregate(buildPendingPipeline(ctx.startDate, names)).allowDiskUse(true),
    AlcoholStockMovement.find({ refType: "purchase-line", type: "receipt" }).lean(),
  ]);
  const receivedKeys = new Set(received.map((m) => m.refId));

  const byName = new Map();
  ctx.items.forEach((i) => {
    const k = normName(i.product.name);
    byName.set(k, [...(byName.get(k) || []), i]);
  });

  const lines = [], unmatched = [];
  for (const r of raw) {
    const key = `${r.entryId}:${r.itemId}`;
    if (receivedKeys.has(key)) continue;
    const qty = Number(r.qty) || 0;
    if (qty <= 0) continue;
    const base = {
      key, entryId: String(r.entryId), itemId: String(r.itemId), referenceNumber: r.referenceNumber || "", billNo: r.billNo || "",
      date: iso(r.date), vendorName: r.vendorName || "", description: (r.description || "").trim(), qty,
      unitPrice: Number(r.unitPrice) || 0, amount: Number(r.amount) || 0,
    };
    // looked up with inner spaces collapsed too, so "Absolut  Blue 750ml" (a stray double space on a bill) still finds its product
    const hits = byName.get(normName(r.description)) || [];
    if (hits.length === 1) {
      const it = hits[0];
      lines.push({ ...base, productId: String(it.product._id), productName: it.product.name, unitMl: it.unitMl, ready: it.unitMl != null, mlTotal: it.unitMl != null ? round3(qty * it.unitMl) : null });
    } else if (hits.length > 1) {
      unmatched.push({ ...base, reason: "More than one product has this name — give each product a distinct name." });
    } else {
      unmatched.push({ ...base, reason: "No alcohol product with this name — create it in Product Master (with its bottle unit)." });
    }
  }
  return { started: true, lines, unmatched, receivedKeys };
}

async function findOpenRequests() {
  // only requests explicitly marked open — older, status-less requests are history
  return AlcoholPurchaseRequirement.find({ isActive: true, status: "open" }).lean();
}

// ── the stock rows ───────────────────────────────────────────────────────────
function buildRows(ctx, month, movements, pending, openRequests) {
  const { start, end } = monthBounds(month);
  const movByProduct = new Map();
  movements.forEach((m) => {
    const k = String(m.productId);
    if (!movByProduct.has(k)) movByProduct.set(k, []);
    movByProduct.get(k).push(m);
  });
  const awaiting = new Map(); // productId → { ml, lines }
  pending.lines.forEach((l) => {
    const a = awaiting.get(l.productId) || { ml: 0, bottles: 0, lines: 0 };
    a.ml += l.mlTotal || 0; a.bottles += l.qty; a.lines += 1;
    awaiting.set(l.productId, a);
  });
  const nameToId = new Map(ctx.items.map((i) => [normName(i.product.name), String(i.product._id)]));
  const requested = new Map(); // productId → { bottles, ids }
  openRequests.forEach((r) => {
    const pid = r.productId ? String(r.productId) : nameToId.get(normName(r.alcoholItemDetails));
    if (!pid) return;
    const x = requested.get(pid) || { bottles: 0, ids: [] };
    x.bottles += Number(r.reqQty) || 0; x.ids.push(String(r._id));
    requested.set(pid, x);
  });

  return ctx.items.map(({ product: p, unitMl, reason }) => {
    const pid = String(p._id);
    const ready = unitMl != null;
    const s = ready ? summariseStore(movByProduct.get(pid) || [], start, end) : { openingMl: 0, receivedMl: 0, toBarMl: 0, adjustmentMl: 0, balanceMl: 0 };
    const aw = awaiting.get(pid) || { ml: 0, bottles: 0, lines: 0 };
    const rq = requested.get(pid) || { bottles: 0, ids: [] };
    const min = Number(p.reorderLevel) || 0, max = Number(p.maxStockLevel) || 0;
    const price = Number(p.currentPrice ?? p.purchasePrice) || 0;
    return {
      productId: pid, productName: p.name, productCode: p.productCode || "", brandName: p.brandName || "",
      alcoholType: p.baseCategoryName || "", uomName: p.uomName || "",
      unitMl, ready, reason,
      ...s,
      awaitingMl: round3(aw.ml), awaitingBottles: aw.bottles, awaitingLines: aw.lines,
      min, max, barPar: Number(p.barParLevel) || 0, leadTimeDays: Number(p.leadTimeDays) || 0,
      status: ready ? levelStatus({ balanceMl: s.balanceMl, unitMl, min, max }) : "not-ready",
      requestedBottles: rq.bottles, requestIds: rq.ids,
      suggestedBottles: ready ? suggestOrder({ balanceMl: s.balanceMl, awaitingMl: aw.ml, requestedMl: rq.bottles * unitMl, unitMl, max }) : null,
      price, valueStore: ready ? Math.round((s.balanceMl / unitMl) * price * 100) / 100 : 0,
    };
  }).sort((a, b) => a.productName.localeCompare(b.productName));
}

function summarise(rows, pending) {
  const count = (st) => rows.filter((r) => r.status === st).length;
  return {
    products: rows.length, ready: rows.filter((r) => r.ready).length, notReady: count("not-ready"),
    low: count("low"), out: count("out"), over: count("over"), ok: count("ok"), unset: count("unset"),
    needsOrder: count("low") + count("out"),
    awaitingLines: pending.lines.length, unmatched: pending.unmatched.length,
    storeValue: Math.round(rows.reduce((s, r) => s + r.valueStore, 0) * 100) / 100,
  };
}

async function snapshot(month) {
  const { end } = monthBounds(month);
  const ctx = await loadContext();
  const [movements, pending, openRequests] = await Promise.all([
    AlcoholStockMovement.find({ date: { $lt: end } }).lean(),
    findPending(ctx),
    findOpenRequests(),
  ]);
  const rows = buildRows(ctx, month, movements, pending, openRequests);
  return { ctx, rows, pending, summary: summarise(rows, pending) };
}

// GET /alcohol-stock?month=YYYY-MM
export const getAlcoholStock = async (req, res) => {
  const { month } = req.query;
  if (!month || !MONTH_RE.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  const { ctx, rows, pending, summary } = await snapshot(month);
  return sendSuccess(res, { month, started: !!ctx.startDate, trackingStartDate: iso(ctx.startDate), rows, summary, unmatchedCount: pending.unmatched.length });
};

// GET /alcohol-stock/alerts[?month=YYYY-MM] — what the bell shows (the current month unless one is given)
export const getAlcoholStockAlerts = async (req, res) => {
  const month = MONTH_RE.test(req.query.month || "") ? req.query.month : monthKeyOf(new Date());
  const { ctx, rows, pending, summary } = await snapshot(month);
  const attention = rows
    .filter((r) => r.status === "low" || r.status === "out")
    .map((r) => ({ productId: r.productId, productName: r.productName, status: r.status, balanceMl: r.balanceMl, unitMl: r.unitMl, min: r.min, suggestedBottles: r.suggestedBottles, requestedBottles: r.requestedBottles }))
    .slice(0, 10);
  return sendSuccess(res, { started: !!ctx.startDate, ...summary, unmatched: pending.unmatched.length, attention });
};

// GET /alcohol-stock/pending — purchase lines waiting to be received into stock
export const getPendingReceipts = async (req, res) => {
  const ctx = await loadContext();
  const p = await findPending(ctx);
  return sendSuccess(res, { started: p.started, trackingStartDate: iso(ctx.startDate), lines: p.lines, unmatched: p.unmatched, count: p.lines.length });
};

// POST /alcohol-stock/receive { lines:[{ entryId, itemId, qty? }] }
// Receives purchase lines into the store, once each. qty defaults to the invoiced quantity and may be LOWER (a short
// delivery) but never higher. Receiving a product also closes its open purchase requests.
export const receiveStock = async (req, res) => {
  const { lines } = req.body || {};
  if (!Array.isArray(lines) || lines.length === 0) return sendError(res, "Choose at least one purchase line to receive.");
  if (lines.length > 500) return sendError(res, "At most 500 lines at a time.");
  const ctx = await loadContext();
  if (!ctx.startDate) return sendError(res, "Start tracking first — set the opening stock.");
  const pending = await findPending(ctx);
  const byKey = new Map(pending.lines.map((l) => [l.key, l]));

  const results = [];
  const touched = new Set();
  for (let index = 0; index < lines.length; index++) {
    const req_ = lines[index] || {};
    const key = `${req_.entryId}:${req_.itemId}`;
    const fail = (error) => results.push({ index, key, ok: false, action: "error", error });
    if (pending.receivedKeys.has(key)) { results.push({ index, key, ok: true, action: "exists" }); continue; }
    const line = byKey.get(key);
    if (!line) { fail("This purchase line was not found (or is not an alcohol product line)."); continue; }
    if (!line.ready) { fail(`${line.productName} has no bottle unit yet — it cannot be stocked.`); continue; }
    const qty = req_.qty === undefined || req_.qty === null || req_.qty === "" ? line.qty : Number(req_.qty);
    if (!Number.isFinite(qty) || qty <= 0) { fail("Quantity must be greater than 0."); continue; }
    if (qty > line.qty + EPS) { fail(`Cannot receive more than the invoiced ${line.qty}.`); continue; }
    const d = new Date(line.date);
    try {
      await AlcoholStockMovement.create({
        productId: line.productId, productName: line.productName, date: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
        location: "store", type: "receipt", qtyMl: round3(qty * line.unitMl),
        refType: "purchase-line", refId: key, remark: `${line.referenceNumber}${line.billNo ? ` / bill ${line.billNo}` : ""}${qty < line.qty ? ` — short delivery: ${qty} of ${line.qty}` : ""}`,
        createdBy: uid(req),
      });
      results.push({ index, key, ok: true, action: "received" });
      touched.add(line.productId);
    } catch (err) {
      if (err?.code === 11000) results.push({ index, key, ok: true, action: "exists" });
      else fail("Could not save this receipt.");
    }
  }

  // close the open requests of the products that just arrived
  let closed = 0;
  if (touched.size) {
    const open = await findOpenRequests();
    const nameToId = new Map(ctx.items.map((i) => [normName(i.product.name), String(i.product._id)]));
    for (const r of open) {
      const pid = r.productId ? String(r.productId) : nameToId.get(normName(r.alcoholItemDetails));
      if (!pid || !touched.has(pid)) continue;
      const doc = await AlcoholPurchaseRequirement.findById(r._id);
      if (!doc) continue;
      doc.status = "received"; doc.receivedAt = new Date(); doc.updatedBy = uid(req);
      await doc.save(); closed++;
    }
  }
  const count = (a) => results.filter((x) => x.action === a).length;
  return sendSuccess(res, { results, summary: { received: count("received"), exists: count("exists"), errors: count("error") }, closedRequests: closed },
    `${count("received")} line${count("received") === 1 ? "" : "s"} received${closed ? `, ${closed} request${closed === 1 ? "" : "s"} closed` : ""}.`, 201);
};

// POST /alcohol-stock/opening { date, items:[{ productId, bottles, looseMl }] }
// Sets the tracking start date (the first time) and records each product's counted stock. A product that already has
// ledger rows is refused — correct it with an adjustment instead. Zero counts are skipped (no row needed).
export const setOpeningStock = async (req, res) => {
  const { date, items } = req.body || {};
  if (!date || !DATE_RE.test(date)) return sendError(res, "A valid opening date (YYYY-MM-DD) is required.");
  if (items !== undefined && !Array.isArray(items)) return sendError(res, "items must be a list.");
  const list = items || [];
  if (list.length > 500) return sendError(res, "At most 500 products at a time.");
  const ctx = await loadContext();
  const when = dayStart(date);
  if (ctx.startDate && ctx.startDate.getTime() !== when.getTime()) {
    return sendError(res, `Tracking started on ${iso(ctx.startDate).slice(0, 10)} — opening stock must be dated that day. Use an adjustment for later corrections.`, 409);
  }
  const existing = await AlcoholStockMovement.find({}).lean();
  const hasRows = new Set(existing.map((m) => String(m.productId)));

  const results = [];
  for (let index = 0; index < list.length; index++) {
    const it = list[index] || {};
    const fail = (error) => results.push({ index, ok: false, action: "error", error });
    const item = ctx.byId.get(String(it.productId));
    if (!item) { fail("Alcohol product not found."); continue; }
    if (item.unitMl == null) { fail(`${item.product.name} has no bottle unit yet.`); continue; }
    const b = Number(it.bottles || 0), l = Number(it.looseMl || 0);
    if (!Number.isFinite(b) || !Number.isFinite(l) || b < 0 || l < 0) { fail("Bottles and loose ml must be 0 or more."); continue; }
    const ml = toMl({ bottles: b, looseMl: l }, item.unitMl);
    if (ml <= 0) { results.push({ index, ok: true, action: "skipped" }); continue; }
    if (hasRows.has(String(item.product._id))) { fail(`${item.product.name} already has stock entries — use an adjustment to correct it.`); continue; }
    try {
      await AlcoholStockMovement.create({ productId: item.product._id, productName: item.product.name, date: when, location: "store", type: "opening", qtyMl: ml, refType: "manual", remark: "Opening stock", createdBy: uid(req) });
      hasRows.add(String(item.product._id));
      results.push({ index, ok: true, action: "saved", ml });
    } catch { fail("Could not save this opening stock."); }
  }
  if (!ctx.startDate) {
    const cfg = await AlcoholStockConfig.findOne({ key: "main" });
    if (cfg) { cfg.trackingStartDate = when; cfg.updatedBy = uid(req); await cfg.save(); }
    else await AlcoholStockConfig.create({ key: "main", trackingStartDate: when, updatedBy: uid(req) });
  }
  const count = (a) => results.filter((x) => x.action === a).length;
  return sendSuccess(res, { trackingStartDate: when.toISOString(), results, summary: { saved: count("saved"), skipped: count("skipped"), errors: count("error") } },
    `Tracking starts ${date}. ${count("saved")} opening balance${count("saved") === 1 ? "" : "s"} saved.`, 201);
};

// PUT /alcohol-stock/levels { productId, min?, max?, barPar?, leadTimeDays? }  — all in bottles (lead time in days)
export const updateLevels = async (req, res) => {
  const { productId, min, max, barPar, leadTimeDays } = req.body || {};
  if (!productId) return sendError(res, "productId is required.");
  const doc = await Product.findById(productId);
  if (!doc) return sendError(res, "Product not found.", 404);
  // Min above the product's CURRENT max (or Max below its current min) is checked against the saved values too
  const nextMin = min !== undefined ? Number(min) : Number(doc.reorderLevel) || 0;
  const nextMax = max !== undefined ? Number(max) : Number(doc.maxStockLevel) || 0;
  const err = validateLevels({ min, max, barPar, leadTimeDays }) || validateLevels({ min: nextMin, max: nextMax });
  if (err) return sendError(res, err);
  if (min !== undefined) doc.reorderLevel = nextMin;
  if (max !== undefined) doc.maxStockLevel = nextMax;
  if (barPar !== undefined) doc.barParLevel = Number(barPar);
  if (leadTimeDays !== undefined) doc.leadTimeDays = Number(leadTimeDays);
  await doc.save();
  return sendSuccess(res, { productId: String(doc._id), min: doc.reorderLevel || 0, max: doc.maxStockLevel || 0, barPar: doc.barParLevel || 0, leadTimeDays: doc.leadTimeDays || 0 }, "Levels saved.");
};

// What the store can give up on `date`: its balance at the end of that day, but never more than keeps EVERY later day's
// balance at or above zero (a back-dated issue must not overdraw a day that has already happened).
async function storeOutflowLimit(productId, date) {
  const rows = (await AlcoholStockMovement.find({ productId, location: "store" }).lean())
    .map((m) => ({ t: new Date(m.date).getTime(), q: Number(m.qtyMl) || 0 }))
    .sort((x, y) => x.t - y.t);
  const limit = date.getTime() + DAY;
  let cum = 0, i = 0;
  while (i < rows.length && rows[i].t < limit) cum += rows[i++].q;
  const asOf = round3(cum);
  let min = cum;
  while (i < rows.length) {                       // each later DAY, taken as a whole
    const day = rows[i].t;
    while (i < rows.length && rows[i].t === day) cum += rows[i++].q;
    min = Math.min(min, cum);
  }
  return { asOf, available: round3(Math.min(asOf, min)) };
}

// Reads { productId, date, bottles, looseMl } and returns { item, when, ml } or an error string.
async function readQuantity(body) {
  const { productId, date, bottles, looseMl } = body || {};
  if (!productId) return { error: "productId is required." };
  if (!date || !DATE_RE.test(date)) return { error: "A valid date (YYYY-MM-DD) is required." };
  const ctx = await loadContext();
  if (!ctx.startDate) return { error: "Start tracking first — set the opening stock." };
  const item = ctx.byId.get(String(productId));
  if (!item) return { error: "Alcohol product not found." };
  if (item.unitMl == null) return { error: `${item.product.name} has no bottle unit yet.` };
  const when = dayStart(date);
  if (when.getTime() < ctx.startDate.getTime()) return { error: `Dates before tracking started (${iso(ctx.startDate).slice(0, 10)}) are not allowed.` };
  const b = Number(bottles || 0), l = Number(looseMl || 0);
  if (!Number.isFinite(b) || !Number.isFinite(l) || b < 0 || l < 0) return { error: "Bottles and loose ml must be 0 or more." };
  const ml = toMl({ bottles: b, looseMl: l }, item.unitMl);
  if (ml <= 0) return { error: "Enter a quantity greater than 0." };
  return { item, when, ml };
}

// POST /alcohol-stock/allocate { productId, date, bottles?, looseMl?, remark? } — store → bar
export const allocateToBar = async (req, res) => {
  const q = await readQuantity(req.body);
  if (q.error) return sendError(res, q.error);
  const { item, when, ml } = q;
  const { asOf: balance, available } = await storeOutflowLimit(item.product._id, when);
  if (ml > available + EPS) {
    return sendError(res, available + EPS >= balance
      ? `Only ${toBottlesText(Math.max(balance, 0), item.unitMl)} in store on that date — cannot allocate ${toBottlesText(ml, item.unitMl)}.`
      : `Only ${toBottlesText(Math.max(available, 0), item.unitMl)} can be taken out on that date — a later day's stock would go below zero.`, 409);
  }
  const transferId = new mongoose.Types.ObjectId().toString();
  const base = { productId: item.product._id, productName: item.product.name, date: when, refType: "transfer", refId: transferId, transferId, remark: String(req.body.remark || "").trim(), createdBy: uid(req) };
  await AlcoholStockMovement.create({ ...base, location: "store", type: "transfer-out", qtyMl: -ml });
  await AlcoholStockMovement.create({ ...base, location: "bar", type: "transfer-in", qtyMl: ml });
  return sendSuccess(res, { transferId, ml, storeBalanceMl: round3(balance - ml) }, `Allocated ${toBottlesText(ml, item.unitMl)} to the bar.`, 201);
};

// POST /alcohol-stock/adjust { productId, date, direction:'add'|'remove', bottles?, looseMl?, reason }
export const adjustStock = async (req, res) => {
  const { direction, reason } = req.body || {};
  if (direction !== "add" && direction !== "remove") return sendError(res, "Choose whether to add or remove stock.");
  const why = String(reason || "").trim();
  if (why.length < 3) return sendError(res, "A reason is required (at least 3 characters).");
  const q = await readQuantity(req.body);
  if (q.error) return sendError(res, q.error);
  const { item, when, ml } = q;
  if (direction === "remove") {
    const { asOf: balance, available } = await storeOutflowLimit(item.product._id, when);
    if (ml > available + EPS) {
      return sendError(res, available + EPS >= balance
        ? `Only ${toBottlesText(Math.max(balance, 0), item.unitMl)} in store on that date — cannot remove ${toBottlesText(ml, item.unitMl)}.`
        : `Only ${toBottlesText(Math.max(available, 0), item.unitMl)} can be taken out on that date — a later day's stock would go below zero.`, 409);
    }
  }
  await AlcoholStockMovement.create({ productId: item.product._id, productName: item.product.name, date: when, location: "store", type: "adjustment", qtyMl: direction === "remove" ? -ml : ml, refType: "manual", remark: why, createdBy: uid(req) });
  return sendSuccess(res, { ml: direction === "remove" ? -ml : ml }, `Stock ${direction === "remove" ? "removed" : "added"}: ${toBottlesText(ml, item.unitMl)}.`, 201);
};

// GET /alcohol-stock/movements?productId&from&to&location&type&limit
export const getMovements = async (req, res) => {
  const { productId, from, to, location, type } = req.query;
  if (from && !DATE_RE.test(from)) return sendError(res, "'from' must be a date as YYYY-MM-DD.");
  if (to && !DATE_RE.test(to)) return sendError(res, "'to' must be a date as YYYY-MM-DD.");
  const limit = Math.min(Math.max(Number(req.query.limit) || 2000, 1), 10000);
  const filter = {};
  if (productId) filter.productId = productId;
  if (location) filter.location = location;
  if (type) filter.type = type;
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = dayStart(from);
    if (to) filter.date.$lt = new Date(dayStart(to).getTime() + DAY); // 'to' inclusive
  }
  const rows = await AlcoholStockMovement.find(filter).sort({ date: 1, createdAt: 1 }).lean();
  const out = rows.slice(0, limit).map((m) => ({
    id: String(m._id), productId: String(m.productId), productName: m.productName || "", date: iso(m.date), location: m.location,
    type: m.type, qtyMl: m.qtyMl, refType: m.refType || "", refId: m.refId || "", remark: m.remark || "", createdAt: iso(m.createdAt),
  }));
  return sendSuccess(res, { rows: out, count: out.length, truncated: rows.length > limit });
};