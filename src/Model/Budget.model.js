import mongoose from "mongoose";

 
// One budget line = one Group Head + Group pair (e.g. COGS › Food).
// The key is the lower-cased "head||group", the same key the engine derives
// from the expense items, so budgets and actuals always line up.
const BudgetLineSchema = new mongoose.Schema(
  {
    key       : { type: String, required: true, trim: true },
    groupHead : { type: String, default: "" }, // display labels (casing as typed on the expense form)
    group     : { type: String, default: "" },
    amount    : { type: Number, default: 0, min: 0 },
    // 'auto'   = management accepted the system's suggestion as-is
    // 'manual' = management typed/changed the figure themselves
    mode      : { type: String, enum: ["auto", "manual"], default: "manual" },
    note      : { type: String, default: "" },
  },
  { _id: false }
);
 
// One document per calendar month ("YYYY-MM"). Revenue is NOT stored here any
// more — it is always read live from the saved P&L statement for that month
// (Pl.model.js), so the budget can never disagree with the P&L.
const BudgetPlanSchema = new mongoose.Schema(
  {
    month     : { type: String, required: true, unique: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    lines     : [BudgetLineSchema],
    createdBy : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
 
// Which revenue line(s) from the P&L drive a purchase head's budget.
// labels  = P&L revenue labels (e.g. "Food Sales"); useTotal = use total revenue.
const RevenueLinkSchema = new mongoose.Schema(
  {
    key      : { type: String, required: true, trim: true }, // budget-line key, e.g. "cogs||food"
    labels   : { type: [String], default: [] },
    useTotal : { type: Boolean, default: false },
  },
  { _id: false }
);
 
// Single shared settings document (key = "default").
const BudgetSettingsSchema = new mongoose.Schema(
  {
    key            : { type: String, required: true, unique: true, default: "default" },
    // compound = steady monthly rate first→last | average = mean of monthly
    // rates | last = most recent monthly rate only
    growthMethod   : { type: String, enum: ["compound", "average", "last"], default: "compound" },
    growthCapPct   : { type: Number, default: 25, min: 0, max: 100 }, // growth never exceeds ±this
    skipFirstMonth : { type: Boolean, default: true },                // ignore the start-up month
    revenueLinks   : { type: [RevenueLinkSchema], default: [] },
    updatedBy      : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
 
export const BudgetPlan = mongoose.model("BudgetPlan", BudgetPlanSchema);
export const BudgetSettings = mongoose.model("BudgetSettings", BudgetSettingsSchema);
export default BudgetPlan;
 