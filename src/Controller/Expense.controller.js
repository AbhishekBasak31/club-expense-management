import { ExpenseEntry } from "../Model/Expense.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// HELPER — recalculate all amounts server-side (never trust client)
// ─────────────────────────────────────────────────────────────────
const calculateItems = (items = []) => {
  const calculated = items.map((item) => {
    const qty       = Number(item.qty) || 1;
    const unitPrice = Number(item.unitPrice) || 0;
    const gstPercent = Number(item.gstPercent) || 0;

    const amount    = qty * unitPrice;
    const gstAmount = (amount * gstPercent) / 100;
    const netAmount = amount + gstAmount;

    return { ...item, qty, unitPrice, gstPercent, amount, gstAmount, netAmount };
  });

  const subTotal   = calculated.reduce((s, i) => s + i.amount, 0);
  const totalGST   = calculated.reduce((s, i) => s + i.gstAmount, 0);
  const grandTotal = subTotal + totalGST;

  return { calculated, subTotal, totalGST, grandTotal };
};

// Generate next reference number: EXP-00001, EXP-00002...
const nextReference = async () => {
  const count = await ExpenseEntry.countDocuments();
  return `EXP-${String(count + 1).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────
export const createExpense = async (req, res) => {
  const { date, items, notes } = req.body;

  if (!date) return sendError(res, "Date is required.");
  if (!Array.isArray(items) || items.length === 0)
    return sendError(res, "At least one expense item is required.");

  // Validate each item has required fields
  for (const item of items) {
    if (!item.expenseType || !item.description || item.unitPrice == null)
      return sendError(res, "Each item needs expenseType, description and unitPrice.");
  }

  const { calculated, subTotal, totalGST, grandTotal } = calculateItems(items);

  const entry = await ExpenseEntry.create({
    date,
    referenceNumber: await nextReference(),
    items: calculated,
    subTotal, totalGST, grandTotal,
    notes: notes || "",
    createdBy: req.user.userId,
  });

  return sendSuccess(res, entry, "Expense entry created.", 201);
};

// ─────────────────────────────────────────────────────────────────
// LIST — with date range + expenseType filter + pagination
// ─────────────────────────────────────────────────────────────────
export const getExpenses = async (req, res) => {
  const { from, to, expenseType, page = 1, limit = 50 } = req.query;
  const filter = {};

  if (from && to) {
    filter.date = { $gte: new Date(from), $lte: new Date(to) };
  }
  if (expenseType) {
    filter["items.expenseType"] = expenseType;
  }

  const pageNum  = Number(page);
  const limitNum = Number(limit);

  const [data, total] = await Promise.all([
    ExpenseEntry.find(filter)
      .sort({ date: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    ExpenseEntry.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    data, total, page: pageNum, totalPages: Math.ceil(total / limitNum),
  });
};

// ─────────────────────────────────────────────────────────────────
// GET ONE
// ─────────────────────────────────────────────────────────────────
export const getExpenseById = async (req, res) => {
  const entry = await ExpenseEntry.findById(req.params.id).lean();
  if (!entry) return sendError(res, "Expense entry not found.", 404);
  return sendSuccess(res, entry);
};

// ─────────────────────────────────────────────────────────────────
// UPDATE — recalculates totals
// ─────────────────────────────────────────────────────────────────
export const updateExpense = async (req, res) => {
  const { date, items, notes } = req.body;

  const entry = await ExpenseEntry.findById(req.params.id);
  if (!entry) return sendError(res, "Expense entry not found.", 404);

  if (items) {
    const { calculated, subTotal, totalGST, grandTotal } = calculateItems(items);
    entry.items = calculated;
    entry.subTotal = subTotal;
    entry.totalGST = totalGST;
    entry.grandTotal = grandTotal;
  }
  if (date) entry.date = date;
  if (notes !== undefined) entry.notes = notes;

  await entry.save();
  return sendSuccess(res, entry, "Expense entry updated.");
};

// ─────────────────────────────────────────────────────────────────
// DELETE (hard delete — expense entries can be removed)
// ─────────────────────────────────────────────────────────────────
export const deleteExpense = async (req, res) => {
  const entry = await ExpenseEntry.findByIdAndDelete(req.params.id);
  if (!entry) return sendError(res, "Expense entry not found.", 404);
  return sendSuccess(res, null, "Expense entry deleted.");
};

// ─────────────────────────────────────────────────────────────────
// SUMMARY — KPI totals for dashboard
// ─────────────────────────────────────────────────────────────────
export const getExpenseSummary = async (req, res) => {
  const { from, to } = req.query;
  const match = {};
  if (from && to) match.date = { $gte: new Date(from), $lte: new Date(to) };

  const result = await ExpenseEntry.aggregate([
    { $match: match },
    { $group: {
        _id: null,
        totalExpense: { $sum: "$grandTotal" },
        totalGST:     { $sum: "$totalGST" },
        entryCount:   { $sum: 1 },
    }},
  ]);

  const summary = result[0] || { totalExpense: 0, totalGST: 0, entryCount: 0 };
  delete summary._id;
  return sendSuccess(res, summary);
};

// ─────────────────────────────────────────────────────────────────
// EXPENSE REGISTER REPORT
// Flattens each item into a row with entry-level context.
// Supports date range + expenseType + category filters.
// ─────────────────────────────────────────────────────────────────
export const getExpenseRegister = async (req, res) => {
  const { from, to, expenseType } = req.query;
  const match = {};
  if (from && to) match.date = { $gte: new Date(from), $lte: new Date(to) };

  const pipeline = [
    { $match: match },
    { $unwind: "$items" },
  ];

  // filter by expenseType at item level
  if (expenseType) {
    pipeline.push({ $match: { "items.expenseType": expenseType } });
  }

  pipeline.push(
    { $sort: { date: -1 } },
    { $project: {
        _id: 0,
        entryId:        "$_id",
        date:           1,
        referenceNumber:1,
        expenseType:    "$items.expenseType",
        categoryName:   "$items.categoryName",
        subCategoryName:"$items.subCategoryName",
        description:    "$items.description",
        qty:            "$items.qty",
        unitPrice:      "$items.unitPrice",
        amount:         "$items.amount",
        gstPercent:     "$items.gstPercent",
        gstAmount:      "$items.gstAmount",
        netAmount:      "$items.netAmount",
        vendorName:     "$items.vendorName",
        paymentMode:    "$items.paymentMode",
        billNo:         "$items.billNo",
    }},
  );

  const rows = await ExpenseEntry.aggregate(pipeline);

  // grand totals for the report footer
  const totals = rows.reduce(
    (acc, r) => ({
      amount:    acc.amount + r.amount,
      gstAmount: acc.gstAmount + r.gstAmount,
      netAmount: acc.netAmount + r.netAmount,
    }),
    { amount: 0, gstAmount: 0, netAmount: 0 }
  );

  return sendSuccess(res, { rows, totals, count: rows.length });
};