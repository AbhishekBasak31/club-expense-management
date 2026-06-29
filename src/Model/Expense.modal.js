import mongoose from "mongoose";

// One line item within an expense entry
const ExpenseItemSchema = new mongoose.Schema(
  {
    expenseType     : { type: String, enum: ["fixed", "variable", "capex"], required: true },

    categoryId      : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    categoryName    : { type: String, default: "" },
    subCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryName : { type: String, default: "" },

    description     : { type: String, required: true, trim: true },
    qty             : { type: Number, default: 1 },
    unitPrice       : { type: Number, required: true },

    // server-calculated — never trusted from client
    amount          : { type: Number, default: 0 }, // qty × unitPrice
    gstPercent      : { type: Number, default: 0 },
    gstAmount       : { type: Number, default: 0 }, // amount × gstPercent/100
    netAmount       : { type: Number, default: 0 }, // amount + gstAmount

    vendorId        : { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    vendorName      : { type: String, default: "" },

    paymentMode     : { type: String, enum: ["cash", "upi", "cheque", "bank_transfer", "credit"], default: "cash" },
    billNo          : { type: String, default: "" },
    receiptUrl      : { type: String, default: "" },
    remarks         : { type: String, default: "" },
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

export const ExpenseEntry = mongoose.model("ExpenseEntry", ExpenseEntrySchema);
export default ExpenseEntry;