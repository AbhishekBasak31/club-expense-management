import { Product } from "../Model/product.model.js";
import { ExpenseEntry } from "../Model/Expense.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// Alcohol Purchase Report — two views over the SAME underlying data:
// real purchase entries (ExpenseEntry documents with items[].isVoucher
// === false), matched to Product Master by name (case-insensitive,
// trimmed — same convention as everywhere else purchase items are
// matched to products in this app), restricted to products whose
// subCategoryName is 'Alcohol'.
//
// Field names below are confirmed against the real Expense.modal.js:
// incurredDate (report-authoritative date), items[].isVoucher,
// items[].qty, items[].description, items[].amount (GST-exclusive,
// discount-applied — the real amount paid on that purchase), and
// status: 'final'.
//
// Both endpoints use incurredDate (not date/Invoice Date) as the
// authoritative report date, matching the rule already established for
// every other report/consumption endpoint in this app.
// ─────────────────────────────────────────────────────────────────

async function getAlcoholProducts() {
  return Product.find({ subCategoryName: "Alcohol", isActive: true }).sort({ name: 1 }).lean();
}

function matchProduct(productByNameLower, item) {
  const raw = (item.description || "").trim().toLowerCase();
  return raw ? productByNameLower.get(raw) : null;
}

// GET /monthly?month=YYYY-MM
// One row per alcohol item: one column per DAY of that month (purchase
// qty only, per the explicit "only purchase qty" instruction), plus a
// total qty and total price column summing the whole month.
//
// Total Price sums each real purchase item's own `amount` field (qty ×
// unitPrice − discount, GST-exclusive, confirmed against Expense.modal.js)
// — NOT totalQty × Product.currentPrice. That distinction matters: the
// unit price actually paid on a purchase made mid-month may differ from
// today's current reference price, and a report meant to show what was
// actually spent has to reflect the real historical amount, not a
// today's-price estimate. `price` on the row is still the product's
// current reference price — shown for context, never used in the total.
export const getMonthlyAlcoholReport = async (req, res) => {
  const { month } = req.query; // "YYYY-MM"
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  const [year, mon] = month.split("-").map(Number);
  const startDate = new Date(year, mon - 1, 1, 0, 0, 0, 0);
  const endDate = new Date(year, mon, 0, 23, 59, 59, 999); // last day of the month
  const daysInMonth = endDate.getDate();

  const products = await getAlcoholProducts();
  const productByNameLower = new Map(products.map(p => [p.name.trim().toLowerCase(), p]));

  const entries = await ExpenseEntry.find({
    status: "final",
    incurredDate: { $gte: startDate, $lte: endDate },
  }).lean();

  // dayData[productId] = { [dayOfMonth]: { qty, amount } }
  const dayData = {};
  products.forEach(p => { dayData[String(p._id)] = {}; });

  entries.forEach(entry => {
    const day = new Date(entry.incurredDate).getDate();
    (entry.items || []).forEach(item => {
      if (item.isVoucher) return; // purchases only, not expense/voucher items
      const product = matchProduct(productByNameLower, item);
      if (!product) return;
      const pid = String(product._id);
      const bucket = dayData[pid][day] || { qty: 0, amount: 0 };
      bucket.qty += Number(item.qty || 0);
      bucket.amount += Number(item.amount || 0);
      dayData[pid][day] = bucket;
    });
  });

  const rows = products.map(p => {
    const days = dayData[String(p._id)] || {};
    const dailyQty = {};
    let totalQty = 0, totalPrice = 0;
    Object.entries(days).forEach(([day, bucket]) => {
      dailyQty[day] = bucket.qty;
      totalQty += bucket.qty;
      totalPrice += bucket.amount;
    });
    return {
      productId: String(p._id),
      alcoholName: p.name,
      alcoholType: p.baseCategoryName || "",
      price: p.currentPrice ?? p.purchasePrice ?? 0, // current reference price only — not part of the total
      dailyQty, // e.g. { "1": 5, "15": 3 } — days with no purchase are simply absent
      totalQty,
      totalPrice: Math.round(totalPrice * 100) / 100,
    };
  });

  return sendSuccess(res, { month, daysInMonth, rows });
};

// GET /financial-year?startYear=2026   → April 2026 through March 2027
// One row per alcohol item: one {qty, price} pair per month, April
// first through March last, plus a total qty and total price column
// summing the full year. Same amount-based (not currentPrice-based)
// calculation as the monthly report above, for the same reason —
// `price` per month is the real amount spent that month, from actual
// purchase entries, not an estimate off today's price.
export const getFinancialYearAlcoholReport = async (req, res) => {
  const { startYear } = req.query;
  const year = Number(startYear);
  if (!year || Number.isNaN(year)) return sendError(res, "A valid startYear is required (e.g. 2026 for FY 2026–27).");

  // April (month index 3) of `year` through March (month index 2) of `year + 1`.
  const startDate = new Date(year, 3, 1, 0, 0, 0, 0);
  const endDate = new Date(year + 1, 2, 31, 23, 59, 59, 999);
  // Calendar month index (0=Jan..11=Dec) in April-first order, matching the FY column order.
  const FY_MONTH_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];

  const products = await getAlcoholProducts();
  const productByNameLower = new Map(products.map(p => [p.name.trim().toLowerCase(), p]));

  const entries = await ExpenseEntry.find({
    status: "final",
    incurredDate: { $gte: startDate, $lte: endDate },
  }).lean();

  // monthData[productId] = { [calendarMonthIndex]: { qty, amount } }
  const monthData = {};
  products.forEach(p => { monthData[String(p._id)] = {}; });

  entries.forEach(entry => {
    const d = new Date(entry.incurredDate);
    const mIdx = d.getMonth(); // 0-11
    (entry.items || []).forEach(item => {
      if (item.isVoucher) return;
      const product = matchProduct(productByNameLower, item);
      if (!product) return;
      const pid = String(product._id);
      const bucket = monthData[pid][mIdx] || { qty: 0, amount: 0 };
      bucket.qty += Number(item.qty || 0);
      bucket.amount += Number(item.amount || 0);
      monthData[pid][mIdx] = bucket;
    });
  });

  const rows = products.map(p => {
    const months = FY_MONTH_ORDER.map(mIdx => {
      const bucket = monthData[String(p._id)]?.[mIdx] || { qty: 0, amount: 0 };
      return { monthIndex: mIdx, qty: bucket.qty, price: Math.round(bucket.amount * 100) / 100 };
    });
    const totalQty = months.reduce((s, m) => s + m.qty, 0);
    const totalPrice = months.reduce((s, m) => s + m.price, 0);
    return {
      productId: String(p._id),
      alcoholName: p.name,
      alcoholType: p.baseCategoryName || "",
      price: p.currentPrice ?? p.purchasePrice ?? 0, // current reference price only — not part of the total
      months, // 12 entries, April first
      totalQty,
      totalPrice: Math.round(totalPrice * 100) / 100,
    };
  });

  return sendSuccess(res, { financialYear: `${year}-${String(year + 1).slice(2)}`, rows });
};