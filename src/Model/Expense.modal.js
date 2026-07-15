import mongoose from "mongoose";

// One line item within an expense entry
const ExpenseItemSchema = new mongoose.Schema(
  {
    expenseType     : { type: String, enum: ["fixed", "variable", "capex"], required: true },

    // ── Group Head / Group — free-text labels only (e.g. "COGS", "Food Expense").
    // NOT linked to the Category collection — Category stays a strict
    // main→sub→base tree. These two are stored as plain strings exactly as
    // typed on the expense form, purely for dashboard grouping/display.
    groupHeadName   : { type: String, default: "" },
    groupName       : { type: String, default: "" },

    // ── Real category lineage (main → sub → base), same pattern already
    // used for main/sub — baseCategoryId/Name was missing before, even
    // though the Category model has always supported a "base" level.
    categoryId      : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    categoryName    : { type: String, default: "" },
    subCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryName : { type: String, default: "" },
    baseCategoryId  : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    baseCategoryName: { type: String, default: "" },

    description     : { type: String, required: true, trim: true },
    qty             : { type: Number, default: 1 },
    unitPrice       : { type: Number, required: true },
    discount        : { type: Number, default: 0 }, // ₹ amount, applied before GST

    // server-calculated — never trusted from client
    amount          : { type: Number, default: 0 }, // (qty × unitPrice) − discount
    gstPercent      : { type: Number, default: 0 },
    gstAmount       : { type: Number, default: 0 }, // amount × gstPercent/100
    netAmount       : { type: Number, default: 0 }, // amount + gstAmount

    hsnSac          : { type: String, default: "" },

    vendorId        : { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    vendorName      : { type: String, default: "" },

    paymentMode     : { type: String, enum: ["cash", "upi", "cheque", "bank_transfer", "credit"], default: "cash" },
    billNo          : { type: String, default: "" },
    receiptUrl      : { type: String, default: "" },
    remarks         : { type: String, default: "" },

    // Free-form custom field — {label, value} pair entered on the form
    customField     : {
      label : { type: String, default: "" },
      value : { type: String, default: "" },
    },

    // ── Verification — for now "verifiedBy" is always "Admin" since there's
    // no role-based access control yet to capture a real per-user identity.
    // Once RBAC exists, verifiedBy should be switched to store the actual
    // logged-in user's name/id at verification time. ──
    verificationStatus : { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
    verifiedBy         : { type: String, default: "" },
    verifiedAt         : { type: Date, default: null },
  },
  { _id: true }
);

const ExpenseEntrySchema = new mongoose.Schema(
  {
    date            : { type: Date, required: true, index: true },
    referenceNumber : { type: String, default: "" }, // auto: EXP-00001

    items           : [ExpenseItemSchema],

    // entry-level totals — all server-calculated
    subTotal        : { type: Number, default: 0 },
    totalGST        : { type: Number, default: 0 },
    grandTotal      : { type: Number, default: 0 },

    notes           : { type: String, default: "" },
    createdBy       : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ExpenseEntrySchema.index({ date: -1 });
ExpenseEntrySchema.index({ referenceNumber: 1 });
ExpenseEntrySchema.index({ "items.groupHeadName": 1 });
ExpenseEntrySchema.index({ "items.groupName": 1 });
ExpenseEntrySchema.index({ "items.expenseType": 1 });
ExpenseEntrySchema.index({ "items.verificationStatus": 1 });

export const ExpenseEntry = mongoose.model("ExpenseEntry", ExpenseEntrySchema);
export default ExpenseEntry;