import { StockEntry } from "../Model/Stock.model.js";
import { ExpenseEntry } from "../Model/Expense.modal.js";
import { Product } from "../Model/product.model.js";
import { Category } from "../Model/catagory.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// Previous calendar month, as "YYYY-MM" — used to roll a product's
// closing stock forward into the next month's opening stock when no
// explicit opening figure has been entered yet.
function prevMonthKey(month) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1)); // m is 1-based; m-2 = (m-1)-1
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Products are matched to Purchase-entry line items by NAME (trimmed,
// case-insensitive) — the same convention Product.currentPrice/
// lastPriceDate already use to auto-sync from expense entries. Purchase
// items don't carry a productId reference, only a free-text description
// (auto-filled from the Product search when the row was added), so this
// is the existing, established way this codebase already ties the two
// together — not a new assumption introduced here.
const normName = (s) => (s || "").trim().toLowerCase();

// Real number of calendar days in a "YYYY-MM" month string — used to
// validate a Stock Allocation day actually exists in that month (e.g.
// rejecting Day 30 for February).
function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}


// ─────────────────────────────────────────────────────────────────
// GET /api/v1/stock?month=YYYY-MM
// ─────────────────────────────────────────────────────────────────
export const getStockList = async (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");

  // Current Stock is cumulative — total quantity ever purchased for this
  // product, up to today — NOT scoped to the selected month. The month
  // selector only controls which month's Opening/Closing Stock you're
  // looking at/editing; Current Stock reads the same regardless of which
  // month is selected, since it represents "how much have I actually
  // bought to date," not "how much this specific month."
  const asOf = new Date(); // now, in UTC — entry dates are always stored at UTC midnight

  const [products, mainCategories, purchaseAgg, stockRows, prevStockRows] = await Promise.all([
    Product.find({ isActive: true }).sort({ name: 1 }).lean(),

    // Resolves Group Head / Group for each product via its Main
    // Category — Product itself only links to Main/Sub/Base directly;
    // Group Head and Group live one level up, on the Category record
    // that mainCategoryId points to (denormalized there already).
    Category.find({ level: "main" }).lean(),

    // Cumulative Current Stock — every final Purchase-entry item (never
    // vouchers) dated up to today, for every product name, summed in one
    // aggregation rather than querying per product in a loop.
    ExpenseEntry.aggregate([
      { $match: { status: "final", date: { $lte: asOf } } },
      { $unwind: "$items" },
      { $match: { "items.isVoucher": { $ne: true } } },
      { $group: {
          _id: { $toLower: { $trim: { input: { $ifNull: ["$items.description", ""] } } } },
          totalQty: { $sum: { $ifNull: ["$items.qty", 0] } },
        } },
    ]).allowDiskUse(true),

    StockEntry.find({ month }).lean(),
    StockEntry.find({ month: prevMonthKey(month) }).lean(),
  ]);

  const purchaseMap = new Map(purchaseAgg.map((p) => [p._id, p.totalQty]));
  const stockMap     = new Map(stockRows.map((s) => [String(s.productId), s]));
  const prevStockMap = new Map(prevStockRows.map((s) => [String(s.productId), s]));
  const mainCatMap   = new Map(mainCategories.map((c) => [String(c._id), c]));

  const rows = products.map((p) => {
    const stock = stockMap.get(String(p._id));
    const prev  = prevStockMap.get(String(p._id));
    const mainCat = p.mainCategoryId ? mainCatMap.get(String(p.mainCategoryId)) : null;

    const rawCurrentStock = purchaseMap.get(normName(p.name)) || 0;
    // Stock Allocation — day-by-day quantity allocated within this
    // month (see allocateStock below) is deducted from Current Stock
    // here, so "Current Stock" always means "what's actually still
    // available to allocate," not the raw all-time purchased total.
    // Consumption then naturally reflects this too, since it's derived
    // from currentStock below — no separate consumption adjustment
    // needed.
    const dailyAllocations = stock?.dailyAllocations || [];
    const totalAllocated = dailyAllocations.reduce((s, a) => s + (a.qty || 0), 0);
    const currentStock = rawCurrentStock - totalAllocated;
    // Opening Stock: this month's saved figure if one was entered,
    // otherwise last month's closing stock rolls forward automatically,
    // otherwise 0 (first month this product has ever been tracked).
    const openingStock = stock?.openingStock ?? prev?.closingStock ?? 0;
    const closingStock = stock?.closingStock ?? 0;
    // Consumption = (Opening + Current) - Closing.
    const consumption  = (openingStock + currentStock) - closingStock;

    return {
      productId:        String(p._id),
      productCode:       p.productCode || "",
      productName:       p.name,
      hsnCode:           p.hsnCode || "",
      uomName:           p.uomName || "",
      groupHeadName:     mainCat?.groupHeadName || "",
      groupName:         mainCat?.groupName || "",
      mainCategoryName:  p.mainCategoryName || "",
      subCategoryName:   p.subCategoryName || "",
      baseCategoryName:  p.baseCategoryName || "",
      openingStock, currentStock, consumption, closingStock,
      dailyAllocations,
    };
  });

  return sendSuccess(res, rows);
};

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/stock/summary?from=YYYY-MM&to=YYYY-MM
// Returns [{ month, totalOpening, totalClosing }, ...] — Opening/Closing
// Stock summed across EVERY product for each month in the range, with
// the same rollover behavior as getStockList (a month with no explicit
// Opening Stock saved defaults to the previous month's Closing Stock).
// If from/to are omitted, covers every month that has any stock data at
// all — used for "all time" totals.
// ─────────────────────────────────────────────────────────────────
export const getStockSummary = async (req, res) => {
  const { from, to } = req.query;

  let months;
  if (from && to) {
    if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) return sendError(res, "from/to must be YYYY-MM.");
    months = [];
    let [y, m] = from.split("-").map(Number);
    const [ey, em] = to.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
      m++; if (m > 12) { m = 1; y++; }
    }
  } else {
    const distinctMonths = await StockEntry.distinct("month");
    if (distinctMonths.length === 0) return sendSuccess(res, []);
    months = distinctMonths.sort();
  }

  const firstMonth = months[0];
  const priorMonth = prevMonthKey(firstMonth);
  const lastMonth  = months[months.length - 1];

  // One query covers every month in range plus the one just before it
  // (needed purely for rollover into the first month) — not a query per
  // product per month.
  const allEntries = await StockEntry.find({ month: { $gte: priorMonth, $lte: lastMonth } }).lean();
  const byMonth = new Map();
  for (const e of allEntries) {
    if (!byMonth.has(e.month)) byMonth.set(e.month, new Map());
    byMonth.get(e.month).set(String(e.productId), e);
  }

  // Walks forward month by month, carrying each product's last-known
  // Closing Stock as the default Opening Stock for the next month it
  // doesn't have an explicit figure saved for.
  const lastClosing = new Map();
  const priorEntries = byMonth.get(priorMonth) || new Map();
  for (const [pid, e] of priorEntries) lastClosing.set(pid, e.closingStock || 0);

  const results = months.map((month) => {
    const entries = byMonth.get(month) || new Map();
    const productIds = new Set([...lastClosing.keys(), ...entries.keys()]);
    let totalOpening = 0, totalClosing = 0;
    for (const pid of productIds) {
      const e = entries.get(pid);
      const opening = e?.openingStock ?? lastClosing.get(pid) ?? 0;
      const closing = e?.closingStock ?? 0;
      totalOpening += opening;
      totalClosing += closing;
      lastClosing.set(pid, closing);
    }
    return { month, totalOpening, totalClosing };
  });

  return sendSuccess(res, results);
};

// ─────────────────────────────────────────────────────────────────
// POST /api/v1/stock — upsert Opening/Closing Stock for one product+month
// body: { productId, month, openingStock?, closingStock? }
// ─────────────────────────────────────────────────────────────────
export const upsertStockEntry = async (req, res) => {
  const { productId, month, openingStock, closingStock, closingStockPartialMl } = req.body;
  if (!productId) return sendError(res, "productId is required.");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");

  const update = {};
  if (openingStock !== undefined) update.openingStock = Number(openingStock) || 0;
  if (closingStock !== undefined) update.closingStock = Number(closingStock) || 0;
  // Raw ml component for Bar's partial-bottle tracking — the frontend
  // has already folded this into `closingStock` above (the number used
  // everywhere else); this is stored purely so it can be shown/edited
  // again later without reverse-engineering it back out.
  if (closingStockPartialMl !== undefined) update.closingStockPartialMl = Number(closingStockPartialMl) || 0;

  const entry = await StockEntry.findOneAndUpdate(
    { productId, month },
    { $set: update },
    { new: true, upsert: true, runValidators: true }
  );

  return sendSuccess(res, entry, "Stock figures saved.");
};

// ─────────────────────────────────────────────────────────────────
// POST /api/v1/stock/allocate — replaces the FULL set of day-by-day
// allocations for one product+month (not a per-day patch — the
// frontend always submits its complete merged draft, see
// StockAllocationPayload's own comment on the frontend for why).
// body: { productId, month, allocations: [{ day, qty }] }
//
// Validates every day is a real day within `month` (rejects e.g. Day 30
// for February), and that the total requested does NOT exceed this
// product's real Current Stock (raw all-time purchased quantity, before
// this allocation) — rejected outright rather than silently clamped, so
// the person sees an explicit error instead of a smaller allocation
// than they asked for.
//
// Returns the full updated row in the SAME shape getStockList returns,
// with Current Stock/Consumption already reflecting the new allocation
// total — the frontend trusts this response directly rather than
// recomputing anything itself.
// ─────────────────────────────────────────────────────────────────
export const allocateStock = async (req, res) => {
  const { productId, month, allocations } = req.body;
  if (!productId) return sendError(res, "productId is required.");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  if (!Array.isArray(allocations)) return sendError(res, "allocations must be an array.");

  const lastDay = daysInMonth(month);
  for (const a of allocations) {
    if (!Number.isInteger(a.day) || a.day < 1 || a.day > lastDay) {
      return sendError(res, `Day ${a.day} is not a valid day in ${month} (1–${lastDay}).`);
    }
    if (typeof a.qty !== "number" || a.qty < 0) {
      return sendError(res, `Invalid quantity for Day ${a.day}.`);
    }
  }

  const product = await Product.findById(productId).lean();
  if (!product) return sendError(res, "Product not found.", 404);

  const asOf = new Date();
  const [purchaseAgg, stock, prev, mainCategories] = await Promise.all([
    ExpenseEntry.aggregate([
      { $match: { status: "final", date: { $lte: asOf } } },
      { $unwind: "$items" },
      { $match: { "items.isVoucher": { $ne: true } } },
      { $match: { "items.description": { $regex: `^\\s*${normName(product.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, $options: "i" } } },
      { $group: { _id: null, totalQty: { $sum: { $ifNull: ["$items.qty", 0] } } } },
    ]).allowDiskUse(true),
    StockEntry.findOne({ productId, month }).lean(),
    StockEntry.findOne({ productId, month: prevMonthKey(month) }).lean(),
    Category.find({ level: "main" }).lean(),
  ]);

  const rawCurrentStock = purchaseAgg[0]?.totalQty || 0;
  const totalRequested = allocations.reduce((s, a) => s + a.qty, 0);
  if (totalRequested > rawCurrentStock) {
    return sendError(res, `Total allocated (${totalRequested}) exceeds Current Qty (${rawCurrentStock}) available for this product.`);
  }

  const updated = await StockEntry.findOneAndUpdate(
    { productId, month },
    { $set: { dailyAllocations: allocations } },
    { new: true, upsert: true, runValidators: true }
  );

  const mainCat = product.mainCategoryId
    ? mainCategories.find((c) => String(c._id) === String(product.mainCategoryId))
    : null;
  const openingStock = updated.openingStock ?? prev?.closingStock ?? 0;
  const closingStock = updated.closingStock ?? 0;
  const currentStock = rawCurrentStock - totalRequested;
  const consumption  = (openingStock + currentStock) - closingStock;

  return sendSuccess(res, {
    productId:        String(product._id),
    productCode:       product.productCode || "",
    productName:       product.name,
    hsnCode:           product.hsnCode || "",
    uomName:           product.uomName || "",
    groupHeadName:     mainCat?.groupHeadName || "",
    groupName:         mainCat?.groupName || "",
    mainCategoryName:  product.mainCategoryName || "",
    subCategoryName:   product.subCategoryName || "",
    baseCategoryName:  product.baseCategoryName || "",
    openingStock, currentStock, consumption, closingStock,
    closingStockPartialMl: updated.closingStockPartialMl || 0,
    dailyAllocations: updated.dailyAllocations || [],
  }, "Stock allocation saved.");
};

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/stock/consumption?from=YYYY-MM&to=YYYY-MM
// Powers the Consumption listing page. Two distinct modes depending on
// whether from/to are the same month or a genuine multi-month range:
//
//  - SINGLE MONTH (from === to): reuses the EXACT same formula and data
//    source as getStockList above (Current Stock = all-time cumulative
//    purchases, not scoped to the month) — so this page's single-month
//    numbers are always identical to the Stock List page for that same
//    month. No new formula for this case.
//
//  - RANGE (from !== to): no existing page computes this, so summing
//    each month's individual (opening + ALL-TIME-cumulative-current -
//    closing) would count that same all-time cumulative purchase figure
//    once per month in the range — wrong for anything more than one
//    month. Instead:
//      consumption = openingStock AT THE START of the range
//                   + quantity purchased DURING the range only
//                   - closingStock AT THE END of the range
//    (confirmed with the person building this — no prior page to stay
//    consistent with here, so this is the one place that formula is new)
// ─────────────────────────────────────────────────────────────────
export const getConsumptionList = async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to || !/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
    return sendError(res, "Both from and to (YYYY-MM) are required.");
  }

  const [products, mainCategories] = await Promise.all([
    Product.find({ isActive: true }).sort({ name: 1 }).lean(),
    Category.find({ level: "main" }).lean(),
  ]);
  const mainCatMap = new Map(mainCategories.map((c) => [String(c._id), c]));

  // Department is DERIVED, not a stored field — confirmed rule: Main
  // Category "Bar" (case-insensitive) marks a product as Bar; everything
  // else is Store. Matches the real category structure: COGS > Alcohol
  // & Beverages > Bar > (sub) > (specific drink).
  const departmentFor = (p) => ((p.mainCategoryName || "").trim().toLowerCase() === "bar" ? "Bar" : "Store");

  const buildRow = (p, mainCat, openingStock, closingStock, consumption, partialMl) => ({
    productId:         String(p._id),
    productCode:       p.productCode || "",
    productName:       p.name,
    groupHeadName:     mainCat?.groupHeadName || "",
    groupName:         mainCat?.groupName || "",
    mainCategoryName:  p.mainCategoryName || "",
    subCategoryName:   p.subCategoryName || "",
    baseCategoryName:  p.baseCategoryName || "",
    department:        departmentFor(p),
    openingStock, closingStock, consumption,
    closingStockPartialMl: partialMl,
    // "Partial" only ever fires from a real partial-ml figure being
    // saved (Bar items only, by construction — Store never sets this
    // field), so this doubles as an implicit department check with no
    // extra logic needed.
    status: partialMl > 0 ? "Partial" : "Complete",
  });

  if (from === to) {
    const month = from;
    const asOf = new Date();
    const [purchaseAgg, stockRows, prevStockRows] = await Promise.all([
      ExpenseEntry.aggregate([
        { $match: { status: "final", date: { $lte: asOf } } },
        { $unwind: "$items" },
        { $match: { "items.isVoucher": { $ne: true } } },
        { $group: {
            _id: { $toLower: { $trim: { input: { $ifNull: ["$items.description", ""] } } } },
            totalQty: { $sum: { $ifNull: ["$items.qty", 0] } },
          } },
      ]).allowDiskUse(true),
      StockEntry.find({ month }).lean(),
      StockEntry.find({ month: prevMonthKey(month) }).lean(),
    ]);

    const purchaseMap  = new Map(purchaseAgg.map((p) => [p._id, p.totalQty]));
    const stockMap      = new Map(stockRows.map((s) => [String(s.productId), s]));
    const prevStockMap  = new Map(prevStockRows.map((s) => [String(s.productId), s]));

    const rows = products.map((p) => {
      const stock   = stockMap.get(String(p._id));
      const prev    = prevStockMap.get(String(p._id));
      const mainCat = p.mainCategoryId ? mainCatMap.get(String(p.mainCategoryId)) : null;

      const currentStock = purchaseMap.get(normName(p.name)) || 0;
      const openingStock = stock?.openingStock ?? prev?.closingStock ?? 0;
      const closingStock = stock?.closingStock ?? 0;
      const consumption  = (openingStock + currentStock) - closingStock;

      return buildRow(p, mainCat, openingStock, closingStock, consumption, stock?.closingStockPartialMl || 0);
    });
    return sendSuccess(res, rows);
  }

  // ── Range ──
  const rangeStartDate = new Date(`${from}-01T00:00:00.000Z`);
  const [ey2, em2] = to.split("-").map(Number);
  const rangeEndDate = new Date(Date.UTC(ey2, em2, 0, 23, 59, 59, 999)); // last day of `to` month

  const [purchaseAgg, fromEntries, priorToFromEntries, toEntries] = await Promise.all([
    ExpenseEntry.aggregate([
      { $match: { status: "final", date: { $gte: rangeStartDate, $lte: rangeEndDate } } },
      { $unwind: "$items" },
      { $match: { "items.isVoucher": { $ne: true } } },
      { $group: {
          _id: { $toLower: { $trim: { input: { $ifNull: ["$items.description", ""] } } } },
          totalQty: { $sum: { $ifNull: ["$items.qty", 0] } },
        } },
    ]).allowDiskUse(true),
    StockEntry.find({ month: from }).lean(),
    StockEntry.find({ month: prevMonthKey(from) }).lean(),
    StockEntry.find({ month: to }).lean(),
  ]);

  const purchaseMap = new Map(purchaseAgg.map((p) => [p._id, p.totalQty]));
  const fromMap      = new Map(fromEntries.map((s) => [String(s.productId), s]));
  const priorFromMap = new Map(priorToFromEntries.map((s) => [String(s.productId), s]));
  const toMap         = new Map(toEntries.map((s) => [String(s.productId), s]));

  const rows = products.map((p) => {
    const mainCat   = p.mainCategoryId ? mainCatMap.get(String(p.mainCategoryId)) : null;
    const fromEntry  = fromMap.get(String(p._id));
    const toEntry    = toMap.get(String(p._id));
    const priorEntry = priorFromMap.get(String(p._id));

    const openingStock     = fromEntry?.openingStock ?? priorEntry?.closingStock ?? 0;
    const closingStock     = toEntry?.closingStock ?? 0;
    const purchasedInRange = purchaseMap.get(normName(p.name)) || 0;
    const consumption      = (openingStock + purchasedInRange) - closingStock;

    return buildRow(p, mainCat, openingStock, closingStock, consumption, toEntry?.closingStockPartialMl || 0);
  });

  return sendSuccess(res, rows);
};