import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// BRAND KICKBACK — three collections.
//   Deal     an arrangement with a brand: a sponsorship (agreed amount for an event) or a target (reward for buying
//            targetQty bottles between two dates). Bought bottles are never stored — they are counted from the purchase bills.
//   Claim    the bill raised to the brand for a deal (one live claim per deal). Amount is frozen when raised. GST optional.
//   Receipt  money received against a claim, or an amount WRITTEN OFF (waived). Only 'receipt' counts as income.
// Dates are plain "YYYY-MM-DD" strings, so no time zone can move them.
// ─────────────────────────────────────────────────────────────────
const DealSchema = new mongoose.Schema({
  type        : { type: String, enum: ["sponsorship", "target"], required: true },
  brandId     : { type: mongoose.Schema.Types.ObjectId, ref: "Brand", required: true },
  brandName   : { type: String, required: true, trim: true },
  title       : { type: String, required: true, trim: true },          // the event name, or the name of the target
  notes       : { type: String, default: "", trim: true },
  // sponsorship
  eventDate   : { type: String, default: "" },
  agreedAmount: { type: Number, default: 0, min: 0 },
  // target
  from        : { type: String, default: "" },
  to          : { type: String, default: "" },
  targetQty   : { type: Number, default: 0, min: 0 },                  // bottles
  rewardAmount: { type: Number, default: 0, min: 0 },
  productIds  : [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],   // empty = every product of the brand
  status      : { type: String, enum: ["active", "cancelled"], default: "active" },
  createdBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
DealSchema.index({ brandId: 1, type: 1 });

const ClaimSchema = new mongoose.Schema({
  claimNo     : { type: String, required: true, unique: true },
  dealId      : { type: mongoose.Schema.Types.ObjectId, ref: "AlcoholKickbackDeal", required: true },
  dealType    : { type: String, enum: ["sponsorship", "target"], required: true },
  brandId     : { type: mongoose.Schema.Types.ObjectId, ref: "Brand", required: true },
  brandName   : { type: String, default: "" },
  title       : { type: String, default: "" },
  claimDate   : { type: String, required: true },
  invoiceNo   : { type: String, default: "", trim: true },             // the bill number the club raised
  basis       : { type: String, enum: ["full", "forced"], default: "full" },
  boughtQty   : { type: Number, default: 0 },                          // target deals: bottles bought when the claim was raised
  targetQty   : { type: Number, default: 0 },
  forceReason : { type: String, default: "", trim: true },
  amount      : { type: Number, required: true, min: 0 },
  gstPercent  : { type: Number, default: 0, min: 0 },
  gstAmount   : { type: Number, default: 0, min: 0 },
  totalAmount : { type: Number, required: true, min: 0 },
  remark      : { type: String, default: "", trim: true },
  status      : { type: String, enum: ["live", "cancelled"], default: "live" },
  createdBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
ClaimSchema.index({ dealId: 1, status: 1 });
ClaimSchema.index({ brandId: 1, claimDate: 1 });

const ReceiptSchema = new mongoose.Schema({
  claimId     : { type: mongoose.Schema.Types.ObjectId, ref: "AlcoholKickbackClaim", required: true },
  brandId     : { type: mongoose.Schema.Types.ObjectId, ref: "Brand", required: true },
  type        : { type: String, enum: ["receipt", "writeoff"], default: "receipt" },
  date        : { type: String, required: true },
  month       : { type: String, required: true },                      // YYYY-MM — what the P&L income is grouped on
  amount      : { type: Number, required: true, min: 0.01 },
  mode        : { type: String, default: "", trim: true },
  reference   : { type: String, default: "", trim: true },
  remark      : { type: String, default: "", trim: true },
  createdBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });
ReceiptSchema.index({ claimId: 1 });
ReceiptSchema.index({ month: 1, type: 1 });

export const AlcoholKickbackDeal = mongoose.model("AlcoholKickbackDeal", DealSchema);
export const AlcoholKickbackClaim = mongoose.model("AlcoholKickbackClaim", ClaimSchema);
export const AlcoholKickbackReceipt = mongoose.model("AlcoholKickbackReceipt", ReceiptSchema);