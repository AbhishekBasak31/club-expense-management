import { ManualExpense } from "../Model/ManualExpense.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/manual-expenses?month=YYYY-MM
// Every manual override entered for the given month.
// ─────────────────────────────────────────────────────────────────
export const getManualExpenses = async (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");

  const rows = await ManualExpense.find({ month }).lean();
  return sendSuccess(res, rows.map((r) => ({
    groupHeadName: r.groupHeadName,
    groupName: r.groupName,
    mainCategoryName: r.mainCategoryName,
    subCategoryName: r.subCategoryName,
    baseCategoryName: r.baseCategoryName,
    amount: r.amount,
  })));
};

// ─────────────────────────────────────────────────────────────────
// POST /api/v1/manual-expenses — upsert one category leaf's amount for
// one month.
// body: { month, groupHeadName, groupName, mainCategoryName?,
//         subCategoryName?, baseCategoryName?, amount }
// ─────────────────────────────────────────────────────────────────
export const upsertManualExpense = async (req, res) => {
  const { month, groupHeadName, groupName, mainCategoryName, subCategoryName, baseCategoryName, amount } = req.body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  if (!groupHeadName || !groupName) return sendError(res, "groupHeadName and groupName are required.");

  const key = {
    month, groupHeadName, groupName,
    mainCategoryName: mainCategoryName || "",
    subCategoryName: subCategoryName || "",
    baseCategoryName: baseCategoryName || "",
  };

  const entry = await ManualExpense.findOneAndUpdate(
    key,
    { $set: { amount: Number(amount) || 0 } },
    { new: true, upsert: true, runValidators: true }
  );

  return sendSuccess(res, entry, "Manual expense amount saved.");
};

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/manual-expenses/summary?from=YYYY-MM&to=YYYY-MM
// Total manual-override amount per month, for a range — used by the
// P&L page's Yearly/All-time figures so they correctly include manual
// entries from every month in scope, not just the currently-viewed one.
// Omit from/to for all-time.
// ─────────────────────────────────────────────────────────────────
export const getManualExpenseSummary = async (req, res) => {
  const { from, to } = req.query;
  const match = {};
  if (from && to) match.month = { $gte: from, $lte: to };

  const rows = await ManualExpense.aggregate([
    { $match: match },
    { $group: { _id: "$month", total: { $sum: { $ifNull: ["$amount", 0] } } } },
    { $sort: { _id: 1 } },
  ]).allowDiskUse(true);

  return sendSuccess(res, rows.map((r) => ({ month: r._id, total: r.total })));
};