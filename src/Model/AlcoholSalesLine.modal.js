import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// ONE DOCUMENT PER SALE LINE — a line of a POS bill: the alcohol, how it was measured (a volume UOM such as Peg,
// Wine Glass, Wine Bottle, Beer Bottle), the quantity, discount, settlement mode and amount.
//
//   day / month   plain strings ("2026-11-01", "2026-11") so the year, month and day views can group on them in
//                 the database without any date arithmetic
//   hour          0–23 from the bill time, or null when the line has no time
//   productKey    the product id as a string — what the views group and filter on
//   uomMl / ml    the UOM's ml per unit AT THE TIME of the sale, and qty × uomMl. This is what the bar close
//                 turns into stock movements, so a UOM edited later never changes an old sale.
//
// A line only reaches the stock ledger when the bar day is closed (see AlcoholBar.controller.js).
// ─────────────────────────────────────────────────────────────────
const AlcoholSaleLineSchema = new mongoose.Schema(
  {
    date       : { type: Date, required: true },
    day        : { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    month      : { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    time       : { type: String, default: "" },                       // "HH:MM" or ""
    hour       : { type: Number, default: null, min: 0, max: 23 },
    billNo     : { type: String, default: "", trim: true },
    orderNo    : { type: String, default: "", trim: true },
    steward    : { type: String, default: "", trim: true },
    settMode   : { type: String, default: "", trim: true },           // PAYTM, CASH, CARD … as the POS names it

    productId  : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productKey : { type: String, required: true },
    productName: { type: String, default: "" },
    uomId      : { type: mongoose.Schema.Types.ObjectId, ref: "UOM", required: true },
    uomName    : { type: String, default: "" },
    uomMl      : { type: Number, required: true, validate: { validator: (v) => v > 0, message: "uomMl must be above 0" } },

    qty        : { type: Number, required: true, validate: { validator: (v) => v > 0, message: "qty must be above 0" } },
    ml         : { type: Number, required: true, min: 0 },
    discPct    : { type: Number, default: 0, min: 0, max: 100 },
    discAmt    : { type: Number, default: 0, min: 0 },
    amount     : { type: Number, default: 0, min: 0 },

    source     : { type: String, enum: ["manual", "import"], default: "manual" },
    batchId    : { type: String, default: "" },                       // which save wrote it — lets a failed save be undone cleanly
    createdBy  : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
AlcoholSaleLineSchema.index({ day: 1 });
AlcoholSaleLineSchema.index({ month: 1, productKey: 1 });
AlcoholSaleLineSchema.index({ productKey: 1, day: 1 });
AlcoholSaleLineSchema.index({ batchId: 1 });

export const AlcoholSaleLine = mongoose.model("AlcoholSaleLine", AlcoholSaleLineSchema);
export default AlcoholSaleLine;