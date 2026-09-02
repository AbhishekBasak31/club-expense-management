import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// Breakage — one record per breakage event: this crockery item, on
// this date, this many broke. There's no existing "breakage" concept
// anywhere in this app to build a report on top of, so this is a new
// collection, not just a new report over old data — same reasoning as
// AlcoholPurchaseRequirement needing its own model when nothing
// tracked purchase requisitions yet.
//
// `usecase` (where this crockery is typically used — Bar, Kitchen,
// Buffet Counter, etc.) is logged per breakage EVENT rather than
// stored once on the Product itself. That's a deliberate choice, not
// an oversight: adding a field to the shared Product schema for one
// report would affect every other page that reads Product, and the
// same crockery item can genuinely be used in more than one place
// (a wine glass breaking at the bar vs. one breaking during a buffet
// service). The Monthly Breakage Report shows the most recent
// usecase logged for that item within the reporting month.
// ─────────────────────────────────────────────────────────────────
const BreakageSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    date: { type: Date, required: true, index: true },
    qtyBroken: { type: Number, required: true, min: 0 },
    usecase: { type: String, trim: true, default: "" },
    remarks: { type: String, trim: true, default: "" },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

BreakageSchema.index({ productId: 1, date: 1 });
BreakageSchema.index({ isActive: 1 });

export const Breakage = mongoose.model("Breakage", BreakageSchema);
export default Breakage;