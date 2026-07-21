import mongoose from "mongoose";

// One line item within an expense entry
const ExpenseItemSchema = new mongoose.Schema(
  {
    // Not schema-required — drafts may omit these. The controller enforces
    // "expenseType + unitPrice required" only for status:'final' entries.
    expenseType     : { type: String, enum: ["fixed", "variable", "capex"], default: "variable" },

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
    unitPrice       : { type: Number, default: 0 }, // not required — drafts may omit a price
    discount        : { type: Number, default: 0 }, // ₹ amount, applied before GST

    // server-calculated — never trusted from client
    amount          : { type: Number, default: 0 }, // (qty × unitPrice) − discount
    gstPercent      : { type: Number, default: 0 },
    gstAmount       : { type: Number, default: 0 }, // amount × gstPercent/100
    netAmount       : { type: Number, default: 0 }, // amount + gstAmount

    hsnSac          : { type: String, default: "" },

    uomId           : { type: mongoose.Schema.Types.ObjectId, ref: "UOM", default: null },
    uomName         : { type: String, default: "" },

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

    // ── Employee salary details — only populated when the "Employee
    // salary" checkbox is used on the Add Expense form (expenseType is
    // still "fixed" as normal; isSalary distinguishes a salary line from
    // any other fixed/operating-cost item). All money fields here are
    // in addition to, not instead of, the item's own unitPrice/amount/
    // netAmount — those still hold the net salary total actually paid,
    // so this entry behaves like any other expense item everywhere else
    // (dashboards, exports, reports) without special-casing. ──
    isSalary        : { type: Boolean, default: false },
    salaryDetails    : {
      employeeId      : { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
      empId           : { type: String, default: "" },       // denormalized
      employeeName    : { type: String, default: "" },       // denormalized
      designation     : { type: String, default: "" },
      dateOfBirth     : { type: Date, default: null },
      bloodGroup      : { type: String, default: "" },
      mobileNumber    : { type: String, default: "" },
      email           : { type: String, default: "" },

      salaryMonth     : { type: String, default: "" },        // "2026-07" style year-month

      baseSalary      : { type: Number, default: 0 },
      pfPercent       : { type: Number, default: 12 },         // editable — no fixed statutory rate assumed
      pfAmount        : { type: Number, default: 0 },          // server-calculated: baseSalary × pfPercent/100
      hraPercent      : { type: Number, default: 40 },         // editable — no fixed statutory rate assumed
      hraAmount       : { type: Number, default: 0 },           // server-calculated: baseSalary × hraPercent/100

      // DA — either a flat amount or a percentage of base salary, per entry
      daType          : { type: String, enum: ["amount", "percent"], default: "amount" },
      daValue         : { type: Number, default: 0 },            // the number entered — amount or percent per daType
      daAmount        : { type: Number, default: 0 },              // server-calculated resolved ₹ amount

      travelAllowanceId   : { type: mongoose.Schema.Types.ObjectId, ref: "TravelAllowance", default: null },
      travelAllowanceName : { type: String, default: "" },
      travelAllowanceAmount : { type: Number, default: 0 },

      // Incentive — either a flat amount or a percentage of base salary
      incentiveType   : { type: String, enum: ["amount", "percent"], default: "amount" },
      incentiveValue  : { type: Number, default: 0 },
      incentiveAmount : { type: Number, default: 0 }, // server-calculated resolved ₹ amount

      attendanceDays  : { type: Number, default: 0 },
      paidLeaveDays   : { type: Number, default: 0 },
      holidayDays     : { type: Number, default: 0 },

      // netSalary is server-calculated: baseSalary + hraAmount + daAmount +
      // travelAllowanceAmount + incentiveAmount − pfAmount. Stored so it's
      // queryable/reportable without recomputing from the components.
      netSalary       : { type: Number, default: 0 },
    },
  },
  { _id: true }
);

const ExpenseEntrySchema = new mongoose.Schema(
  {
    date            : { type: Date, required: true, index: true },
    referenceNumber : { type: String, default: "" }, // auto: EXP-00001

    // 'draft' = incomplete entry saved for later completion (e.g. products
    // not yet in the Product master). 'final' = normal, complete expense.
    // Defaults to 'final' so existing entries and any client that omits
    // this field behave exactly as before.
    status          : { type: String, enum: ["draft", "final"], default: "final", index: true },

    items           : [ExpenseItemSchema],

    // entry-level totals — all server-calculated
    subTotal        : { type: Number, default: 0 },
    totalGST        : { type: Number, default: 0 },
    deliveryCharge  : { type: Number, default: 0 }, // flat amount, no GST — added straight to grandTotal
    roundOff        : { type: Number, default: 0 }, // +/- adjustment applied last, after delivery charge
    grandTotal      : { type: Number, default: 0 }, // subTotal + totalGST + deliveryCharge + roundOff

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
ExpenseEntrySchema.index({ "items.isSalary": 1 });

export const ExpenseEntry = mongoose.model("ExpenseEntry", ExpenseEntrySchema);
export default ExpenseEntry;