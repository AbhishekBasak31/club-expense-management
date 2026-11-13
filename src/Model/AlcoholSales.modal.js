import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// One document per day: the alcohol sold, typed in by hand — pegs, large pegs and whole bottles per product.
// Each line SNAPSHOTS the bottle size and the prices used, so a past day never changes when a price is edited later.
// Sales only reach the stock ledger when the bar day is closed (see AlcoholBar.controller.js).
// ─────────────────────────────────────────────────────────────────
const SaleLineSchema = new mongoose.Schema({
  _id             : false,
  productId       : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  productName     : { type: String, default: "" },
  unitMl          : { type: Number, required: true },
  pegs            : { type: Number, default: 0, min: 0 },
  largePegs       : { type: Number, default: 0, min: 0 },
  bottles         : { type: Number, default: 0, min: 0 },
  ml              : { type: Number, required: true, min: 0 },
  pegPrice        : { type: Number, default: 0 },
  largePegPrice   : { type: Number, default: 0 },
  bottlePrice     : { type: Number, default: 0 },
  amount          : { type: Number, default: 0 },
  amountOverridden: { type: Boolean, default: false },   // true when the amount was typed instead of calculated
});

const AlcoholDailySaleSchema = new mongoose.Schema(
  {
    date        : { type: Date, required: true },
    barId       : { type: mongoose.Schema.Types.ObjectId, default: null },
    pegMl       : { type: Number, default: 30 },
    largePegMl  : { type: Number, default: 60 },
    lines       : { type: [SaleLineSchema], default: [] },
    // Optional hour-by-hour detail, filled by a POS import that carried times. The lines stay the truth; the hours only
    // split them (whatever they do not explain is shown as "unassigned").
    hourly      : { type: [{
      _id       : false,
      hour      : { type: Number, required: true, min: 0, max: 23 },
      productId : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      pegs      : { type: Number, default: 0 },
      largePegs : { type: Number, default: 0 },
      bottles   : { type: Number, default: 0 },
      ml        : { type: Number, default: 0 },
      amount    : { type: Number, default: 0 },
    }], default: [] },
    totalMl     : { type: Number, default: 0 },
    totalAmount : { type: Number, default: 0 },
    posTotal    : { type: Number, default: null },        // the day's alcohol total from the POS, to cross-check
    notes       : { type: String, default: "" },
    createdBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
AlcoholDailySaleSchema.index({ date: 1, barId: 1 }, { name: "uniq_sale_day", unique: true });

export const AlcoholDailySale = mongoose.model("AlcoholDailySale", AlcoholDailySaleSchema);
export default AlcoholDailySale;