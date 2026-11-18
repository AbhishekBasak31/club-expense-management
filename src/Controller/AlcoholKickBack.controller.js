import { AlcoholKickbackDeal, AlcoholKickbackClaim, AlcoholKickbackReceipt } from "../Model/AlcoholKickBack.model.js";
import { ExpenseEntry } from "../Model/Expense.modal.js";
import { Product } from "../Model/product.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { buildAlcoholLinesPipeline } from "./AlcoholPurchaseLine.controller.js";
import {
  round2, isRealDate, todayKey, daysBetween, validateDeal, countBottles, splitLines, norm, targetProgress, suggestClaim,
  claimTotals, claimBalance, dealState, planClaim, buildLedger,
} from "../Utils/AlcoholKickBack.js";
// ─────────────────────────────────────────────────────────────────────────────
// BRAND KICKBACK — deals, claims (the bill raised to the brand), receipts, and the brand ledger.
// Rules live in Utils/AlcoholKickback.js. The bottles bought for a target are counted live from the purchase bills
// (alcohol lines, matched to the brand's products by name — purchase lines carry the product name, not its id).
// ─────────────────────────────────────────────────────────────────────────────
const uid = (req) => req.user?.userId ?? null;
const text = (v) => String(v ?? "").trim();
const monthOf = (d) => d.slice(0, 7);

const loadPurchaseRows = async (from, to) => (from && to ? ExpenseEntry.aggregate(buildAlcoholLinesPipeline(from, to)).allowDiskUse(true) : []);

// what a deal counts: the brand's product names (or just the chosen ones), and the brand name itself for looser matching
async function matchContext(deal) {
  const products = await Product.find({ $or: [{ brandId: deal.brandId }, { brandName: deal.brandName }] }).lean();
  const chosen = new Set((deal.productIds || []).map(String));
  const names = new Set(products.filter((p) => chosen.size === 0 || chosen.has(String(p._id))).map((p) => String(p.name || "").trim().toLowerCase()));
  return { names, brandKey: norm(deal.brandName), exactOnly: chosen.size > 0 };
}

// one pass over the purchase bills for every target deal given
async function boughtByDeal(deals) {
  const targets = deals.filter((d) => d.type === "target");
  if (!targets.length) return new Map();
  const from = targets.map((d) => d.from).sort()[0], to = targets.map((d) => d.to).sort().at(-1);
  const rows = await loadPurchaseRows(from, to);
  const out = new Map();
  for (const d of targets) out.set(String(d._id), countBottles(rows, await matchContext(d), d.from, d.to));
  return out;
}

async function describeDeals(deals, today) {
  const ids = deals.map((d) => d._id);
  const [claims, receipts, bought] = await Promise.all([
    AlcoholKickbackClaim.find({ dealId: { $in: ids }, status: "live" }).lean(),
    AlcoholKickbackReceipt.find({}).lean(),
    boughtByDeal(deals),
  ]);
  const claimOf = new Map(claims.map((c) => [String(c.dealId), c]));
  return deals.map((d) => {
    const claim = claimOf.get(String(d._id)) || null;
    const balance = claim ? claimBalance(claim, receipts) : null;
    const boughtQty = bought.get(String(d._id)) ?? 0;
    const st = dealState(d, { claim, balance, boughtQty, today });
    const suggested = d.type === "target" && !claim ? suggestClaim({ rewardAmount: d.rewardAmount, targetQty: d.targetQty, boughtQty }) : d.type === "sponsorship" ? d.agreedAmount : null;
    return { ...d, ...st, boughtQty, suggestedAmount: suggested, claim: claim ? { ...claim, ...balance } : null };
  });
}

// ── deals ────────────────────────────────────────────────────────────────────
export const getDeals = async (req, res) => {
  const { brandId, type } = req.query;
  const q = { status: "active" };
  if (brandId) q.brandId = brandId;
  if (type) q.type = type;
  const deals = await AlcoholKickbackDeal.find(q).lean();
  const rows = (await describeDeals(deals, todayKey())).sort((a, b) => String(b.eventDate || b.to).localeCompare(String(a.eventDate || a.to)));
  return sendSuccess(res, { rows, count: rows.length });
};

const dealFields = (b) => ({
  type: b.type, brandId: b.brandId, brandName: text(b.brandName), title: text(b.title), notes: text(b.notes),
  eventDate: b.type === "sponsorship" ? text(b.eventDate) : "", agreedAmount: b.type === "sponsorship" ? round2(b.agreedAmount) : 0,
  from: b.type === "target" ? text(b.from) : "", to: b.type === "target" ? text(b.to) : "",
  targetQty: b.type === "target" ? Number(b.targetQty) : 0, rewardAmount: b.type === "target" ? round2(b.rewardAmount) : 0,
  productIds: b.type === "target" && Array.isArray(b.productIds) ? b.productIds : [],
});

export const createDeal = async (req, res) => {
  const err = validateDeal(req.body || {});
  if (err) return sendError(res, err);
  if (!text(req.body.brandName)) return sendError(res, "Choose a brand.");
  const deal = await AlcoholKickbackDeal.create({ ...dealFields(req.body), createdBy: uid(req) });
  return sendSuccess(res, deal, "Deal saved.", 201);
};

export const updateDeal = async (req, res) => {
  const deal = await AlcoholKickbackDeal.findById(req.params.id).lean();
  if (!deal || deal.status === "cancelled") return sendError(res, "Deal not found.", 404);
  if (await AlcoholKickbackClaim.findOne({ dealId: deal._id, status: "live" }).lean()) return sendError(res, "A bill has been raised for this deal — cancel the claim before changing it.");
  const body = { ...req.body, type: deal.type };               // the kind of a deal never changes
  const err = validateDeal(body);
  if (err) return sendError(res, err);
  const saved = await AlcoholKickbackDeal.findByIdAndUpdate(deal._id, dealFields(body), { new: true }).lean();
  return sendSuccess(res, saved, "Deal updated.");
};

export const cancelDeal = async (req, res) => {
  const deal = await AlcoholKickbackDeal.findById(req.params.id).lean();
  if (!deal || deal.status === "cancelled") return sendError(res, "Deal not found.", 404);
  if (await AlcoholKickbackClaim.findOne({ dealId: deal._id, status: "live" }).lean()) return sendError(res, "A bill has been raised for this deal — cancel the claim first.");
  await AlcoholKickbackDeal.findByIdAndUpdate(deal._id, { status: "cancelled" });
  return sendSuccess(res, { id: String(deal._id) }, "Deal cancelled.");
};

// the purchase lines a target deal looked at: the ones counted, and the other alcohol bought in the same window
export const getDealPurchases = async (req, res) => {
  const deal = await AlcoholKickbackDeal.findById(req.params.id).lean();
  if (!deal) return sendError(res, "Deal not found.", 404);
  if (deal.type !== "target") return sendError(res, "Only a target deal counts purchases.");
  const ctx = await matchContext(deal);
  const { matched, other } = splitLines(await loadPurchaseRows(deal.from, deal.to), ctx, deal.from, deal.to);
  const view = (r) => ({ date: new Date(r.date).toISOString().slice(0, 10), billNo: r.billNo || "", reference: r.referenceNumber || "", item: r.alcoholName, vendor: r.vendorName || "", qty: Number(r.qty) || 0 });
  return sendSuccess(res, {
    from: deal.from, to: deal.to, brandName: deal.brandName, exactOnly: ctx.exactOnly,
    matched: matched.map(view), other: other.map(view),
    boughtQty: Math.round(matched.reduce((t, r) => t + (Number(r.qty) || 0), 0) * 1000) / 1000,
  });
};

// ── dashboard ────────────────────────────────────────────────────────────────
export const getDashboard = async (req, res) => {
  const today = isRealDate(req.query.asOn) ? req.query.asOn : todayKey();
  const deals = await describeDeals(await AlcoholKickbackDeal.find({ status: "active" }).lean(), today);
  const claims = await AlcoholKickbackClaim.find({ status: "live" }).lean();
  const receipts = await AlcoholKickbackReceipt.find({}).lean();
  const ready = deals.filter((d) => d.state === "ready");
  const needsForce = deals.filter((d) => d.state === "ended-short");
  const running = deals.filter((d) => d.state === "running" || (d.type === "target" && d.state === "upcoming"));
  const awaiting = claims.map((c) => ({ ...c, ...claimBalance(c, receipts), ageDays: daysBetween(c.claimDate, today) })).filter((c) => c.outstanding > 0.005).sort((a, b) => b.ageDays - a.ageDays);
  const month = monthOf(today);
  return sendSuccess(res, {
    asOn: today,
    cards: {
      readyCount: ready.length, readyAmount: round2(ready.reduce((t, d) => t + (d.suggestedAmount || 0), 0)),
      forceCount: needsForce.length, runningCount: running.length,
      outstanding: round2(awaiting.reduce((t, c) => t + c.outstanding, 0)),
      receivedThisMonth: round2(receipts.filter((r) => r.type === "receipt" && r.month === month).reduce((t, r) => t + r.amount, 0)),
    },
    ready, needsForce, running, awaiting,
  });
};

// ── claims ───────────────────────────────────────────────────────────────────
const nextClaimNo = async () => `KB-${String((await AlcoholKickbackClaim.countDocuments()) + 1).padStart(4, "0")}`;

export const createClaim = async (req, res) => {
  const b = req.body || {};
  const deal = await AlcoholKickbackDeal.findById(b.dealId).lean();
  if (!deal) return sendError(res, "Deal not found.", 404);
  if (await AlcoholKickbackClaim.findOne({ dealId: deal._id, status: "live" }).lean()) return sendError(res, "A bill has already been raised for this deal.");
  const today = todayKey();
  const claimDate = b.claimDate ? String(b.claimDate) : today;
  if (!isRealDate(claimDate)) return sendError(res, "Claim date must be a real date (YYYY-MM-DD).");
  const gst = b.gstPercent === undefined || b.gstPercent === null || b.gstPercent === "" ? 0 : Number(b.gstPercent);
  if (!Number.isFinite(gst) || gst < 0 || gst > 100) return sendError(res, "GST % must be between 0 and 100 (or left empty).");
  const boughtQty = deal.type === "target" ? (await boughtByDeal([deal])).get(String(deal._id)) ?? 0 : 0;
  const plan = planClaim(deal, { boughtQty, body: b, today });
  if (plan.error) return sendError(res, plan.error);
  const t = claimTotals(plan.amount, gst);
  const claim = await AlcoholKickbackClaim.create({
    claimNo: await nextClaimNo(), dealId: deal._id, dealType: deal.type, brandId: deal.brandId, brandName: deal.brandName, title: deal.title,
    claimDate, invoiceNo: text(b.invoiceNo), basis: plan.basis, boughtQty, targetQty: deal.targetQty || 0,
    forceReason: plan.basis === "forced" ? text(b.forceReason) : "", amount: t.amount, gstPercent: t.gstPercent, gstAmount: t.gstAmount, totalAmount: t.totalAmount,
    remark: text(b.remark), status: "live", createdBy: uid(req),
  });
  return sendSuccess(res, claim, `Bill ${claim.claimNo} raised.`, 201);
};

export const cancelClaim = async (req, res) => {
  const claim = await AlcoholKickbackClaim.findById(req.params.id).lean();
  if (!claim || claim.status === "cancelled") return sendError(res, "Claim not found.", 404);
  if (await AlcoholKickbackReceipt.findOne({ claimId: claim._id }).lean()) return sendError(res, "Payments are recorded against this bill — delete them first.");
  await AlcoholKickbackClaim.findByIdAndUpdate(claim._id, { status: "cancelled" });
  return sendSuccess(res, { id: String(claim._id) }, "Claim cancelled — the deal can be billed again.");
};

export const getClaims = async (req, res) => {
  const { brandId, status, from, to } = req.query;
  const q = { status: "live" };
  if (brandId) q.brandId = brandId;
  const [claims, receipts] = await Promise.all([AlcoholKickbackClaim.find(q).lean(), AlcoholKickbackReceipt.find({}).lean()]);
  let rows = claims.filter((c) => (!from || c.claimDate >= from) && (!to || c.claimDate <= to)).map((c) => ({ ...c, ...claimBalance(c, receipts), receipts: receipts.filter((r) => String(r.claimId) === String(c._id)).sort((a, b) => a.date.localeCompare(b.date)) }));
  if (status) rows = rows.filter((c) => c.status === status);
  rows.sort((a, b) => b.claimDate.localeCompare(a.claimDate) || b.claimNo.localeCompare(a.claimNo));
  return sendSuccess(res, { rows, count: rows.length });
};

// ── receipts ─────────────────────────────────────────────────────────────────
export const createReceipt = async (req, res) => {
  const b = req.body || {};
  const claim = await AlcoholKickbackClaim.findById(b.claimId).lean();
  if (!claim || claim.status === "cancelled") return sendError(res, "Claim not found.", 404);
  const type = b.type === "writeoff" ? "writeoff" : "receipt";
  if (!isRealDate(b.date)) return sendError(res, "Date must be a real date (YYYY-MM-DD).");
  const amount = round2(b.amount);
  if (!(amount > 0)) return sendError(res, "Amount must be above 0.");
  const receipts = await AlcoholKickbackReceipt.find({ claimId: claim._id }).lean();
  const bal = claimBalance(claim, receipts);
  if (amount > bal.outstanding + 0.005) return sendError(res, `Only ₹${bal.outstanding} is outstanding on ${claim.claimNo}.`);
  const r = await AlcoholKickbackReceipt.create({ claimId: claim._id, brandId: claim.brandId, type, date: b.date, month: monthOf(b.date), amount, mode: text(b.mode), reference: text(b.reference), remark: text(b.remark), createdBy: uid(req) });
  return sendSuccess(res, r, type === "writeoff" ? "Written off." : "Payment recorded.", 201);
};

export const deleteReceipt = async (req, res) => {
  const r = await AlcoholKickbackReceipt.findById(req.params.id).lean();
  if (!r) return sendError(res, "Entry not found.", 404);
  await AlcoholKickbackReceipt.deleteOne({ _id: r._id });
  return sendSuccess(res, { id: String(r._id) }, "Entry removed.");
};

// ── ledger ───────────────────────────────────────────────────────────────────
// ?from&to[&brandId] — one brand: its full ledger; none: a row per brand (opening, claimed, received, written off, outstanding)
export const getLedger = async (req, res) => {
  const { from, to, brandId } = req.query;
  if (!isRealDate(from) || !isRealDate(to)) return sendError(res, "'from' and 'to' dates (YYYY-MM-DD) are required.");
  if (from > to) return sendError(res, "'from' must not be after 'to'.");
  const [claims, receipts] = await Promise.all([AlcoholKickbackClaim.find(brandId ? { brandId } : {}).lean(), AlcoholKickbackReceipt.find(brandId ? { brandId } : {}).lean()]);
  if (brandId) return sendSuccess(res, { from, to, brandId, brandName: claims[0]?.brandName || "", ...buildLedger(claims, receipts, from, to) });
  const byBrand = new Map();
  claims.forEach((c) => { const k = String(c.brandId); if (!byBrand.has(k)) byBrand.set(k, { brandId: k, brandName: c.brandName, claims: [] }); byBrand.get(k).claims.push(c); });
  const rows = [...byBrand.values()].map((x) => { const { entries, ...l } = buildLedger(x.claims, receipts, from, to); return { brandId: x.brandId, brandName: x.brandName, ...l }; })
    .filter((r) => Math.abs(r.opening) + r.claimed + r.received + r.writtenOff > 0.005).sort((a, b) => b.outstanding - a.outstanding || a.brandName.localeCompare(b.brandName));
  const sum = (k) => round2(rows.reduce((t, r) => t + r[k], 0));
  return sendSuccess(res, { from, to, rows, totals: { opening: sum("opening"), claimed: sum("claimed"), received: sum("received"), writtenOff: sum("writtenOff"), outstanding: sum("outstanding") } });
};

// ── income for the P&L — money actually RECEIVED, by month (write-offs are not income) ────────────────────────────
export const getIncome = async (req, res) => {
  const { from, to } = req.query;
  if (!isRealDate(from) || !isRealDate(to)) return sendError(res, "'from' and 'to' dates (YYYY-MM-DD) are required.");
  const receipts = (await AlcoholKickbackReceipt.find({ type: "receipt" }).lean()).filter((r) => r.date >= from && r.date <= to);
  const by = new Map();
  receipts.forEach((r) => by.set(r.month, round2((by.get(r.month) || 0) + r.amount)));
  const months = [...by.entries()].map(([month, amount]) => ({ month, amount })).sort((a, b) => a.month.localeCompare(b.month));
  return sendSuccess(res, { from, to, months, total: round2(months.reduce((t, m) => t + m.amount, 0)) });
};
