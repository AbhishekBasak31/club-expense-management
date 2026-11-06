import mongoose from "mongoose";
import { MOVEMENT_TYPES } from "../Utils/AlcoholStock.js";

// ─────────────────────────────────────────────────────────────────
// The alcohol stock LEDGER. One row = one change to one product's stock at one LOCATION, in ML.
// A balance is the sum of the rows, so every page and every report reads the same truth.
//
//   type          location  sign   meaning
//   opening       store     +      counted stock on the tracking start date
//   receipt       store     +      a purchase line received into stock (refType 'purchase-line')
//   transfer-out  store     −      issued to the bar        ┐ one transfer = two rows
//   transfer-in   bar       +      received by the bar      ┘ sharing a transferId
//   adjustment    store     ±      a count correction (a reason is required)
//   sale / breakage / complimentary / party / bar-count — the bar's own rows (later phases)
//
// Rows are never edited: a mistake is corrected with an adjustment, so history stays auditable.
// ─────────────────────────────────────────────────────────────────
const AlcoholStockMovementSchema = new mongoose.Schema(
  {
    productId   : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName : { type: String, default: "" },                       // snapshot, so history reads even if renamed
    date        : { type: Date, required: true },                      // the business date, at UTC midnight
    location    : { type: String, enum: ["store", "bar"], required: true },
    barId       : { type: mongoose.Schema.Types.ObjectId, default: null }, // for when there is more than one bar
    type        : { type: String, enum: MOVEMENT_TYPES, required: true },
    qtyMl       : { type: Number, required: true, validate: { validator: (v) => Number.isFinite(v) && v !== 0, message: "Quantity cannot be zero." } },
    refType     : { type: String, default: "manual" },                 // 'purchase-line' | 'transfer' | 'manual' | …
    refId       : { type: String, default: "" },                       // purchase line: "<entryId>:<itemId>"
    transferId  : { type: String, default: "" },
    remark      : { type: String, default: "" },
    createdBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

AlcoholStockMovementSchema.index({ productId: 1, date: 1 });
AlcoholStockMovementSchema.index({ location: 1, date: 1 });
AlcoholStockMovementSchema.index({ transferId: 1 });
// A purchase line can be received into stock only once.
AlcoholStockMovementSchema.index(
  { refType: 1, refId: 1, type: 1, location: 1 },
  { name: "uniq_purchase_line_receipt", unique: true, partialFilterExpression: { refType: "purchase-line" } }
);

export const AlcoholStockMovement = mongoose.model("AlcoholStockMovement", AlcoholStockMovementSchema);
export default AlcoholStockMovement;