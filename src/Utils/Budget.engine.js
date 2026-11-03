// ─────────────────────────────────────────────────────────────────────────────
// Budget engine — pure functions only (no DB, no Express), so the exact same
// logic is unit-tested against your worked example and real MIS figures.
//
// HOW A BUDGET IS BUILT  (management supplies ONE number: the TARGET SALES)
//
//  From the saved P&L of the previous month(s) the engine reads:
//    • total sales and head-wise sales (Food Sales, Alcohol Sales, …)
//    • head-wise CONSUMPTION  = Opening stock + Purchase − Closing stock
//      (Cloud has no stock, so its consumption is its raw spend — same as the P&L)
//
//  COGS heads (Food, Alcohol, Beverages, Shisha, Tobacco, Packing, Cloud):
//    1. sales mix        = head sales ÷ total sales
//    2. target head sales = target sales × mix
//    3. cost ratio       = consumption ÷ head sales            (last month)
//    4. REQUIRED CONSUMPTION = target head sales × cost ratio
//    5. PROJECTED PURCHASES  = required consumption + target closing stock − opening stock
//       (opening = last month's closing; closing target scales with volume, or is held)
//
//  Expense heads (OC, breakable capex such as crockery, other purchases):
//    • Scales with sales — non-food items like tissue/toiletries/housekeeping:
//          expense ÷ total sales (last month) × target sales
//    • Own trend — rent, bills and other fixed-type costs:
//          last month × (1 + the head's own monthly growth since its first entry)
//    • Fixed — exactly last month
//    Each line can also carry a "cost regulation" % (e.g. −5% to tighten it).
//
//  Plain CAPEX is planned spend, so it is left for management to enter.
// ─────────────────────────────────────────────────────────────────────────────

// Capex items matching any of these (in any category level) are treated as
// running expense, not asset spend. Edit this list to match your category names.
export const BREAKABLE_KEYWORDS = ["crockery", "glass", "cup", "dish", "plate", "cutlery", "bowl", "mug"];

// Expense lines whose NAME suggests they move with sales. Only the STARTING guess:
// management can change any line's behaviour on the page and the saved choice wins.
export const VARIABLE_COST_KEYWORDS = [
  "tissue", "toilet", "housekeep", "house keep", "cleaning", "consumable", "disposable", "napkin",
  "packag", "stationer", "commission", "swipe", "card", "laundry", "uniform", "non food", "non-food", "breakable",
];

// Costs that do not move with sales: rent, bills, salary. Again only the STARTING guess.
export const FIXED_COST_KEYWORDS = [
  "rent", "cam", "electric", "power", "water", "gas", "utilit", "bill", "salary", "salaries", "wage", "payroll",
  "esic", "provident", "insurance", "licen", "internet", "telephone", "software", "website",
];

// The same list the P&L uses (Reports.tsx STOCK_TRACKED_CATEGORIES) + Cloud (raw spend).
export const STOCK_TRACKED = ["Food", "Alcohol", "Beverages", "Shisha", "Tobacco", "Packing Expense"];
export const CLOUD = "Cloud Expense";
export const COGS_CATEGORIES = [...STOCK_TRACKED, CLOUD];

export const GROWTH_METHODS = ["compound", "average", "last"];
export const STOCK_POLICIES = ["scale", "hold"];
export const LINE_BEHAVIOURS = ["trend", "variable", "fixed", "average"];
export const RATIO_MONTHS_OPTIONS = [1, 3, 6];
export const DEFAULT_SETTINGS = {
  growthMethod: "compound", growthCapPct: 25, skipFirstMonth: true, ratioMonths: 1, stockPolicy: "scale",
};

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Budgets read better as tidy numbers: nearest ₹100 (≥ ₹1,000) or ₹10.
export const tidy = (n) => {
  const v = Math.max(0, Number(n) || 0);
  return v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10;
};

export const inr = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
// Collapses ANY run of whitespace (double spaces, non-breaking spaces) — category names
// typed into the master often carry them, and they look identical on screen.
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
// Category names compared loosely: plural/singular and Shisha/Sheesha spellings.
const catNorm = (s) => norm(s).replace(/shisha|sheesha|hookah/g, "shisha").replace(/expenses\b/g, "expense").replace(/beverage\b/g, "beverages");

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

const monthName = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1]} ${y}`;
};

// ── Head classification ─────────────────────────────────────────────────────
export const classifyHead = (headName) => {
  const h = norm(headName);
  if (h.includes("cogs")) return "purchase";
  if (h.includes("capex")) return "capex";
  return "expense";
};

const isBreakable = (headType, names) =>
  headType === "capex" && names.some((n) => BREAKABLE_KEYWORDS.some((k) => norm(n).includes(k)));

// The P&L matches a COGS category by Group name OR Sub-category name (Alcohol and
// Beverages live as sub-categories inside one combined "Alcohol & Beverages" group).
const cogsCategoryOf = (id) =>
  COGS_CATEGORIES.find((c) => catNorm(c) === catNorm(id.group) || catNorm(c) === catNorm(id.sub)) || null;

const HEAD_ORDER = { purchase: 0, expense: 1, capex: 2, breakable: 2 };
const BREAKABLE_GROUP_LABEL = "Breakable Items (Counts As Expense)";
const catKey = (cat) => `cogs||${norm(cat)}`;

// ── Bucket raw aggregation rows into budget lines ───────────────────────────
// rows: [{ _id:{ month, head, group, cat, sub, base }, amount, gst, net }]
// basis 'incl' → netAmount (what the P&L uses for purchases/consumption); 'excl' → amount.
export function bucketRows(rows, basis = "incl") {
  const buckets = new Map();
  for (const r of rows) {
    const id = r._id || {};
    let headLabel = String(id.head || "").trim() || "Unclassified";
    let groupLabel = String(id.group || "").trim() || "Unclassified";
    const category = cogsCategoryOf(id);
    let headType = category ? "purchase" : classifyHead(headLabel);
    if (category) {
      headLabel = "COGS";
      groupLabel = category;
    } else if (isBreakable(headType, [id.group, id.cat, id.sub, id.base])) {
      headType = "breakable";
      groupLabel = BREAKABLE_GROUP_LABEL;
    }
    const key = `${norm(headLabel)}||${norm(groupLabel)}`;
    const value = basis === "incl" ? r.net : r.amount;
    let b = buckets.get(key);
    if (!b) {
      b = { key, groupHead: headLabel, group: groupLabel, headType, category, byMonth: {}, _labelWeight: -1 };
      buckets.set(key, b);
    }
    b.byMonth[id.month] = round2((b.byMonth[id.month] || 0) + (Number(value) || 0));
    if (!category && (Number(value) || 0) > b._labelWeight) {
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
// THE P&L: sales + stock
// ─────────────────────────────────────────────────────────────────────────────
// "Shisha" and "Sheesha" are the same thing (the P&L says Sheesha, the stock
// category says Shisha), so compare labels loosely.
export const normLabel = (s) =>
  String(s || "").toLowerCase().replace(/shisha|hookah/g, "sheesha").replace(/\s+/g, " ").trim();

// stmts: PLStatement documents. basis 'incl' → finalAmount (GST-inclusive, as the P&L
// shows sales); 'excl' → unitPrice (before GST).
// Returns { 'YYYY-MM': { total, byLabel:{norm:{label,amount}}, stock:{normCategory:{opening,closing}} } }.
// A month with no saved statement is simply absent — never treated as ₹0.
export function summarisePlStatements(stmts, basis = "incl") {
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
    const stock = {};
    for (const r of s.stockBreakdown || []) {
      stock[norm(r.category)] = { opening: Number(r.openingStock) || 0, closing: Number(r.closingStock) || 0 };
    }
    out[s.month] = { total: round2(total), byLabel, stock };
  }
  return out;
}

export const availableRevenueLabels = (pl) => {
  const seen = new Map();
  for (const m of Object.values(pl || {}))
    for (const [k, v] of Object.entries(m.byLabel)) if (!seen.has(k)) seen.set(k, v.label);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

export const linkedRevenue = (plMonth, link) => {
  if (!plMonth) return 0;
  if (link.useTotal) return plMonth.total;
  return round2((link.labels || []).reduce((s, l) => s + (plMonth.byLabel[normLabel(l)]?.amount || 0), 0));
};

// Which sales line(s) belong to a COGS head. A name-based STARTING POINT only — the
// page shows it, management confirms/edits it, and the saved choice always wins.
// A head with no sales line of its own (Packing, or Beverages if the P&L has no
// Beverages Sales line) uses total sales, so one sales line is never counted twice.
export function defaultRevenueLink(line, availableLabels) {
  const text = normLabel(`${line.groupHead} ${line.group}`);
  const rules = [
    [/food/, /food/], [/alcohol|liquor/, /alcohol|liquor/], [/beverage/, /beverage/],
    [/sheesha/, /sheesha/], [/tobacco/, /tobacco/], [/cloud/, /cloud/],
  ];
  const picks = new Set();
  for (const [when, pick] of rules) {
    if (when.test(text)) availableLabels.forEach((l) => { if (pick.test(normLabel(l))) picks.add(l); });
  }
  return picks.size ? { labels: [...picks], useTotal: false } : { labels: [], useTotal: true };
}

export function resolveLink(line, savedLinks, availableLabels) {
  const saved = (savedLinks || []).find((l) => l.key === line.key);
  if (saved) return { key: line.key, labels: saved.labels || [], useTotal: !!saved.useTotal, source: "saved" };
  return { key: line.key, ...defaultRevenueLink(line, availableLabels), source: "default" };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSUMPTION  (Opening + Purchase − Closing, exactly as the P&L computes it)
// ─────────────────────────────────────────────────────────────────────────────
// `entered` = a closing stock was actually entered. The P&L treats a missing stock
// row as 0/0, and so does this (for history); live alerts only trust `entered`.
export function monthConsumption({ buckets, pl, month }) {
  const plm = pl?.[month];
  const out = {};
  for (const cat of COGS_CATEGORIES) {
    const key = catKey(cat);
    const b = buckets.get(key);
    const purchase = b ? b.byMonth[month] || 0 : 0;
    if (cat === CLOUD) {
      out[key] = { category: cat, purchase, opening: 0, closing: 0, consumption: round2(purchase), entered: true };
      continue;
    }
    const st = plm?.stock?.[norm(cat)];
    const opening = st?.opening || 0;
    const closing = st?.closing || 0;
    out[key] = { category: cat, purchase, opening, closing, consumption: round2(opening + purchase - closing), entered: closing > 0 };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROWTH % (own-trend expense lines)
// ─────────────────────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// points: [{ month, value }]. Months with no value are skipped; growth is per CALENDAR
// month. compound = steady monthly rate first→last; average = mean of monthly rates;
// last = only the most recent monthly rate. First month ignored by default (start-up
// ramp); capped at ±capPct.
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
const NO_GROWTH = { rate: null, rawRate: null, capped: false, points: 0, from: null, to: null, method: "compound", source: "none" };

// Starting guess for how a head behaves when sales change (management can change it):
//   variable — non-food items and breakage: move with sales and CAN be regulated
//   fixed    — rent, bills, salary: do not move with sales
//   average  — plain capex: lumpy, so smoothed to its monthly average
//   trend    — anything else: last month × the head's own growth
export const defaultBehaviour = (line) => {
  const text = norm(`${line.groupHead} ${line.group}`);
  if (line.headType === "breakable" || line.headType === "purchase") return "variable";
  if (line.headType === "capex") return "average";
  if (VARIABLE_COST_KEYWORDS.some((k) => text.includes(k))) return "variable";
  if (FIXED_COST_KEYWORDS.some((k) => text.includes(k))) return "fixed";
  return "trend";
};

// ─────────────────────────────────────────────────────────────────────────────
// SUGGESTIONS for one month
// ─────────────────────────────────────────────────────────────────────────────
// buckets    : bucketRows over the FULL history up to the month before `month`
// plRevenue  : summarisePlStatements over the same history
// links      : saved sales links  [{ key, labels, useTotal }]
// lineSettings: [{ key, behaviour, regulationPct }]
// targetSales: the figure management wants to achieve (same basis as the P&L sales)
export function buildSuggestions({ buckets, plRevenue = {}, links = [], settings = {}, lineSettings = [], month, targetSales, prevPlan, whatIf = {} }) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const prev = shiftMonth(month, -1);
  const gOpts = { method: cfg.growthMethod, capPct: cfg.growthCapPct, skipFirst: cfg.skipFirstMonth };
  const labels = availableRevenueLabels(plRevenue);
  const prevLines = new Map((prevPlan?.lines || []).map((l) => [l.key, l]));
  const lsOf = (key) => lineSettings.find((l) => l.key === key) || {};
  // What-if: extra regulation applied to every non-food (variable, non-COGS) line — not saved.
  const whatIfReg = Number(whatIf.nonFoodRegPct) || 0;

  // Months of saved P&L (with sales) before the month being planned; the last
  // `ratioMonths` of them are the learning window, the newest is "last month".
  const plMonths = Object.keys(plRevenue).filter((m) => m < month && plRevenue[m].total > 0).sort();
  const win = plMonths.slice(-Math.max(1, Number(cfg.ratioMonths) || 1));
  const lastPl = plMonths[plMonths.length - 1] || null;
  const sTotal = win.reduce((s, m) => s + plRevenue[m].total, 0);
  const lastTotalSales = lastPl ? plRevenue[lastPl].total : 0;

  const targetGiven = Number(targetSales) > 0;
  const T = targetGiven ? Number(targetSales) : lastTotalSales;
  const targetSource = targetGiven ? "manual" : lastTotalSales > 0 ? "last-month" : "none";
  const avgSales = win.length ? sTotal / win.length : 0;
  const growthFactor = avgSales > 0 && T > 0 ? T / avgSales : null;

  const lines = [];
  const resolvedLinks = [];
  const keys = new Set([...buckets.keys(), ...prevLines.keys()]);

  for (const key of keys) {
    const b = buckets.get(key);
    const pl = prevLines.get(key);
    const head = b || { key, groupHead: pl.groupHead, group: pl.group, headType: classifyHead(pl.groupHead), category: null, byMonth: {} };
    const byMonth = head.byMonth || {};
    const monthsWithSpend = Object.keys(byMonth).filter((m) => m < month && byMonth[m] > 0).sort();
    if (!monthsWithSpend.length && !pl) continue;

    let lastKey = prev;
    let last = byMonth[prev] || 0;
    let lastNote = "";
    if (last <= 0 && monthsWithSpend.length) {
      lastKey = monthsWithSpend[monthsWithSpend.length - 1];
      last = byMonth[lastKey];
      lastNote = ` (no spend in ${monthName(prev)}, so ${monthName(lastKey)} is used)`;
    }
    const ls = lsOf(key);
    const reg = Number(ls.regulationPct) || 0;
    const regText = reg ? ` Cost regulation ${reg > 0 ? "+" : ""}${reg}% applied.` : "";

    const line = {
      key, groupHead: head.groupHead, group: head.group, headType: head.headType,
      lastActual: round2(byMonth[prev] || 0), lastMonth: lastKey, prevBudget: pl ? pl.amount : null,
      regulationPct: reg, growth: { ...NO_GROWTH }, consumption: null, ratioToSales: null,
    };
    const finish = (extra) => {
      const suggested = extra.suggested;
      const isCogs = head.headType === "purchase";
      const costClass = isCogs ? "cogs"
        : head.headType === "capex" || head.headType === "breakable" ? "capex"
        : extra.behaviour === "variable" ? "regulatable" : "fixed";
      // The COST of a COGS head is its consumption; for every other head it is the spend.
      const lastCost = extra.consumption ? extra.consumption.lastConsumption : line.lastActual;
      const projectedCost = extra.consumption ? extra.consumption.requiredConsumption : suggested;
      lines.push({ ...line, ...extra, costClass, lastCost: round2(lastCost), projectedCost: round2(projectedCost),
        low: tidy(suggested * 0.9), high: tidy(suggested * 1.1) });
    };

    // ── COGS category: consumption-based plan ──
    if (head.category) {
      const link = resolveLink(head, links, labels);
      resolvedLinks.push({ ...link, groupHead: head.groupHead, group: head.group });
      const cat = head.category;
      const isCloud = cat === CLOUD;
      const cons = win.map((m) => monthConsumption({ buckets, pl: plRevenue, month: m })[key]);
      const sHead = win.reduce((s, m) => s + linkedRevenue(plRevenue[m], link), 0);
      const cSum = cons.reduce((s, c) => s + Math.max(0, c.consumption), 0);
      const denom = link.useTotal ? sTotal : sHead;

      if (!win.length || denom <= 0 || T <= 0) {
        finish({ behaviour: "insufficient", suggested: tidy(last), confidence: "low",
          rationale: !win.length
            ? `No saved P&L with sales before ${monthName(month)} — carrying last month's purchases ${inr(last)} forward${lastNote}.`
            : `No sales found in the P&L for ${link.useTotal ? "total revenue" : link.labels.join(" + ") || "this head"} — carrying last month's purchases ${inr(last)} forward${lastNote}.` });
        continue;
      }

      const share = link.useTotal ? 1 : sHead / sTotal;
      const targetHeadSales = link.useTotal ? T : T * share;
      const ratio = cSum / denom;
      const required = ratio * (1 + reg / 100) * (link.useTotal ? T : targetHeadSales);
      const avgC = cSum / win.length;
      const k = avgC > 0 ? required / avgC : null;

      const lastCons = monthConsumption({ buckets, pl: plRevenue, month: lastPl })[key];
      const opening = isCloud ? 0 : (plRevenue[lastPl]?.stock?.[norm(cat)]?.closing || 0);
      const targetClosing = isCloud ? 0 : (cfg.stockPolicy === "scale" && k !== null && isFinite(k) ? opening * k : opening);
      const projectedPurchase = isCloud ? required : Math.max(0, required + targetClosing - opening);
      const suggested = tidy(projectedPurchase);

      const stockEntered = isCloud ? true : cons.every((c) => c.entered);
      const confidence = win.length >= 3 && stockEntered ? "high" : (win.length >= 2 || stockEntered) ? "medium" : "low";
      const salesWhat = link.useTotal ? "total sales" : `${link.labels.join(" + ")} sales`;
      const rationale =
        `${salesWhat} were ${inr(sHead / win.length)} last ${win.length > 1 ? `${win.length}-month average` : "month"}` +
        `${link.useTotal ? "" : ` (${(share * 100).toFixed(1)}% of sales)`}; consumption was ${(ratio * 100).toFixed(1)}% of that. ` +
        `At ${inr(T)} total sales the head sells ${inr(targetHeadSales)}, so it needs ${inr(required)} of consumption` +
        `${isCloud ? "" : ` and ${inr(projectedPurchase)} of purchases (opening stock ${inr(opening)}, closing target ${inr(targetClosing)})`}.` +
        `${stockEntered || isCloud ? "" : " Stock was not entered in the P&L for some months, so consumption there equals purchases."}${regText}`;

      finish({
        behaviour: "consumption", suggested, confidence, rationale,
        consumption: {
          lastSales: round2(linkedRevenue(plRevenue[lastPl], link)), lastConsumption: lastCons.consumption,
          mixShare: link.useTotal ? null : share, costRatio: ratio, targetSales: round2(targetHeadSales),
          requiredConsumption: round2(required), openingStock: round2(opening), targetClosing: round2(targetClosing),
          projectedPurchase: round2(projectedPurchase), stockEntered, usesTotalSales: !!link.useTotal,
          salesLabels: link.useTotal ? ["Total sales"] : link.labels,
        },
      });
      continue;
    }

    // ── expense / breakable / other purchase lines ──
    let behaviour = LINE_BEHAVIOURS.includes(ls.behaviour) ? ls.behaviour : defaultBehaviour(head);
    let base, growth = { ...NO_GROWTH }, rationale, ratioToSales = null;
    const sExp = win.reduce((s, m) => s + (byMonth[m] || 0), 0);

    if (behaviour === "variable" && (!win.length || sTotal <= 0 || T <= 0)) behaviour = "trend"; // nothing to scale against
    const isNonFood = head.headType !== "purchase" && behaviour === "variable";
    const wi = isNonFood ? whatIfReg : 0;
    const wiText = wi ? ` What-if non-food regulation ${wi > 0 ? "+" : ""}${wi}% applied.` : "";

    if (behaviour === "variable") {
      ratioToSales = sExp / sTotal;
      base = ratioToSales * T;
      rationale = `Scales with sales: ${(ratioToSales * 100).toFixed(2)}% of total sales over ${win.length > 1 ? `the last ${win.length} months` : "last month"} × target sales ${inr(T)} = ${inr(base)}.${regText}`;
    } else if (behaviour === "fixed") {
      base = last;
      rationale = `Fixed cost: it does not move with sales, so last month's ${inr(last)}${lastNote} is carried forward unchanged.${regText}`;
    } else if (behaviour === "average") {
      const first = monthsWithSpend[0];
      const span = Math.max(1, monthDiff(first, prev) + 1);
      const total = monthsWithSpend.reduce((acc, m) => acc + byMonth[m], 0);
      base = total / span;
      rationale = `Occasional/lumpy spend: monthly average ${inr(base)} (${inr(total)} over ${span} months since ${monthName(first)}). Enter a figure by hand when an item is planned.${regText}`;
    } else {
      const own = monthsWithSpend.map((m) => ({ month: m, value: byMonth[m] }));
      const g = growthFromSeries(own, gOpts);
      growth = { ...g, source: "self" };
      const rate = g.rate ?? 0;
      base = last * (1 + rate);
      rationale = g.rate === null
        ? `Not enough history to measure growth — carrying last month's ${inr(last)} forward${lastNote}.${regText}`
        : `Its own monthly expense ${g.rawRate >= 0 ? "grew" : "fell"} ${Math.abs(g.rawRate * 100).toFixed(1)}% per month (${monthName(g.from)} → ${monthName(g.to)}, ${g.points} months)` +
          `${g.capped ? `, capped at ${pct1(rate)}` : ""}. Last month's ${inr(last)}${lastNote} × (1 ${rate >= 0 ? "+" : "−"} ${Math.abs(rate * 100).toFixed(1)}%) = ${inr(base)}.${regText}`;
      if (g.rate === null) behaviour = "insufficient";
    }
    const suggested = tidy(base * (1 + reg / 100) * (1 + wi / 100));
    const pts = behaviour === "trend" ? growth.points : win.length;
    const confidence = behaviour === "insufficient" || behaviour === "average" ? "low" : behaviour === "fixed" ? "medium" : pts >= 4 && !growth.capped ? "high" : pts >= 2 ? "medium" : "low";
    finish({ behaviour, suggested, confidence, rationale: rationale + wiText, growth, ratioToSales });
  }

  lines.sort(sortLines);
  resolvedLinks.sort((a, b) => a.group.localeCompare(b.group));

  // Two heads pointing at the same sales line would double-count its sales in the mix.
  const warnings = [];
  const seen = new Map();
  for (const l of resolvedLinks) {
    if (l.useTotal) continue;
    for (const lab of l.labels) {
      const k = normLabel(lab);
      if (seen.has(k)) warnings.push(`"${lab}" drives both ${seen.get(k)} and ${l.group} — its sales are counted twice in the mix. Change one of the links.`);
      else seen.set(k, l.group);
    }
  }
  if (!lastPl) warnings.push("No saved P&L statement with sales exists before this month, so COGS heads can't be planned from sales yet.");
  for (const l of lines) {
    if (l.headType === "purchase" && !l.consumption && l.behaviour !== "insufficient") {
      warnings.push(`COGS group "${l.group}" isn't one of the P&L's consumption categories (${COGS_CATEGORIES.join(", ")}), so it is planned as a cost that scales with sales. If it should be one of them, check its spelling in the Category Master.`);
    }
  }

  // ── Impact: every head, grouped by how it behaves, and what each does to the target ──
  const cogs = lines.filter((l) => l.behaviour === "consumption");
  const requiredConsumption = round2(cogs.reduce((acc, l) => acc + l.consumption.requiredConsumption, 0));
  const projectedPurchases = round2(cogs.reduce((acc, l) => acc + l.consumption.projectedPurchase, 0));
  const sectionDefs = [
    ["cogs", "COGS — consumption"],
    ["fixed", "Operating cost — fixed (rent, bills, salary…)"],
    ["regulatable", "Operating cost — non-food, can be regulated"],
    ["capex", "CAPEX (breakage counts as expense)"],
  ];
  const sections = sectionDefs.map(([id, label]) => {
    const ls = lines.filter((l) => l.costClass === id);
    const last = round2(ls.reduce((acc, l) => acc + l.lastCost, 0));
    const projected = round2(ls.reduce((acc, l) => acc + l.projectedCost, 0));
    return {
      id, label, lines: ls.length, last, projected, delta: round2(projected - last),
      lastPctOfSales: lastTotalSales > 0 ? round2((last / lastTotalSales) * 100) : null,
      pctOfTarget: T > 0 ? round2((projected / T) * 100) : null,
    };
  });
  const lastCost = round2(sections.reduce((acc, x) => acc + x.last, 0));
  const projectedCost = round2(sections.reduce((acc, x) => acc + x.projected, 0));
  const extraCost = round2(projectedCost - lastCost);
  sections.forEach((x) => { x.shareOfChange = Math.abs(extraCost) > 0 ? round2((x.delta / extraCost) * 100) : null; });
  const impact = {
    targetSales: round2(T), lastSales: round2(lastTotalSales), lastCost, projectedCost, extraCost,
    lastCostPct: lastTotalSales > 0 ? round2((lastCost / lastTotalSales) * 100) : null,
    projectedCostPct: T > 0 ? round2((projectedCost / T) * 100) : null,
    lastSurplus: round2(lastTotalSales - lastCost), projectedSurplus: round2(T - projectedCost), sections,
  };
  const summary = {
    requiredConsumption, projectedPurchases,
    expenseTotal: round2(projectedCost - requiredConsumption),
    projectedCost, projectedCostPct: impact.projectedCostPct, lastCostPct: impact.lastCostPct,
  };

  const revenueMonths = Object.keys(plRevenue).filter((m) => m < month).sort()
    .map((m) => ({ month: m, total: plRevenue[m].total }));
  return {
    month, settings: cfg, targetSales: round2(T), targetSource, lastSalesMonth: lastPl, lastTotalSales: round2(lastTotalSales),
    growthFactor, windowMonths: win, availableLabels: labels, links: resolvedLinks, warnings, summary, impact, revenueMonths, lines,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS of one month (actual vs budget) + alerts
// ─────────────────────────────────────────────────────────────────────────────
// revenue / revenueSource come from the P&L. `consumption` (from monthConsumption)
// lets COGS lines show real consumption next to the purchase budget once the month's
// closing stock has been entered in the P&L.
export function buildAnalysis({ buckets, plan, month, now = new Date(), revenue = 0, revenueSource = "none", consumption = {} }) {
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
    const line = describeLine({ key, groupHead: head.groupHead, group: head.group, headType: head.headType,
      actual, budget, mode: pl?.mode, note: pl?.note, hasPlan, revenue, isCurrent, daysElapsed, dim });
    const c = consumption[key];
    line.consumptionActual = c && c.entered ? c.consumption : null;
    line.consumptionTarget = pl && pl.consumptionTarget > 0 ? pl.consumptionTarget : null;
    line.salesTarget = pl && pl.salesTarget > 0 ? pl.salesTarget : null;
    lines.push(line);
  }
  lines.sort(sortLines);

  const headMap = new Map();
  for (const l of lines) {
    const hk = norm(l.groupHead);
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
    // Real cost of a COGS head = consumption; compare it with the planned consumption.
    if (l.consumptionActual !== null && l.consumptionTarget !== null && l.consumptionActual > l.consumptionTarget) {
      const over = l.consumptionActual - l.consumptionTarget;
      alerts.push({ level: "consumption", severity: over > l.consumptionTarget * 0.1 ? "danger" : "warning", key: l.key, groupHead: l.groupHead, group: l.group,
        message: `${name} consumption is ${inr(l.consumptionActual)} against a planned ${inr(l.consumptionTarget)} — ${inr(over)} more than needed for the sales target.` });
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