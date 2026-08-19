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

    // ── Bar partial-bottle tracking (optional; Store items never set
    // this) ── A bottle that's been opened but not fully consumed still
    // holds real, countable stock — treating every bottle that left the
    // store as "fully consumed" overstates consumption and understates
    // closing stock. closingStock above ALWAYS remains the single
    // authoritative decimal quantity used everywhere else in the system
    // (P&L stock adjustment, this same Stock List page, etc.) — it's
    // computed as (complete bottles + closingStockPartialMl / bottle
    // size in ml, via that product's Product Conversion record) BEFORE
    // saving. This field only stores the raw ml component separately so
    // it can be redisplayed and re-edited later without needing to
    // reverse-engineer it back out of the combined decimal.
    closingStockPartialMl: { type: Number, default: 0 },

    // ── Stock Allocation — day-by-day quantity allocated within this
    // month, per the Stock Allocation modal on the Stock List page.
    // Only days that actually have an allocation are stored — day is
    // 1..(real day count for `month`), validated in the controller, not
    // here (Mongoose schema validation happens per-subdocument, without
    // easy access to the parent's own `month` field to check against).
    dailyAllocations: {
      type: [{
        day    : { type: Number, required: true, min: 1, max: 31 },
        qty    : { type: Number, required: true, min: 0 },
        remark : { type: String, default: "" },
      }],
      default: [],
    },
  },
  { timestamps: true }
);

// One stock row per product per month — upserts key off this.
StockEntrySchema.index({ productId: 1, month: 1 }, { unique: true });

export const StockEntry = mongoose.model("StockEntry", StockEntrySchema);
export default StockEntry;