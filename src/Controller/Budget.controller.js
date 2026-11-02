import { ExpenseEntry } from "../Model/Expense.modal.js";
import { PLStatement } from "../Model/Pl.model.js";
import { BudgetPlan, BudgetSettings } from "../Model/Budget.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import {
  monthRangeUTC, shiftMonth, bucketRows, buildSuggestions, buildAnalysis,
  summarisePlStatements, DEFAULT_SETTINGS, GROWTH_METHODS,
} from "../Utils/Budget.engine.js";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const HISTORY_CAP_MONTHS = 60; // never look back further than 5 years
const basisOf = (q) => (q === "incl" ? "incl" : "excl"); // excl = ex-GST (matches revenue before GST)
 
// ─────────────────────────────────────────────────────────────────
// ACTUAL spend per month × Group Head × Group, for an inclusive month range.
// Groups by incurredDate in UTC — identical to getMonthlyExpenseSummary, so the
// month an expense lands in here is the same month the P&L puts it in.
// Counts every final item (purchases AND voucher expenses): what a head "is"
// (purchase / expense / capex) comes from its Group Head, not the entry type.
// Entry-level delivery charge / round-off belong to no single head, so they are
// not included here.
// ─────────────────────────────────────────────────────────────────
async function loadBuckets(fromMonth, toMonth, basis) {
  const { start } = monthRangeUTC(fromMonth);
  const { endExclusive } = monthRangeUTC(toMonth);
  const rows = await ExpenseEntry.aggregate([
    { $match: { status: "final", incurredDate: { $gte: start, $lt: endExclusive } } },
    { $unwind: "$items" },
    { $group: {
        _id: {
          month: { $dateToString: { format: "%Y-%m", date: "$incurredDate" } },
          head : "$items.groupHeadName",
          group: "$items.groupName",
          cat  : "$items.categoryName",
          sub  : "$items.subCategoryName",
          base : "$items.baseCategoryName",
        },
        amount: { $sum: { $ifNull: ["$items.amount", 0] } },
        gst   : { $sum: { $ifNull: ["$items.gstAmount", 0] } },
        net   : { $sum: { $ifNull: ["$items.netAmount", 0] } },
    }},
  ]).allowDiskUse(true);
  return bucketRows(rows, basis);
}
 
// Month of the very first final expense entry (the start of every expense head's history).
async function firstEntryMonth() {
  const e = await ExpenseEntry.findOne({ status: "final", incurredDate: { $ne: null } })
    .sort({ incurredDate: 1 }).select("incurredDate").lean();
  return e && e.incurredDate ? new Date(e.incurredDate).toISOString().slice(0, 7) : null;
}
 
// ─────────────────────────────────────────────────────────────────
// REVENUE from the saved P&L statements (PLStatement). One statement per month;
// a month without a saved statement is simply absent from the result — it is
// never treated as ₹0 revenue.
// ─────────────────────────────────────────────────────────────────
async function loadPlRevenue(fromMonth, toMonth, basis) {
  const stmts = await PLStatement.find({ month: { $gte: fromMonth, $lte: toMonth } })
    .select("month revenues").lean();
  return summarisePlStatements(stmts, basis);
}
 
async function loadSettings() {
  const doc = await BudgetSettings.findOne({ key: "default" }).lean();
  return {
    growthMethod  : doc?.growthMethod ?? DEFAULT_SETTINGS.growthMethod,
    growthCapPct  : doc?.growthCapPct ?? DEFAULT_SETTINGS.growthCapPct,
    skipFirstMonth: doc?.skipFirstMonth ?? DEFAULT_SETTINGS.skipFirstMonth,
    revenueLinks  : doc?.revenueLinks ?? [],
  };
}
 
const planView = (p) => (p ? { month: p.month, lines: p.lines || [] } : null);
 
// Revenue the analysis compares against = the month's saved P&L revenue.
async function monthRevenue(month, basis) {
  const pl = await loadPlRevenue(month, month, basis);
  const total = pl[month]?.total || 0;
  return { revenue: total, revenueSource: total > 0 ? "pl" : "none" };
}
 
// GET /budgets/analysis?month=YYYY-MM&basis=excl|incl
export const getBudgetAnalysis = async (req, res) => {
  const { month } = req.query;
  if (!MONTH_RE.test(month || "")) return sendError(res, "A valid month (YYYY-MM) is required.");
  const basis = basisOf(req.query.basis);
  const [buckets, plan, rev] = await Promise.all([
    loadBuckets(month, month, basis),
    BudgetPlan.findOne({ month }).lean(),
    monthRevenue(month, basis),
  ]);
  const analysis = buildAnalysis({ buckets, plan, month, now: new Date(), ...rev });
  return sendSuccess(res, { ...analysis, basis, plan: planView(plan) });
};
 
// GET /budgets/suggest?month=YYYY-MM&basis=
// Suggested budget for `month` from the history BEFORE it:
//   purchase heads → last month's purchase × (1 + growth of the linked P&L revenue)
//   expense heads  → last month's expense  × (1 + growth of the head's own expense since its first entry)
export const getBudgetSuggestions = async (req, res) => {
  const { month } = req.query;
  if (!MONTH_RE.test(month || "")) return sendError(res, "A valid month (YYYY-MM) is required.");
  const basis = basisOf(req.query.basis);
  const prev = shiftMonth(month, -1);
  const windowStart = shiftMonth(month, -HISTORY_CAP_MONTHS);
 
  const [settings, firstMonth] = await Promise.all([loadSettings(), firstEntryMonth()]);
  const from = firstMonth && firstMonth > windowStart ? firstMonth : windowStart;
 
  const [buckets, plRevenue, prevPlan] = await Promise.all([
    firstMonth && from <= prev ? loadBuckets(from, prev, basis) : Promise.resolve(new Map()),
    loadPlRevenue(windowStart, prev, basis),
    BudgetPlan.findOne({ month: prev }).lean(),
  ]);
 
  const result = buildSuggestions({
    buckets, plRevenue, links: settings.revenueLinks, settings, month, prevPlan,
  });
  return sendSuccess(res, { ...result, basis, firstEntryMonth: firstMonth });
};
 
// GET /budgets/alerts?month=YYYY-MM (defaults to the current month)
// Lightweight feed for a notification bell: just the alerts + counts.
export const getBudgetAlerts = async (req, res) => {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const month = req.query.month || `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
  if (!MONTH_RE.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  const basis = basisOf(req.query.basis);
  const [buckets, plan, rev] = await Promise.all([
    loadBuckets(month, month, basis), BudgetPlan.findOne({ month }).lean(), monthRevenue(month, basis),
  ]);
  if (!plan || !(plan.lines || []).length) {
    return sendSuccess(res, { month, hasBudget: false, counts: { danger: 0, warning: 0, info: 0 }, alerts: [] });
  }
  const { alerts } = buildAnalysis({ buckets, plan, month, now: new Date(), ...rev });
  const counts = { danger: 0, warning: 0, info: 0 };
  alerts.forEach((a) => { counts[a.severity] += 1; });
  return sendSuccess(res, { month, hasBudget: true, counts, alerts });
};
 
// GET /budgets/revenues?to=YYYY-MM&months=6&basis=
// Read-only view of the revenue the budget is learning from (straight from the P&L).
export const getRevenueHistory = async (req, res) => {
  const to = req.query.to;
  if (!MONTH_RE.test(to || "")) return sendError(res, "A valid 'to' month (YYYY-MM) is required.");
  const n = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
  const basis = basisOf(req.query.basis);
  const from = shiftMonth(to, -(n - 1));
  const pl = await loadPlRevenue(from, to, basis);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = shiftMonth(to, -i);
    const p = pl[m];
    out.push({
      month: m,
      hasStatement: !!p,
      total: p ? p.total : 0,
      lines: p ? Object.values(p.byLabel).sort((a, b) => b.amount - a.amount) : [],
    });
  }
  return sendSuccess(res, out);
};
 
// PUT /budgets/:month   body: { lines }
export const saveBudgetPlan = async (req, res) => {
  const { month } = req.params;
  if (!MONTH_RE.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  const { lines } = req.body || {};
  if (!Array.isArray(lines) || lines.length > 500) return sendError(res, "lines must be an array (max 500).");
 
  const byKey = new Map();
  for (const l of lines) {
    const key = String(l?.key || "").trim();
    const amount = Number(l?.amount);
    if (!key) return sendError(res, "Every budget line needs a key.");
    if (!Number.isFinite(amount) || amount < 0) return sendError(res, `Budget for '${key}' must be a non-negative number.`);
    byKey.set(key, {
      key,
      groupHead: String(l.groupHead || ""),
      group: String(l.group || ""),
      amount: Math.round(amount * 100) / 100,
      mode: l.mode === "auto" ? "auto" : "manual",
      note: String(l.note || "").slice(0, 300),
    });
  }
 
  const plan = await BudgetPlan.findOneAndUpdate(
    { month },
    { $set: { lines: [...byKey.values()], updatedBy: req.user.userId }, $setOnInsert: { createdBy: req.user.userId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  return sendSuccess(res, planView(plan), "Budget saved.");
};
 
// PUT /budgets/settings   body: { growthMethod, growthCapPct, skipFirstMonth, links }
// links: [{ key, labels:[P&L revenue labels], useTotal }] — which revenue drives each purchase head.
export const saveBudgetSettings = async (req, res) => {
  const { growthMethod, growthCapPct, skipFirstMonth, links } = req.body || {};
  const set = { updatedBy: req.user.userId };
 
  if (growthMethod !== undefined) {
    if (!GROWTH_METHODS.includes(growthMethod)) return sendError(res, `growthMethod must be one of: ${GROWTH_METHODS.join(", ")}.`);
    set.growthMethod = growthMethod;
  }
  if (growthCapPct !== undefined) {
    const n = Number(growthCapPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return sendError(res, "growthCapPct must be between 0 and 100.");
    set.growthCapPct = n;
  }
  if (skipFirstMonth !== undefined) set.skipFirstMonth = !!skipFirstMonth;
  if (links !== undefined) {
    if (!Array.isArray(links) || links.length > 200) return sendError(res, "links must be an array (max 200).");
    const byKey = new Map();
    for (const l of links) {
      const key = String(l?.key || "").trim();
      if (!key) return sendError(res, "Every revenue link needs a key.");
      byKey.set(key, {
        key,
        labels: Array.isArray(l.labels) ? [...new Set(l.labels.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20) : [],
        useTotal: !!l.useTotal,
      });
    }
    set.revenueLinks = [...byKey.values()];
  }
 
  const doc = await BudgetSettings.findOneAndUpdate(
    { key: "default" }, { $set: set },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  return sendSuccess(res, {
    growthMethod: doc.growthMethod, growthCapPct: doc.growthCapPct,
    skipFirstMonth: doc.skipFirstMonth, links: doc.revenueLinks || [],
  }, "Budget settings saved.");
};