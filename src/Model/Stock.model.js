import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// One row = one product's manually-entered stock figures for one
// calendar month. Only Opening Stock and Closing Stock are ever stored
// here — Current Stock (this month's purchased quantity) and
// Consumption are always computed fresh at request time (see
// Stock.controller.js), never persisted, so they can never drift out of
// sync with the actual Purchase entries.
// ─────────────────────────────────────────────────────────────────
const StockEntrySchema = new mongoose.Schema(
  {
    productId    : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    month        : { type: String, required: true }, // "YYYY-MM"

    // Manually entered. If left unset for a month, the controller falls
    // back to the PREVIOUS month's closingStock for the same product —
    // this month's opening stock is, by definition, last month's
    // closing stock, unless a physical recount says otherwise.
    openingStock : { type: Number, default: 0 },
    closingStock : { type: Number, default: 0 },
  },
  { timestamps: true }
);

// One stock row per product per month — upserts key off this.
StockEntrySchema.index({ productId: 1, month: 1 }, { unique: true });

export const StockEntry = mongoose.model("StockEntry", StockEntrySchema);
export default StockEntry;