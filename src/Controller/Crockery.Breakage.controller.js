import { Breakage } from "../Model/Crockery.Breakage.modal.js";
import { Product } from "../Model/product.model.js";
import { StockEntry } from "../Model/Stock.model.js";
import { ExpenseEntry } from "../Model/Expense.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// CONFIRMED against a real Category Master screenshot: there is no
// single "Crockery" sub-category. There are several distinct
// sub-categories with "Crockery" in the name, each under a different
// parent path:
//   - "Bar Crockery"     → CAPEX > Bar > Bar Equipment
//   - "Kitchen Crockery"  → CAPEX > Kitchen > Kitchen Equipment
//   - "Crockery Rental"   → OC > Operation Expense > Rental
//
// Bar Crockery and Kitchen Crockery are both CAPEX — owned inventory,
// exactly what a breakage report is meant to track (stock you hold
// that decreases when something breaks). Crockery Rental is
// deliberately EXCLUDED here: it's an Operating Cost line for rented
// items, and a rental company's crockery doesn't draw down "our
// current stock" the same way owned inventory does — a piece breaking
// there is more likely a damage fee than a stock event. This is a
// judgment call, not something the screenshot settled on its own — if
// rented crockery breakage should actually be tracked here too, add
// "Crockery Rental" to the list below.
// ─────────────────────────────────────────────────────────────────
const CROCKERY_SUB_CATEGORIES = ["Bar Crockery", "Kitchen Crockery"];

async function getCrockeryProducts() {
  return Product.find({ subCategoryName: { $in: CROCKERY_SUB_CATEGORIES }, isActive: true }).sort({ name: 1 }).lean();
}

export const createBreakageEntry = async (req, res) => {
  const { productId, date, qtyBroken, usecase, remarks } = req.body;
  if (!productId) return sendError(res, "Select a crockery item.");
  if (!date) return sendError(res, "Date is required.");
  if (qtyBroken == null || Number(qtyBroken) <= 0) return sendError(res, "Enter a valid quantity broken.");

  const doc = await Breakage.create({
    productId, date, qtyBroken: Number(qtyBroken),
    usecase: usecase?.trim() || "", remarks: remarks?.trim() || "",
    createdBy: req.user?.userId ?? null, updatedBy: req.user?.userId ?? null,
  });
  const populated = await doc.populate("productId", "name uomName currentPrice purchasePrice");
  return sendSuccess(res, populated, "Breakage logged.", 201);
};

export const deleteBreakageEntry = async (req, res) => {
  const doc = await Breakage.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Breakage entry not found.", 404);
  doc.isActive = false;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, null, "Deleted.");
};

// Opening stock for a product in a given month — same fallback rule
// StockEntry.model.js documents: if this month has no entry, fall back
// to the previous month's closing stock; default to 0 if neither
// exists (a genuinely new item with no stock history yet).
async function getOpeningStock(productId, month) {
  const thisMonth = await StockEntry.findOne({ productId, month }).lean();
  if (thisMonth) return thisMonth.openingStock || 0;

  const [year, mon] = month.split("-").map(Number);
  const prevMonth = mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
  const prev = await StockEntry.findOne({ productId, month: prevMonth }).lean();
  return prev ? prev.closingStock || 0 : 0;
}

// GET /monthly?month=YYYY-MM
// One row per crockery item: opening stock (from Stock List), purchased
// stock for the month (summed from real purchase entries, matched to
// the product by name — same convention as the Alcohol Purchase
// Report), one column per DAY of breakage qty, total breakage qty/
// value, and current stock. Current stock is computed EXACTLY as
// specified — openingStock − totalBreakageQty — not netted against
// purchased stock, even though that may look unusual for a stock
// figure; that's the formula given, not a simplification of mine.
export const getMonthlyBreakageReport = async (req, res) => {
  const { month } = req.query; // "YYYY-MM"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  const [year, mon] = month.split("-").map(Number);
  const startDate = new Date(year, mon - 1, 1, 0, 0, 0, 0);
  const endDate = new Date(year, mon, 0, 23, 59, 59, 999);
  const daysInMonth = endDate.getDate();

  const products = await getCrockeryProducts();
  const productByNameLower = new Map(products.map(p => [p.name.trim().toLowerCase(), p]));
  const productIds = products.map(p => p._id);

  // Purchased stock — summed qty from real purchase entries this month,
  // matched to the product by item description (same convention as the
  // Alcohol Purchase Report).
  const expenseEntries = await ExpenseEntry.find({
    status: "final",
    incurredDate: { $gte: startDate, $lte: endDate },
  }).lean();
  const purchasedQtyByProduct = new Map();
  expenseEntries.forEach(entry => {
    (entry.items || []).forEach(item => {
      if (item.isVoucher) return;
      const raw = (item.description || "").trim().toLowerCase();
      const product = productByNameLower.get(raw);
      if (!product) return;
      const pid = String(product._id);
      purchasedQtyByProduct.set(pid, (purchasedQtyByProduct.get(pid) || 0) + Number(item.qty || 0));
    });
  });

  // Day-wise breakage qty + the most recent usecase logged this month,
  // per product.
  const breakageEntries = await Breakage.find({
    isActive: true, productId: { $in: productIds }, date: { $gte: startDate, $lte: endDate },
  }).sort({ date: 1 }).lean();
  const dayQtyByProduct = new Map(); // pid -> { [day]: qty }
  const usecaseByProduct = new Map(); // pid -> most recent usecase
  products.forEach(p => dayQtyByProduct.set(String(p._id), {}));
  breakageEntries.forEach(entry => {
    const pid = String(entry.productId);
    if (!dayQtyByProduct.has(pid)) return;
    const day = new Date(entry.date).getDate();
    const days = dayQtyByProduct.get(pid);
    days[day] = (days[day] || 0) + entry.qtyBroken;
    if (entry.usecase) usecaseByProduct.set(pid, entry.usecase); // sorted ascending by date, so the last write wins = most recent
  });

  // Opening stock — one query per product (StockEntry isn't indexed for
  // an efficient $in-across-months batch fetch here, and this list is
  // small enough that N queries is fine; revisit if the crockery
  // catalog grows into the hundreds).
  const rows = await Promise.all(products.map(async p => {
    const pid = String(p._id);
    const openingStock = await getOpeningStock(pid, month);
    const purchasedStock = purchasedQtyByProduct.get(pid) || 0;
    const dailyQty = dayQtyByProduct.get(pid) || {};
    const totalBreakageQty = Object.values(dailyQty).reduce((s, q) => s + q, 0);
    const unitPrice = p.currentPrice ?? p.purchasePrice ?? 0;
    const totalBreakageValue = Math.round(totalBreakageQty * unitPrice * 100) / 100;
    const currentStock = openingStock - totalBreakageQty; // exact formula as specified

    // Map subCategory Name exactly to intended Kitchen or Bar label dynamically
    let areaName = "";
    if (p.subCategoryName === "Kitchen Crockery") areaName = "Kitchen";
    else if (p.subCategoryName === "Bar Crockery") areaName = "Bar";
    else areaName = p.subCategoryName || "";

    return {
      productId: pid,
      crockeryDetails: p.name,
      uom: p.uomName || "",
      usecase: areaName, 
      unitPrice,
      openingStock,
      purchasedStock,
      dailyQty,
      totalBreakageQty,
      totalBreakageValue,
      currentStock,
    };
  }));

  return sendSuccess(res, { month, daysInMonth, rows });
};