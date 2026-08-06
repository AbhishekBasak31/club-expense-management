import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// Manual, lump-sum expense amounts entered directly on the P&L page —
// for expense categories that are never fed by an actual Purchase or
// Expense entry (e.g. Depreciation, Interest, one-off provisions,
// anything the user just wants to punch in a number for). One row per
// exact category leaf per month. ADDED on top of whatever real,
// transaction-computed amount already exists for that same category
// (which is normally ₹0 for these, since by definition nothing flows
// through Purchase/Expense for them) — never a replacement, so this
// stays correct even if a category later also picks up real entries.
// ─────────────────────────────────────────────────────────────────
const ManualExpenseSchema = new mongoose.Schema(
  {
    month            : { type: String, required: true }, // "YYYY-MM"
    groupHeadName    : { type: String, required: true },
    groupName        : { type: String, required: true },
    mainCategoryName : { type: String, default: "" },
    subCategoryName  : { type: String, default: "" },
    baseCategoryName : { type: String, default: "" },
    amount           : { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One entry per exact category path per month.
ManualExpenseSchema.index(
  { month: 1, groupHeadName: 1, groupName: 1, mainCategoryName: 1, subCategoryName: 1, baseCategoryName: 1 },
  { unique: true }
);
ManualExpenseSchema.index({ month: 1 });

export const ManualExpense = mongoose.model("ManualExpense", ManualExpenseSchema);
export default ManualExpense;