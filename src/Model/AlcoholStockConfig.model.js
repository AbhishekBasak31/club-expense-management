import mongoose from "mongoose";

// One document (key "main"): the date stock tracking starts. Opening stock is counted on this date, and only
// purchases on or after it are received into the ledger — anything earlier is already inside the opening count.
const AlcoholStockConfigSchema = new mongoose.Schema(
  {
    key               : { type: String, default: "main", unique: true },
    trackingStartDate : { type: Date, default: null },
    updatedBy         : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const AlcoholStockConfig = mongoose.model("AlcoholStockConfig", AlcoholStockConfigSchema);
export default AlcoholStockConfig;