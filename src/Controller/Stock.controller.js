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
    ]),

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

    const currentStock = purchaseMap.get(normName(p.name)) || 0;
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
    };
  });

  return sendSuccess(res, rows);
};

// ─────────────────────────────────────────────────────────────────
// POST /api/v1/stock — upsert Opening/Closing Stock for one product+month
// body: { productId, month, openingStock?, closingStock? }
// ─────────────────────────────────────────────────────────────────
export const upsertStockEntry = async (req, res) => {
  const { productId, month, openingStock, closingStock } = req.body;
  if (!productId) return sendError(res, "productId is required.");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");

  const update = {};
  if (openingStock !== undefined) update.openingStock = Number(openingStock) || 0;
  if (closingStock !== undefined) update.closingStock = Number(closingStock) || 0;

  const entry = await StockEntry.findOneAndUpdate(
    { productId, month },
    { $set: update },
    { new: true, upsert: true, runValidators: true }
  );

  return sendSuccess(res, entry, "Stock figures saved.");
};