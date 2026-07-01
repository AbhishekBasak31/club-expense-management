import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// P&L STATEMENT MODEL
//
// Shape mirrors the frontend exactly:
//   PLStatement { month, expenses: PLGroup[], revenues: PLGroup[] }
//   PLGroup     { label, expandable, items: PLSubItem[] }
//   PLSubItem   { label, amount }
//
// Design decisions:
//   • One document per month ("2026-07") — unique index enforces this,
//     matching the frontend's "Period: July 2026 / July 2026…" tabs
//     which are really one statement per calendar month.
//   • Sub-items keep their own _id (frontend already generates ids
//     client-side for React keys / inline-edit targeting) but we let
//     Mongo assign real ObjectIds server-side instead of trusting the
//     client's generated ids — the controller remaps them.
//   • groupTotal / sideTotal / netPL are NEVER stored — always
//     server-derived at read/aggregation time so they can't drift
//     from the underlying item amounts (same "never trust client
//     totals" rule used in Expense.modal.js).
// ─────────────────────────────────────────────────────────────────

const PLSubItemSchema = new mongoose.Schema(
  {
    label  : { type: String, required: true, trim: true },
    amount : { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const PLGroupSchema = new mongoose.Schema(
  {
    label      : { type: String, required: true, trim: true },
    expandable : { type: Boolean, default: true },
    items      : { type: [PLSubItemSchema], default: [] },
  },
  { _id: true }
);

const PLStatementSchema = new mongoose.Schema(
  {
    // "YYYY-MM" — matches the frontend's <input type="month"> value
    month : {
      type     : String,
      required : true,
      trim     : true,
      match    : /^\d{4}-(0[1-9]|1[0-2])$/,
    },

    expenses : { type: [PLGroupSchema], default: [] },
    revenues : { type: [PLGroupSchema], default: [] },

    notes     : { type: String, default: "" },
    createdBy : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// One statement per calendar month
PLStatementSchema.index({ month: 1 }, { unique: true });

export const PLStatement = mongoose.model("PLStatement", PLStatementSchema);
export default PLStatement;