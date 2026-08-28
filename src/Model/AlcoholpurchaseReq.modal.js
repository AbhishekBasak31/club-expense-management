import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// AlcoholPurchaseRequirement — a purchase requisition record: "as of
// this date, this alcohol item had this much stock at this price, and
// we're requesting this much more be purchased." currentQty/currentPrice
// are a SNAPSHOT taken at the moment the request is issued, not a live
// lookup — a requisition needs to stay historically accurate (what the
// stock/price actually WAS when the request was made) even if the real
// stock or price changes afterward. totalValue and reqQtyPrice are
// always recalculated server-side from currentQty/currentPrice/reqQty,
// never trusted from the request body — same convention as GST amounts
// elsewhere in this app never being trusted from the client.
// ─────────────────────────────────────────────────────────────────
const AlcoholPurchaseRequirementSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    alcoholItemDetails: { type: String, required: true, trim: true },

    currentQty: { type: Number, required: true, min: 0 },
    currentPrice: { type: Number, required: true, min: 0 },
    totalValue: { type: Number, default: 0 }, // = currentQty * currentPrice, server-set

    reqQty: { type: Number, required: true, min: 0 },
    reqQtyPrice: { type: Number, default: 0 }, // = reqQty * currentPrice, server-set

    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

AlcoholPurchaseRequirementSchema.index({ date: 1 });
AlcoholPurchaseRequirementSchema.index({ isActive: 1 });

export const AlcoholPurchaseRequirement = mongoose.model("AlcoholPurchaseRequirement", AlcoholPurchaseRequirementSchema);
export default AlcoholPurchaseRequirement;