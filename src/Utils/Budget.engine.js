// ─────────────────────────────────────────────────────────────────────────────
// Budget engine — pure functions only (no DB, no Express), so the exact same
// logic is unit-tested against real MIS figures.
//
// THE TWO BUDGET FORMULAS
//  • PURCHASE heads (everything under COGS):
//        budget = last month's purchase for the head × (1 + g)
//    g = growth % of the REVENUE linked to that head, taken from the saved
//    P&L statements of every month before the one being planned.
//  • EXPENSE heads (everything under OC, and breakable capex such as crockery):
//        budget = last month's expense for the head × (1 + g)
//    g = growth % of that head's OWN monthly expense, from its first entry
//    up to last month.
//  • Plain CAPEX is planned spend, so it is left for management to enter.
//
// "g" is a per-month growth rate (see growthFromSeries): by default the
// compound monthly growth over all available months, ignoring the first month
// of history (start-up ramp), capped at ±cap% so one wild month can't run away.
// ─────────────────────────────────────────────────────────────────────────────

// Capex items matching any of these (in any category level) are treated as
// running expense, not asset spend. Edit this list to match your category names.
export const BREAKABLE_KEYWORDS = ["crockery", "glass", "cup", "dish", "plate", "cutlery", "bowl", "mug"];

export const GROWTH_METHODS = ["compound", "average", "last"];
export const DEFAULT_SETTINGS = { growthMethod: "compound", growthCapPct: 25, skipFirstMonth: true };

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Budgets read better as tidy numbers: nearest ₹100 (≥ ₹1,000) or ₹10.
export const tidy = (n) => {
  const v = Math.max(0, Number(n) || 0);
  return v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10;
};

export const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

// ── Month helpers (all UTC, matching how getMonthlyExpenseSummary groups) ───
const pad2 = (n) => String(n).padStart(2, "0");

export const monthRangeUTC = (month) => {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), endExclusive: new Date(Date.UTC(y, m, 1)) };
};

export const shiftMonth = (month, delta) => {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
};

// whole months from a to b (b later → positive)
export const monthDiff = (a, b) => {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return yb * 12 + mb - (ya * 12 + ma);
};

export const daysInMonth = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

const istNow = (now) => {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return { month: `${ist.getUTCFullYear()}-${pad2(ist.getUTCMonth() + 1)}`, day: ist.getUTCDate() };
};

// ── Head classification ─────────────────────────────────────────────────────
export const classifyHead = (headName) => {
  const h = String(headName || "").toLowerCase();
  if (h.includes("cogs")) return "purchase";
  if (h.includes("capex")) return "capex";
  return "expense";
};

const isBreakable = (headType, names) =>
  headType === "capex" &&
  names.some((n) => BREAKABLE_KEYWORDS.some((k) => String(n || "").toLowerCase().includes(k)));

const HEAD_ORDER = { purchase: 0, expense: 1, capex: 2, breakable: 2 };
const BREAKABLE_GROUP_LABEL = "Breakable Items (Counts As Expense)";

// ── Bucket raw aggregation rows into budget lines ───────────────────────────
// rows: [{ _id:{ month, head, group, cat, sub, base }, amount, gst, net }]
export function bucketRows(rows, basis = "excl") {
  const buckets = new Map();
  for (const r of rows) {
    const id = r._id || {};
    const headLabel = String(id.head || "").trim() || "Unclassified";
    let groupLabel = String(id.group || "").trim() || "Unclassified";
    let headType = classifyHead(headLabel);
    if (isBreakable(headType, [id.group, id.cat, id.sub, id.base])) {
      headType = "breakable";
      groupLabel = BREAKABLE_GROUP_LABEL;
    }
    const key = `${headLabel.toLowerCase()}||${groupLabel.toLowerCase()}`;
    const value = basis === "incl" ? r.net : r.amount;
    let b = buckets.get(key);
    if (!b) {
      b = { key, groupHead: headLabel, group: groupLabel, headType, byMonth: {}, _labelWeight: -1 };
      buckets.set(key, b);
    }
    b.byMonth[id.month] = round2((b.byMonth[id.month] || 0) + (Number(value) || 0));
    if ((Number(value) || 0) > b._labelWeight) {
      b._labelWeight = Number(value) || 0;
      b.groupHead = headLabel;
      if (headType !== "breakable") b.group = groupLabel;
    }
  }
  return buckets;
}

const sortLines = (a, b) =>
  (HEAD_ORDER[a.headType] - HEAD_ORDER[b.headType]) ||
  a.groupHead.localeCompare(b.groupHead) ||
  a.group.localeCompare(b.group);

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE FROM THE P&L
// ─────────────────────────────────────────────────────────────────────────────
// Revenue labels are free text typed on the P&L page, so compare them loosely.
// "Shisha" and "Sheesha" are the same thing (the P&L says Sheesha, the stock
// category says Shisha).
export const normLabel = (s) =>
  String(s || "").toLowerCase().replace(/shisha|hookah/g, "sheesha").replace(/\s+/g, " ").trim();

// stmts: PLStatement documents ({ month, revenues:[{ items:[{label,unitPrice,finalAmount}] }] })
// basis 'excl' → unitPrice (before GST, matches the budget's ex-GST spend);
// basis 'incl' → finalAmount.
// Returns { 'YYYY-MM': { total, byLabel: { normLabel: { label, amount } } } }.
// A month with no saved statement is simply absent — never treated as ₹0.
export function summarisePlStatements(stmts, basis = "excl") {
  const out = {};
  for (const s of stmts || []) {
    let total = 0;
    const byLabel = {};
    for (const g of s.revenues || []) {
      for (const it of g.items || []) {
        const amt = Number(basis === "incl" ? it.finalAmount : it.unitPrice) || 0;
        const k = normLabel(it.label);
        if (!k) continue;
        total += amt;
        byLabel[k] = { label: String(it.label).trim(), amount: round2((byLabel[k]?.amount || 0) + amt) };
      }
    }
    out[s.month] = { total: round2(total), byLabel };
  }
  return out;
}

export const availableRevenueLabels = (plRevenue) => {
  const seen = new Map();
  for (const m of Object.values(plRevenue || {}))
    for (const [k, v] of Object.entries(m.byLabel)) if (!seen.has(k)) seen.set(k, v.label);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

// Revenue a link picks out of one month's P&L summary.
export const linkedRevenue = (plMonth, link) => {
  if (!plMonth) return 0;
  if (link.useTotal) return plMonth.total;
  return round2((link.labels || []).reduce((s, l) => s + (plMonth.byLabel[normLabel(l)]?.amount || 0), 0));
};

// Which revenue line(s) should drive a purchase head? A name-based STARTING POINT
// only — the page shows it, management confirms/edits it, and the saved choice
// always wins. Heads with no obvious sales line fall back to total revenue.
export function defaultRevenueLink(line, availableLabels) {
  const text = normLabel(`${line.groupHead} ${line.group}`);
  const picks = new Set();
  const add = (re) => availableLabels.forEach((l) => { if (re.test(normLabel(l))) picks.add(l); });
  if (/food/.test(text)) add(/food/);
  if (/alcohol|liquor/.test(text)) add(/alcohol|liquor/);
  if (/beverage/.test(text)) {
    const before = picks.size;
    add(/beverage/);
    if (picks.size === before) add(/alcohol|liquor/); // no Beverage Sales line → bar sales
  }
  if (/sheesha/.test(text)) add(/sheesha/);
  return picks.size ? { labels: [...picks], useTotal: false } : { labels: [], useTotal: true };
}

export function resolveLink(line, savedLinks, availableLabels) {
  const saved = (savedLinks || []).find((l) => l.key === line.key);
  if (saved) return { key: line.key, labels: saved.labels || [], useTotal: !!saved.useTotal, source: "saved" };
  return { key: line.key, ...defaultRevenueLink(line, availableLabels), source: "default" };
}

// ─────────────────────────────────────────────────────────────────────────────
// GROWTH %
// ─────────────────────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// points: [{ month, value }] oldest → newest. Months with no value (≤ 0) are
// skipped, and growth is measured per CALENDAR month, so a gap in the data
// doesn't inflate the rate.
//   compound — steady monthly rate that takes the first value to the last
//   average  — mean of the month-to-month rates (jumpy with start-up months)
//   last     — only the most recent month-to-month rate
// The first month is ignored by default (start-up ramp) and the result is capped
// at ±capPct so one odd month can't run away.
export function growthFromSeries(points, { method = "compound", capPct = 25, skipFirst = true } = {}) {
  let pts = (points || []).filter((p) => p.value > 0).sort((a, b) => a.month.localeCompare(b.month));
  if (skipFirst && pts.length > 2) pts = pts.slice(1);
  const base = { method, points: pts.length, from: pts[0]?.month ?? null, to: pts[pts.length - 1]?.month ?? null };
  if (pts.length < 2) return { ...base, rate: null, rawRate: null, capped: false };

  const pair = (a, b) => {
    const gap = monthDiff(a.month, b.month);
    return gap > 0 ? Math.pow(b.value / a.value, 1 / gap) - 1 : null;
  };
  let raw;
  if (method === "average") {
    const rs = pts.slice(1).map((p, i) => pair(pts[i], p)).filter((r) => r !== null);
    raw = rs.length ? mean(rs) : null;
  } else if (method === "last") {
    raw = pair(pts[pts.length - 2], pts[pts.length - 1]);
  } else {
    raw = pair(pts[0], pts[pts.length - 1]);
  }
  if (raw === null) return { ...base, rate: null, rawRate: null, capped: false };
  const cap = Math.abs(Number(capPct) || 0) / 100;
  const rate = Math.max(-cap, Math.min(cap, raw));
  return { ...base, rate, rawRate: raw, capped: rate !== raw };
}

const pct1 = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const monthName = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ${y}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTIONS for one month
// ─────────────────────────────────────────────────────────────────────────────
// buckets  : bucketRows over the FULL history up to the month before `month`
// plRevenue: summarisePlStatements over the same history
// settings : { growthMethod, growthCapPct, skipFirstMonth }
// links    : saved revenue links [{ key, labels, useTotal }]
export function buildSuggestions({ buckets, plRevenue = {}, links = [], settings = {}, month, prevPlan }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const prev = shiftMonth(month, -1);
  const opts = { method: cfg.growthMethod, capPct: cfg.growthCapPct, skipFirst: cfg.skipFirstMonth };
  const labels = availableRevenueLabels(plRevenue);
  const prevLines = new Map((prevPlan?.lines || []).map((l) => [l.key, l]));

  const lines = [];
  const resolvedLinks = [];
  const keys = new Set([...buckets.keys(), ...prevLines.keys()]);

  for (const key of keys) {
    const b = buckets.get(key);
    const pl = prevLines.get(key);
    const head = b || { key, groupHead: pl.groupHead, group: pl.group, headType: classifyHead(pl.groupHead), byMonth: {} };
    const byMonth = head.byMonth || {};
    const monthsWithSpend = Object.keys(byMonth).filter((m) => m < month && byMonth[m] > 0).sort();
    if (!monthsWithSpend.length && !pl) continue;

    // "Last month" = the month right before the one being planned; if the head
    // had no spend then, fall back to the most recent month it did.
    let lastKey = prev;
    let last = byMonth[prev] || 0;
    let lastNote = "";
    if (last <= 0 && monthsWithSpend.length) {
      lastKey = monthsWithSpend[monthsWithSpend.length - 1];
      last = byMonth[lastKey];
      lastNote = ` (no spend in ${monthName(prev)}, so the last active month, ${monthName(lastKey)}, is used)`;
    }

    const line = {
      key, groupHead: head.groupHead, group: head.group, headType: head.headType,
      lastActual: round2(byMonth[prev] || 0), lastMonth: lastKey,
      prevBudget: pl ? pl.amount : null,
    };
    const none = { rate: null, rawRate: null, capped: false, points: 0, from: null, to: null, method: cfg.growthMethod };

    if (head.headType === "capex") {
      lines.push({ ...line, behaviour: "manual", growth: { ...none, source: "none" }, suggested: 0, low: 0, high: 0, confidence: "low",
        rationale: "Capex is planned spend, not a recurring cost — enter the budget manually when an item is planned." });
      continue;
    }

    let growth, source, revenueLabels;
    if (head.headType === "purchase") {
      const link = resolveLink(head, links, labels);
      resolvedLinks.push({ ...link, groupHead: head.groupHead, group: head.group });
      const revPoints = Object.keys(plRevenue).filter((m) => m < month).sort()
        .map((m) => ({ month: m, value: linkedRevenue(plRevenue[m], link) }));
      growth = growthFromSeries(revPoints, opts);
      source = "revenue";
      revenueLabels = link.useTotal ? ["Total revenue"] : link.labels;
    } else {
      const own = monthsWithSpend.map((m) => ({ month: m, value: byMonth[m] }));
      growth = growthFromSeries(own, opts);
      source = "self";
    }

    const rate = growth.rate ?? 0;
    const suggested = tidy(last * (1 + rate));
    const spread = 0.05; // ±5 percentage points of growth as a "typical range"
    const low = tidy(last * (1 + rate - spread));
    const high = tidy(last * (1 + rate + spread));

    let rationale;
    if (growth.rate === null) {
      rationale = source === "revenue"
        ? `Not enough revenue history for ${revenueLabels.join(" + ")} in the P&L (need saved statements for at least 2 months) — carrying last month's ${inr(last)} forward${lastNote}.`
        : `Not enough spend history to measure growth — carrying last month's ${inr(last)} forward${lastNote}.`;
    } else {
      const labelsText = revenueLabels && revenueLabels.length ? revenueLabels.join(" + ") : "";
      const what = source === "revenue"
        ? (revenueLabels && revenueLabels[0] === "Total revenue" ? "Total revenue" : `${labelsText} revenue`)
        : "Its own monthly expense";
      const how = cfg.growthMethod === "average" ? "average" : cfg.growthMethod === "last" ? "latest" : "compound";
      rationale = `${what} ${growth.rawRate >= 0 ? "grew" : "fell"} ${Math.abs(growth.rawRate * 100).toFixed(1)}% per month (${how}, ${monthName(growth.from)} → ${monthName(growth.to)}, ${growth.points} months)` +
        `${growth.capped ? `, capped at ${pct1(rate)}` : ""}. Last month's ${inr(last)}${lastNote} × (1 ${rate >= 0 ? "+" : "−"} ${Math.abs(rate * 100).toFixed(1)}%) = ${inr(suggested)}.`;
    }

    const confidence = growth.rate === null ? "low"
      : growth.points >= 4 && !growth.capped ? "high"
      : growth.points >= 3 ? "medium" : "low";

    lines.push({ ...line, behaviour: growth.rate === null ? "insufficient" : source === "revenue" ? "revenue" : "trend",
      growth: { ...growth, source, revenueLabels }, suggested, low, high, confidence, rationale });
  }
  lines.sort(sortLines);
  resolvedLinks.sort((a, b) => a.groupHead.localeCompare(b.groupHead) || a.group.localeCompare(b.group));

  const revenueMonths = Object.keys(plRevenue).filter((m) => m < month).sort()
    .map((m) => ({ month: m, total: plRevenue[m].total }));
  return { month, settings: cfg, availableLabels: labels, links: resolvedLinks, revenueMonths, lines };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS of one month (actual vs budget) + alerts
// ─────────────────────────────────────────────────────────────────────────────
// revenue / revenueSource come from the P&L ('pl' when a statement is saved for
// the month, otherwise 'none' and every "% of revenue" figure is simply blank).
export function buildAnalysis({ buckets, plan, month, now = new Date(), revenue = 0, revenueSource = "none" }) {
  const planLines = new Map((plan?.lines || []).map((l) => [l.key, l]));
  const hasPlan = planLines.size > 0;

  const { month: curMonth, day } = istNow(now);
  const dim = daysInMonth(month);
  const isCurrent = curMonth === month;
  const daysElapsed = isCurrent ? day : month < curMonth ? dim : 0;

  const keys = new Set([...planLines.keys()]);
  for (const [k, b] of buckets) if ((b.byMonth[month] || 0) !== 0) keys.add(k);

  const lines = [];
  for (const key of keys) {
    const b = buckets.get(key);
    const pl = planLines.get(key);
    const head = b || { groupHead: pl.groupHead, group: pl.group, headType: classifyHead(pl.groupHead) };
    const actual = round2(b ? b.byMonth[month] || 0 : 0);
    const budget = pl ? pl.amount : null;
    lines.push(describeLine({ key, groupHead: head.groupHead, group: head.group, headType: head.headType,
      actual, budget, mode: pl?.mode, note: pl?.note, hasPlan, revenue, isCurrent, daysElapsed, dim }));
  }
  lines.sort(sortLines);

  const headMap = new Map();
  for (const l of lines) {
    const hk = l.groupHead.toLowerCase();
    const h = headMap.get(hk) || { groupHead: l.groupHead, headType: l.headType, actual: 0, budget: 0, budgeted: false, lines: 0 };
    h.actual = round2(h.actual + l.actual);
    if (l.budget !== null) { h.budget = round2(h.budget + l.budget); h.budgeted = true; }
    h.lines += 1;
    headMap.set(hk, h);
  }
  const heads = [...headMap.values()].map((h) => {
    const budget = h.budgeted ? h.budget : null;
    const d = describeLine({ key: h.groupHead, groupHead: h.groupHead, group: "", headType: h.headType,
      actual: h.actual, budget, hasPlan, revenue, isCurrent, daysElapsed, dim });
    return { groupHead: h.groupHead, headType: h.headType, actual: h.actual, budget, status: d.status,
      pctUsed: d.pctUsed, actualPctOfRevenue: d.actualPctOfRevenue, budgetPctOfRevenue: d.budgetPctOfRevenue, lines: h.lines };
  }).sort((a, b) => HEAD_ORDER[a.headType] - HEAD_ORDER[b.headType] || a.groupHead.localeCompare(b.groupHead));

  const sum = (f) => round2(lines.reduce((s, l) => s + f(l), 0));
  const totalActual = sum((l) => l.actual);
  const totalBudget = sum((l) => l.budget || 0);
  const byType = {};
  for (const l of lines) {
    const t = (byType[l.headType] ||= { actual: 0, budget: 0 });
    t.actual = round2(t.actual + l.actual);
    t.budget = round2(t.budget + (l.budget || 0));
  }
  const totals = {
    actual: totalActual, budget: totalBudget, revenue, revenueSource,
    actualPctOfRevenue: revenue > 0 ? round2((totalActual / revenue) * 100) : null,
    budgetPctOfRevenue: revenue > 0 && totalBudget > 0 ? round2((totalBudget / revenue) * 100) : null,
    byType,
  };

  const alerts = [];
  for (const l of lines) {
    const name = `${l.groupHead} › ${l.group}`;
    if (l.status === "over") {
      alerts.push({ level: "over", severity: "danger", key: l.key, groupHead: l.groupHead, group: l.group,
        message: `${name} is over budget by ${inr(l.actual - (l.budget || 0))} (${inr(l.actual)} spent vs ${inr(l.budget)} budgeted).` });
    } else if (l.status === "warn") {
      alerts.push({ level: "warn", severity: "warning", key: l.key, groupHead: l.groupHead, group: l.group,
        message: `${name} has used ${Math.round(l.pctUsed)}% of its budget (${inr(l.actual)} of ${inr(l.budget)}).` });
    } else if (l.status === "projected_over") {
      alerts.push({ level: "projected", severity: "warning", key: l.key, groupHead: l.groupHead, group: l.group,
        message: `${name} is on pace to reach ${inr(l.projectedMonthEnd)} by month-end, above its ${inr(l.budget)} budget.` });
    } else if (l.status === "unbudgeted") {
      alerts.push({ level: "unbudgeted", severity: "info", key: l.key, groupHead: l.groupHead, group: l.group,
        message: `${name} has ${inr(l.actual)} of spend but no budget set.` });
    }
  }
  if (totals.actualPctOfRevenue !== null && totals.budgetPctOfRevenue !== null &&
      totals.actualPctOfRevenue > totals.budgetPctOfRevenue + 2) {
    alerts.push({ level: "ratio", severity: "warning", key: "total", groupHead: "Total", group: "",
      message: `Total spend is ${totals.actualPctOfRevenue.toFixed(1)}% of revenue, but the budget assumed ${totals.budgetPctOfRevenue.toFixed(1)}%.` });
  }
  const order = { danger: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);

  return { month, revenue, revenueSource, progress: { isCurrentMonth: isCurrent, daysElapsed, daysInMonth: dim },
    lines, heads, totals, alerts };
}

function describeLine({ key, groupHead, group, headType, actual, budget, mode, note, hasPlan, revenue, isCurrent, daysElapsed, dim }) {
  let status = "none";
  let pctUsed = null;
  let projectedMonthEnd = null;
  if (isCurrent && daysElapsed > 0) projectedMonthEnd = round2((actual / daysElapsed) * dim);

  if (budget !== null && budget !== undefined) {
    pctUsed = budget > 0 ? round2((actual / budget) * 100) : actual > 0 ? null : 0;
    if (actual > budget) status = "over";
    else if (budget > 0 && actual >= budget * 0.9) status = "warn";
    else if (isCurrent && daysElapsed >= 5 && budget > 0 && projectedMonthEnd > budget * 1.05) status = "projected_over";
    else status = "ok";
  } else if (hasPlan && actual > 0) {
    status = "unbudgeted";
  }

  return {
    key, groupHead, group, headType, actual,
    budget: budget ?? null,
    mode: mode || null,
    note: note || "",
    variance: budget === null || budget === undefined ? null : round2(budget - actual),
    pctUsed, status, projectedMonthEnd,
    actualPctOfRevenue: revenue > 0 ? round2((actual / revenue) * 100) : null,
    budgetPctOfRevenue: revenue > 0 && budget ? round2((budget / revenue) * 100) : null,
  };
}