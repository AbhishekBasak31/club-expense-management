import mongoose from "mongoose";

const TravelAllowanceSchema = new mongoose.Schema(
  {
    name     : { type: String, required: true, trim: true },

    // Longer free-text note — for a fixed/recurring expense type like Rent
    // this is where the specifics live (e.g. "JW Marriott Kolkata, 24th
    // Floor — Minimum Monthly Guarantee or 10% of Monthly Revenue,
    // whichever is higher"), distinct from the short `name` used
    // everywhere in dropdowns and tables.
    description : { type: String, default: "" },

    amount   : { type: Number, default: 0 },
    maxLimit : { type: Number, default: 0 },

    // ── Unit-based billing — for expenses billed by rate × quantity
    // rather than a flat amount: Electricity (₹/kWh), Water (₹/KL or
    // ₹/Litre), Maintenance/CAM (₹/sq.ft), or any other metered expense.
    // When isUnitBased is on, `amount` above is a computed preview
    // (unitRate × defaultUnits) rather than a manually typed default —
    // the actual month's units still get entered at the expense-entry
    // stage, this just captures the standing rate + typical usage. ──
    isUnitBased  : { type: Boolean, default: false },
    unitRate     : { type: Number, default: 0 },   // ₹ per unit, e.g. 8.5 for ₹8.50/kWh
    unitLabel    : { type: String, default: "" },  // e.g. "kWh", "KL", "Litre", "Sq.ft"
    defaultUnits : { type: Number, default: 0 },   // typical/expected quantity per bill, used only to preview the default amount

    // ── Recurrence + external reference — useful for any fixed/recurring
    // bill (Rent, Electricity, Water, Maintenance/CAM/AMC). ──
    billingFrequency : {
      type: String,
      enum: ["monthly", "quarterly", "half-yearly", "annual", ""],
      default: "",
    },
    accountNumber : { type: String, default: "" }, // utility consumer/meter no., AMC/contract no., lease agreement no., etc.

    // ── Vendor this recurring expense is paid to — e.g. the landlord for
    // Rent, the utility board for Electricity/Water. Pre-fills the
    // voucher's vendor when this expense type is picked, same idea as
    // Product does for a normal purchase line. ──
    vendorId   : { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    vendorName : { type: String, default: "" }, // denormalized

    // Typical GST rate for this expense type (e.g. 18% on commercial
    // rent, per CGST 9% + SGST 9% on a standard rent invoice) — pre-fills
    // the voucher's GST, still freely editable per entry.
    gstPercent : { type: Number, default: 0 },

    // ── Default Approved By / Received By for this recurring expense —
    // most fixed bills (rent, electricity, water) go through the same
    // approver every time, so this saves re-picking it on every entry.
    // Both are Employee Master links. ──
    approvedById   : { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    approvedByName : { type: String, default: "" }, // denormalized
    receivedById   : { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    receivedByName : { type: String, default: "" }, // denormalized

    mainCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryId    : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    baseCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },

    mainCategoryName : { type: String, default: "" },
    subCategoryName  : { type: String, default: "" },
    baseCategoryName : { type: String, default: "" },

    isActive : { type: Boolean, default: true },
  },
  { timestamps: true }
);

TravelAllowanceSchema.index({ name: 1 });
TravelAllowanceSchema.index({ isActive: 1 });
TravelAllowanceSchema.index({ subCategoryId: 1 });
TravelAllowanceSchema.index({ vendorId: 1 });

export const TravelAllowance = mongoose.model("TravelAllowance", TravelAllowanceSchema);
export default TravelAllowance;