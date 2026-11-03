import mongoose from "mongoose";

// One budget line = one head. For COGS it is one consumption category (Food, Alcohol,
// Beverages, Shisha, Tobacco, Packing Expense, Cloud Expense); for everything else a
// Group Head + Group pair. The key is the lower-cased "head||group", the same key the
// engine derives from the expense items, so budgets and actuals always line up.
const BudgetLineSchema = new mongoose.Schema(
  {
    key       : { type: String, required: true, trim: true },
    groupHead : { type: String, default: "" }, // display labels (casing as typed on the expense form)
    group     : { type: String, default: "" },
    // For COGS lines this is the PURCHASE budget (what to buy); for the rest, the spend budget.
    amount    : { type: Number, default: 0, min: 0 },
    // 'auto'   = management accepted the system's suggestion as-is
    // 'manual' = management typed/changed the figure themselves
    mode      : { type: String, enum: ["auto", "manual"], default: "manual" },
    // COGS lines only: the head's planned sales and the CONSUMPTION needed to achieve
    // them. Kept so the real consumption (once month-end stock is entered in the P&L)
    // can be checked against the plan.
    salesTarget       : { type: Number, default: 0, min: 0 },
    consumptionTarget : { type: Number, default: 0, min: 0 },
    note      : { type: String, default: "" },
  },
  { _id: false }
);

// One document per calendar month ("YYYY-MM"). Revenue and stock are NOT stored here —
// they are always read from that month's saved P&L statement (Pl.model.js), so the
// budget can never disagree with the P&L.
const BudgetPlanSchema = new mongoose.Schema(
  {
    month       : { type: String, required: true, unique: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    // The total sales management wants to achieve this month (same basis as P&L sales).
    // Every consumption/purchase/expense figure in the plan is built from this number.
    targetSales : { type: Number, default: 0, min: 0 },
    lines       : [BudgetLineSchema],
    createdBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Which P&L sales line(s) belong to a COGS head.
// labels = P&L revenue labels (e.g. "Food Sales"); useTotal = use total sales.
const RevenueLinkSchema = new mongoose.Schema(
  {
    key      : { type: String, required: true, trim: true },
    labels   : { type: [String], default: [] },
    useTotal : { type: Boolean, default: false },
  },
  { _id: false }
);

// Per-line planning rules for non-COGS heads (and cost regulation for any head).
//  behaviour: 'fixed'    = exactly last month (rent, bills, salary — do not move with sales)
//             'variable' = scales with sales and CAN be regulated (tissue, toiletries, housekeeping…)
//             'trend'    = last month × the head's own growth since its first entry
//             'average'  = monthly average since its first entry (lumpy items such as capex)
//             '' / null  = let the system pick from the head's name
//  regulationPct: cost regulation applied last, e.g. -5 tightens the line by 5%.
const LineSettingSchema = new mongoose.Schema(
  {
    key           : { type: String, required: true, trim: true },
    behaviour     : { type: String, enum: ["trend", "variable", "fixed", "average", ""], default: "" },
    regulationPct : { type: Number, default: 0, min: -100, max: 100 },
  },
  { _id: false }
);

// Single shared settings document (key = "default").
const BudgetSettingsSchema = new mongoose.Schema(
  {
    key            : { type: String, required: true, unique: true, default: "default" },
    // own-trend expense lines: compound = steady monthly rate first→last | average = mean
    // of monthly rates | last = most recent monthly rate only
    growthMethod   : { type: String, enum: ["compound", "average", "last"], default: "compound" },
    growthCapPct   : { type: Number, default: 25, min: 0, max: 100 },
    skipFirstMonth : { type: Boolean, default: true },
    // how many previous months of P&L the sales mix / cost ratios are learned from
    ratioMonths    : { type: Number, enum: [1, 3, 6], default: 1 },
    // closing-stock target: 'scale' grows stock with volume, 'hold' keeps last month's level
    stockPolicy    : { type: String, enum: ["scale", "hold"], default: "scale" },
    revenueLinks   : { type: [RevenueLinkSchema], default: [] },
    lineSettings   : { type: [LineSettingSchema], default: [] },
    updatedBy      : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const BudgetPlan = mongoose.model("BudgetPlan", BudgetPlanSchema);
export const BudgetSettings = mongoose.model("BudgetSettings", BudgetSettingsSchema);
export default BudgetPlan;