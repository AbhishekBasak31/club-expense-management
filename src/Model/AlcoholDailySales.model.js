import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// One document per day: the HEADER of a day's alcohol sales — the POS total to cross-check against, notes, and the
// totals of the day's lines. The sales themselves are one AlcoholSaleLine each (see AlcoholSaleLine.model.js).
// A header with no lines is a real answer: "nothing alcoholic was sold today".
// ─────────────────────────────────────────────────────────────────
const AlcoholDailySaleSchema = new mongoose.Schema(
  {
    date        : { type: Date, required: true },
    barId       : { type: mongoose.Schema.Types.ObjectId, default: null },
    lineCount   : { type: Number, default: 0 },
    totalQty    : { type: Number, default: 0 },
    totalMl     : { type: Number, default: 0 },
    totalDiscount: { type: Number, default: 0 },
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