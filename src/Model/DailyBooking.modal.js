import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// DailyBooking — a single table/seating booking for a given day.
// Flat, standalone collection — no relationship to PartyQuery (that's
// the RFP/event-enquiry pipeline; this is the day-to-day walk-in/
// reservation log: who's coming, what table, what they were billed).
//
// finalAmount is ALWAYS server-recalculated as billedAmount - discount
// (floored at 0) — never trusted from the client, same principle
// already used for PLStatement's gstAmount/finalAmount and PartyQuery's
// closeCycle finalValue.
// ─────────────────────────────────────────────────────────────────
const DailyBookingSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    guestName: { type: String, trim: true, required: true },
    number: { type: String, trim: true, default: "" }, // guest contact number
    pax: { type: Number, required: true, min: 0 },
    time: { type: String, trim: true, required: true }, // "HH:MM"
    tableNumber: { type: Number, required: true, min: 0 },

    billedAmount: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    finalAmount: { type: Number, default: 0, min: 0 }, // = billedAmount - discount, floored at 0

    ref: { type: String, trim: true, default: "" },
    stewardName: { type: String, trim: true, default: "" },
    remark: { type: String, trim: true, default: "" },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

DailyBookingSchema.index({ date: 1 });
DailyBookingSchema.index({ isActive: 1 });

export const DailyBooking = mongoose.model("DailyBooking", DailyBookingSchema);
export default DailyBooking;