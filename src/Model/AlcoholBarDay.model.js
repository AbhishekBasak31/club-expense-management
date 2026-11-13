import mongoose from "mongoose";
import { OUTFLOW_TYPES } from "../Utils/AlcoholBar.js";

// ─────────────────────────────────────────────────────────────────
// One document per bar day: the DRAFT of the closing (physical counts + breakage / complimentary / party) while
// the day is open, and the closed marker afterwards. The day's real effect on stock lives in the ledger — closing
// writes those rows (refType "day-close", refId = the date) and reopening removes exactly those rows.
// ─────────────────────────────────────────────────────────────────
const AlcoholBarDaySchema = new mongoose.Schema(
  {
    date   : { type: Date, required: true },                                   // the business date, UTC midnight
    barId  : { type: mongoose.Schema.Types.ObjectId, default: null },         // for when there is more than one bar
    status : { type: String, enum: ["open", "closed"], default: "open" },

    counts : { type: [{
      _id       : false,
      productId : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      physicalMl: { type: Number, required: true, min: 0 },                    // what was COUNTED at closing (0 is a real count)
    }], default: [] },

    outflows : { type: [{
      _id       : false,
      productId : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      type      : { type: String, enum: OUTFLOW_TYPES, required: true },
      ml        : { type: Number, required: true, min: 0.001 },
      remark    : { type: String, default: "" },
    }], default: [] },

    closedAt     : { type: Date, default: null },
    closedBy     : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reopenedAt   : { type: Date, default: null },
    reopenedBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reopenReason : { type: String, default: "" },
    updatedBy    : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
AlcoholBarDaySchema.index({ date: 1, barId: 1 }, { name: "uniq_bar_day", unique: true });
AlcoholBarDaySchema.index({ status: 1, date: 1 });

export const AlcoholBarDay = mongoose.model("AlcoholBarDay", AlcoholBarDaySchema);
export default AlcoholBarDay;