import { ExpenseEntry } from "../Model/Expense.modal.js";
import { PLStatement } from "../Model/Pl.model.js";
import { BudgetPlan, BudgetSettings } from "../Model/Budget.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import {
  monthRangeUTC, shiftMonth, bucketRows, buildSuggestions, buildAnalysis, monthConsumption,
  summarisePlStatements, DEFAULT_SETTINGS, GROWTH_METHODS, STOCK_POLICIES, LINE_BEHAVIOURS, RATIO_MONTHS_OPTIONS,
} from "../Utils/Budget.engine.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const HISTORY_CAP_MONTHS = 60; // never look back further than 5 years
// 'incl' (default) = GST-inclusive, exactly how the P&L shows sales and computes
// purchases/consumption (netAmount / finalAmount). 'excl' = before GST.
const basisOf = (q) => (q === "excl" ? "excl" : "incl");

// ─────────────────────────────────────────────────────────────────
// ACTUAL spend per month × Group Head × Group, for an inclusive month range.
// Groups by incurredDate in UTC — identical to getMonthlyExpenseSummary and the P&L's
// live data, so the month an expense lands in here is the month the P&L puts it in.
// Counts every final item (purchases AND voucher expenses). Entry-level delivery
// charge / round-off belong to no single head, so they are not included here.
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
// The saved P&L statements: sales (revenues) and per-category Opening/Closing Stock
// (stockBreakdown). One statement per month; a month without one is simply absent —
// never treated as ₹0 sales.
// ─────────────────────────────────────────────────────────────────
async function loadPl(fromMonth, toMonth, basis) {
  const stmts = await PLStatement.find({ month: { $gte: fromMonth, $lte: toMonth } })
    .select("month revenues stockBreakdown").lean();
  return summarisePlStatements(stmts, basis);
}

async function loadSettings() {
  const doc = await BudgetSettings.findOne({ key: "default" }).lean();
  return {
    growthMethod  : doc?.growthMethod ?? DEFAULT_SETTINGS.growthMethod,
    growthCapPct  : doc?.growthCapPct ?? DEFAULT_SETTINGS.growthCapPct,
    skipFirstMonth: doc?.skipFirstMonth ?? DEFAULT_SETTINGS.skipFirstMonth,
    ratioMonths   : doc?.ratioMonths ?? DEFAULT_SETTINGS.ratioMonths,
    stockPolicy   : doc?.stockPolicy ?? DEFAULT_SETTINGS.stockPolicy,
    revenueLinks  : doc?.revenueLinks ?? [],
    lineSettings  : doc?.lineSettings ?? [],
  };
}

const planView = (p) => (p ? { month: p.month, targetSales: p.targetSales || 0, lines: p.lines || [] } : null);

// GET /budgets/analysis?month=YYYY-MM&basis=incl|excl
export const getBudgetAnalysis = async (req, res) => {
  const { month } = req.query;
  if (!MONTH_RE.test(month || "")) return sendError(res, "A valid month (YYYY-MM) is required.");
  const basis = basisOf(req.query.basis);
  const [buckets, plan, pl] = await Promise.all([
    loadBuckets(month, month, basis),
    BudgetPlan.findOne({ month }).lean(),
    loadPl(month, month, basis),
  ]);
  const revenue = pl[month]?.total || 0;
  const analysis = buildAnalysis({
    buckets, plan, month, now: new Date(),
    revenue, revenueSource: revenue > 0 ? "pl" : "none",
    consumption: monthConsumption({ buckets, pl, month }),
  });
  return sendSuccess(res, { ...analysis, basis, plan: planView(plan) });
};

// GET /budgets/suggest?month=YYYY-MM&basis=&targetSales=&nonFoodReg=
// The plan for `month` from the history BEFORE it, at the target sales figure:
//   COGS heads    → required consumption (target sales × mix × cost ratio) and the purchases it needs
//   OC heads      → fixed (rent, bills, salary) / scales with sales (non-food, regulatable) / own trend
//   CAPEX heads   → monthly average (breakage scales with sales)
// `impact` then shows every head's effect on the target.
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
    loadPl(windowStart, prev, basis),
    BudgetPlan.findOne({ month: prev }).lean(),
  ]);

  // Optional what-if (not saved): extra regulation % applied to every non-food, regulatable line.
  const nonFoodRegPct = Number(req.query.nonFoodReg);
  if (req.query.nonFoodReg !== undefined && req.query.nonFoodReg !== "" && (!Number.isFinite(nonFoodRegPct) || nonFoodRegPct < -100 || nonFoodRegPct > 100)) {
    return sendError(res, "nonFoodReg must be a number between -100 and 100.");
  }

  const result = buildSuggestions({
    buckets, plRevenue, links: settings.revenueLinks, lineSettings: settings.lineSettings,
    settings, month, prevPlan, targetSales: Number(req.query.targetSales) || 0,
    whatIf: { nonFoodRegPct: Number.isFinite(nonFoodRegPct) ? nonFoodRegPct : 0 },
  });
  return sendSuccess(res, { ...result, basis, firstEntryMonth: firstMonth, lineSettings: settings.lineSettings });
};

// GET /budgets/alerts?month=YYYY-MM (defaults to the current month)
// Lightweight feed for a notification bell: just the alerts + counts.
export const getBudgetAlerts = async (req, res) => {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const month = req.query.month || `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
  if (!MONTH_RE.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  const basis = basisOf(req.query.basis);
  const [buckets, plan, pl] = await Promise.all([
    loadBuckets(month, month, basis), BudgetPlan.findOne({ month }).lean(), loadPl(month, month, basis),
  ]);
  if (!plan || !(plan.lines || []).length) {
    return sendSuccess(res, { month, hasBudget: false, counts: { danger: 0, warning: 0, info: 0 }, alerts: [] });
  }
  const revenue = pl[month]?.total || 0;
  const { alerts } = buildAnalysis({
    buckets, plan, month, now: new Date(), revenue, revenueSource: revenue > 0 ? "pl" : "none",
    consumption: monthConsumption({ buckets, pl, month }),
  });
  const counts = { danger: 0, warning: 0, info: 0 };
  alerts.forEach((a) => { counts[a.severity] += 1; });
  return sendSuccess(res, { month, hasBudget: true, counts, alerts });
};

// GET /budgets/revenues?to=YYYY-MM&months=6&basis=
// Read-only view of the sales the budget is learning from (straight from the P&L).
export const getRevenueHistory = async (req, res) => {
  const to = req.query.to;
  if (!MONTH_RE.test(to || "")) return sendError(res, "A valid 'to' month (YYYY-MM) is required.");
  const n = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
  const basis = basisOf(req.query.basis);
  const from = shiftMonth(to, -(n - 1));
  const pl = await loadPl(from, to, basis);
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

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

// PUT /budgets/:month   body: { targetSales?, lines }
export const saveBudgetPlan = async (req, res) => {
  const { month } = req.params;
  if (!MONTH_RE.test(month)) return sendError(res, "A valid month (YYYY-MM) is required.");
  const { lines, targetSales } = req.body || {};
  if (!Array.isArray(lines) || lines.length > 500) return sendError(res, "lines must be an array (max 500).");

  const set = { updatedBy: req.user.userId };
  if (targetSales !== undefined) {
    const t = Number(targetSales);
    if (!Number.isFinite(t) || t < 0) return sendError(res, "targetSales must be a non-negative number.");
    set.targetSales = t;
  }

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
      salesTarget: Math.round(num(l.salesTarget) * 100) / 100,
      consumptionTarget: Math.round(num(l.consumptionTarget) * 100) / 100,
      note: String(l.note || "").slice(0, 300),
    });
  }
  set.lines = [...byKey.values()];

  const plan = await BudgetPlan.findOneAndUpdate(
    { month },
    { $set: set, $setOnInsert: { createdBy: req.user.userId } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  return sendSuccess(res, planView(plan), "Budget saved.");
};

// PUT /budgets/settings
// body: { growthMethod, growthCapPct, skipFirstMonth, ratioMonths, stockPolicy, links, lineSettings }
export const saveBudgetSettings = async (req, res) => {
  const b = req.body || {};
  const set = { updatedBy: req.user.userId };

  if (b.growthMethod !== undefined) {
    if (!GROWTH_METHODS.includes(b.growthMethod)) return sendError(res, `growthMethod must be one of: ${GROWTH_METHODS.join(", ")}.`);
    set.growthMethod = b.growthMethod;
  }
  if (b.growthCapPct !== undefined) {
    const n = Number(b.growthCapPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return sendError(res, "growthCapPct must be between 0 and 100.");
    set.growthCapPct = n;
  }
  if (b.skipFirstMonth !== undefined) set.skipFirstMonth = !!b.skipFirstMonth;
  if (b.ratioMonths !== undefined) {
    const n = Number(b.ratioMonths);
    if (!RATIO_MONTHS_OPTIONS.includes(n)) return sendError(res, `ratioMonths must be one of: ${RATIO_MONTHS_OPTIONS.join(", ")}.`);
    set.ratioMonths = n;
  }
  if (b.stockPolicy !== undefined) {
    if (!STOCK_POLICIES.includes(b.stockPolicy)) return sendError(res, `stockPolicy must be one of: ${STOCK_POLICIES.join(", ")}.`);
    set.stockPolicy = b.stockPolicy;
  }
  if (b.links !== undefined) {
    if (!Array.isArray(b.links) || b.links.length > 200) return sendError(res, "links must be an array (max 200).");
    const byKey = new Map();
    for (const l of b.links) {
      const key = String(l?.key || "").trim();
      if (!key) return sendError(res, "Every sales link needs a key.");
      byKey.set(key, {
        key,
        labels: Array.isArray(l.labels) ? [...new Set(l.labels.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20) : [],
        useTotal: !!l.useTotal,
      });
    }
    set.revenueLinks = [...byKey.values()];
  }
  if (b.lineSettings !== undefined) {
    if (!Array.isArray(b.lineSettings) || b.lineSettings.length > 500) return sendError(res, "lineSettings must be an array (max 500).");
    const byKey = new Map();
    for (const l of b.lineSettings) {
      const key = String(l?.key || "").trim();
      if (!key) return sendError(res, "Every line setting needs a key.");
      const behaviour = l.behaviour || "";
      if (behaviour && !LINE_BEHAVIOURS.includes(behaviour)) return sendError(res, `behaviour for '${key}' must be one of: ${LINE_BEHAVIOURS.join(", ")}.`);
      const reg = Number(l.regulationPct) || 0;
      if (reg < -100 || reg > 100) return sendError(res, `Cost regulation for '${key}' must be between -100 and 100.`);
      if (!behaviour && !reg) continue; // nothing to remember for this line
      byKey.set(key, { key, behaviour, regulationPct: reg });
    }
    set.lineSettings = [...byKey.values()];
  }

  const doc = await BudgetSettings.findOneAndUpdate(
    { key: "default" }, { $set: set },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  ).lean();
  return sendSuccess(res, {
    growthMethod: doc.growthMethod, growthCapPct: doc.growthCapPct, skipFirstMonth: doc.skipFirstMonth,
    ratioMonths: doc.ratioMonths, stockPolicy: doc.stockPolicy,
    links: doc.revenueLinks || [], lineSettings: doc.lineSettings || [],
  }, "Budget settings saved.");
};