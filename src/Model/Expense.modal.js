import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// EXPENSE ITEM — one line in an expense entry
// Carries the full 5-level category lineage denormalized so reports
// can group by any level without joining the Category collection.
// ─────────────────────────────────────────────────────────────────
const ExpenseItemSchema = new mongoose.Schema(
  {
    expenseType : { type: String, enum: ["fixed", "variable", "capex"], required: true },

    // ── 5-level category lineage ──────────────────────────────────
    groupHeadId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    groupHeadName : { type: String, default: "" },   // e.g. "COGS"

    groupId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    groupName : { type: String, default: "" },       // e.g. "Food Cost"

    categoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    categoryName : { type: String, default: "" },    // main — e.g. "Kitchen"

    subCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryName : { type: String, default: "" }, // e.g. "Non-Veg"

    baseCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    baseCategoryName : { type: String, default: "" }, // e.g. "Prawn"

    // ── Line-item details ─────────────────────────────────────────
    description : { type: String, required: true, trim: true },
    qty         : { type: Number, default: 1 },
    unitPrice   : { type: Number, required: true },
    
    // 👉 NEW: Discount field
    discount    : { type: Number, default: 0 },

    // server-calculated — never trusted from client
    amount    : { type: Number, default: 0 },  // (qty × unitPrice) - discount
    gstPercent: { type: Number, default: 0 },
    gstAmount : { type: Number, default: 0 },  // amount × gstPercent / 100
    netAmount : { type: Number, default: 0 },  // amount + gstAmount

    vendorId   : { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    vendorName : { type: String, default: "" },

    paymentMode : {
      type    : String,
      enum    : ["cash", "upi", "cheque", "bank_transfer", "credit"],
      default : "cash",
    },
    billNo     : { type: String, default: "" },
    receiptUrl : { type: String, default: "" },
    remarks    : { type: String, default: "" },
  },
  { _id: true }
);

// ─────────────────────────────────────────────────────────────────
// EXPENSE ENTRY — the parent document
// ─────────────────────────────────────────────────────────────────
const ExpenseEntrySchema = new mongoose.Schema(
  {
    date            : { type: Date, required: true, index: true },
    referenceNumber : { type: String, default: "" },

    items           : [ExpenseItemSchema],

    // entry-level totals — server-calculated
    subTotal   : { type: Number, default: 0 },
    totalGST   : { type: Number, default: 0 },
    grandTotal : { type: Number, default: 0 },

    notes     : { type: String, default: "" },
    createdBy : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ExpenseEntrySchema.index({ date: -1 });
ExpenseEntrySchema.index({ referenceNumber: 1 });
// Support dashboard queries that group/filter by group-head or group
ExpenseEntrySchema.index({ "items.groupHeadId": 1 });
ExpenseEntrySchema.index({ "items.groupId": 1 });

export const ExpenseEntry = mongoose.model("ExpenseEntry", ExpenseEntrySchema);
export default ExpenseEntry;