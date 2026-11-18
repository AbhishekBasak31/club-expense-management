// ─────────────────────────────────────────────────────────────────────────────
// ALCOHOL KICKBACK — pure rules (no DB, no Express), so they are tested on their own.
//
// A DEAL is an arrangement with a brand. Two kinds:
//   sponsorship — the brand pays an AGREED AMOUNT for an event (e.g. Chivas sponsors the DJ of the Diwali party).
//                 It can be billed once the event date has come.
//   target      — the brand pays a REWARD if you BUY targetQty bottles of the brand between two dates. Missing the target
//                 you may still bill for what you bought, by a FORCE CLOSE (reason required): the amount is suggested pro-rata
//                 (reward × bought ÷ target) and can be edited, never above the reward.
// A deal ends in one CLAIM (the bill raised to the brand). Receipts (and write-offs) are set against claims.
//   outstanding = claim total − receipts − write-offs        ledger of a brand = claims − receipts − write-offs
// ─────────────────────────────────────────────────────────────────────────────
export const DEAL_TYPES = ["sponsorship", "target"];
export const EPS = 0.005;
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const isRealDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const dayMs = (s) => new Date(`${s}T00:00:00.000Z`).getTime();
const DAY = 24 * 3600 * 1000;
export const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / DAY);
export const todayKey = (now = new Date()) => now.toISOString().slice(0, 10);

/** Validate a deal body. Returns an error message, or null. */
export function validateDeal(d) {
  if (!DEAL_TYPES.includes(d.type)) return `Type must be one of: ${DEAL_TYPES.join(", ")}.`;
  if (!d.brandId) return "Choose a brand.";
  if (!String(d.title || "").trim()) return d.type === "sponsorship" ? "Enter the event name." : "Enter a name for the deal.";
  if (d.type === "sponsorship") {
    if (!isRealDate(d.eventDate)) return "Event date must be a real date (YYYY-MM-DD).";
    if (!(Number(d.agreedAmount) > 0)) return "Agreed amount must be above 0.";
  } else {
    if (!isRealDate(d.from) || !isRealDate(d.to)) return "From and to must be real dates (YYYY-MM-DD).";
    if (d.from > d.to) return "'From' must not be after 'to'.";
    const q = Number(d.targetQty);
    if (!Number.isInteger(q) || q <= 0) return "Target bottles must be a whole number above 0.";
    if (!(Number(d.rewardAmount) > 0)) return "Reward amount must be above 0.";
  }
  return null;
}

// letters and digits only, lower-cased — so "Jager Meister 700ml", "JAGERMEISTER" and "jagermeister" all compare alike
export const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Does a purchase line count for the deal? `ctx` = { names: Set of lower-cased product names, brandKey: norm(brand name), exactOnly }.
 * Exact product name always counts. Unless the deal was limited to chosen products (exactOnly), a line whose text CONTAINS the
 * brand name counts too, so "Jagermeister 700 ml Bottle" is found even if the master product is named differently.
 */
export function lineMatches(row, ctx) {
  const raw = String(row.alcoholName || "").trim().toLowerCase();
  if (ctx.names.has(raw)) return true;
  if (ctx.exactOnly) return false;
  return ctx.brandKey.length >= 3 && norm(raw).includes(ctx.brandKey);
}

const inWindow = (r, from, to) => { const day = new Date(r.date).toISOString().slice(0, 10); return day >= from && day <= to; };

/** Bottles of the brand bought in the window. rows = purchase lines { alcoholName, qty, date }. */
export function countBottles(rows, ctx, from, to) {
  let n = 0;
  for (const r of rows) if (inWindow(r, from, to) && lineMatches(r, ctx)) n += Number(r.qty) || 0;
  return Math.round(n * 1000) / 1000;
}

/** The window's alcohol lines split into those that counted and those that did not (so a missing bill can be spotted). */
export function splitLines(rows, ctx, from, to) {
  const matched = [], other = [];
  for (const r of rows) if (inWindow(r, from, to)) (lineMatches(r, ctx) ? matched : other).push(r);
  return { matched, other };
}

/** Where a target deal stands. */
export function targetProgress({ targetQty, boughtQty, from, to, today }) {
  const t = Number(targetQty), b = Number(boughtQty) || 0;
  const remaining = Math.max(0, Math.round((t - b) * 1000) / 1000);
  const met = b >= t;
  const state = met ? "met" : today < from ? "upcoming" : today <= to ? "running" : "ended-short";
  return {
    boughtQty: b, targetQty: t, remainingQty: remaining, pct: t > 0 ? Math.min(100, round2((b / t) * 100)) : 0,
    state, daysLeft: today <= to ? Math.max(0, daysBetween(today, to)) : 0,
  };
}

/** The amount to suggest for a claim. Target met → the full reward; short → pro-rata. */
export const suggestClaim = ({ rewardAmount, targetQty, boughtQty }) =>
  Number(boughtQty) >= Number(targetQty) ? round2(rewardAmount) : round2((Number(rewardAmount) * Number(boughtQty)) / Number(targetQty));

/** GST is optional: no percentage = no GST. */
export function claimTotals(amount, gstPercent) {
  const a = round2(amount), p = Number(gstPercent) > 0 ? Number(gstPercent) : 0;
  const gstAmount = round2((a * p) / 100);
  return { amount: a, gstPercent: p, gstAmount, totalAmount: round2(a + gstAmount) };
}

/** Receipts and write-offs of one claim. */
export function claimBalance(claim, receipts) {
  const mine = receipts.filter((r) => String(r.claimId) === String(claim._id));
  const received = round2(mine.filter((r) => r.type === "receipt").reduce((t, r) => t + r.amount, 0));
  const writtenOff = round2(mine.filter((r) => r.type === "writeoff").reduce((t, r) => t + r.amount, 0));
  const outstanding = round2(claim.totalAmount - received - writtenOff);
  return { received, writtenOff, outstanding, status: claim.status === "cancelled" ? "cancelled" : outstanding <= EPS ? "closed" : received + writtenOff > EPS ? "part-paid" : "open" };
}

/** The state of a deal for the dashboard. claim = its live (non-cancelled) claim or null. */
export function dealState(deal, { claim = null, balance = null, boughtQty = 0, today }) {
  if (deal.status === "cancelled") return { state: "cancelled" };
  if (claim) return { state: balance?.status === "closed" ? "closed" : "claimed" };
  if (deal.type === "sponsorship") return { state: today >= deal.eventDate ? "ready" : "upcoming" };
  const p = targetProgress({ targetQty: deal.targetQty, boughtQty, from: deal.from, to: deal.to, today });
  return { state: p.state === "met" ? "ready" : p.state, progress: p };
}

/** Why a claim cannot be raised, or null. `body` = { amount?, forced?, forceReason? }. Returns { amount, basis } when fine. */
export function planClaim(deal, { boughtQty = 0, body = {}, today }) {
  if (deal.status === "cancelled") return { error: "This deal was cancelled." };
  if (deal.type === "sponsorship") {
    if (today < deal.eventDate) return { error: "The event has not happened yet — bill it on or after the event date." };
    return { amount: round2(deal.agreedAmount), basis: "full" };
  }
  const met = Number(boughtQty) >= Number(deal.targetQty);
  if (met) return { amount: round2(deal.rewardAmount), basis: "full" };
  if (!body.forced) return { error: `Target not met — ${Math.round((deal.targetQty - boughtQty) * 1000) / 1000} bottle(s) short. Use Force close to bill what was bought.` };
  if (!String(body.forceReason || "").trim()) return { error: "A reason is required to force close a deal." };
  if (!(Number(boughtQty) > 0)) return { error: "Nothing was bought in this period, so there is nothing to bill." };
  const amount = body.amount === undefined || body.amount === null || body.amount === "" ? suggestClaim({ rewardAmount: deal.rewardAmount, targetQty: deal.targetQty, boughtQty }) : round2(body.amount);
  if (!(amount > 0)) return { error: "Amount must be above 0." };
  if (amount > deal.rewardAmount + EPS) return { error: `Amount cannot be more than the reward of ₹${deal.rewardAmount}.` };
  return { amount, basis: "forced" };
}

/** Ledger of one brand: opening (before `from`), claims, receipts, write-offs, outstanding — with a running balance. */
export function buildLedger(claims, receipts, from, to) {
  const live = claims.filter((c) => c.status !== "cancelled");
  const ids = new Set(live.map((c) => String(c._id)));
  const entries = [
    ...live.map((c) => ({ date: c.claimDate, kind: "claim", ref: c.claimNo, text: `${c.title}${c.invoiceNo ? ` · Bill ${c.invoiceNo}` : ""}`, debit: c.totalAmount, credit: 0, claimId: String(c._id), at: c.createdAt })),
    ...receipts.filter((r) => ids.has(String(r.claimId))).map((r) => ({ date: r.date, kind: r.type, ref: r.reference || "", text: r.type === "writeoff" ? `Written off${r.remark ? ` · ${r.remark}` : ""}` : `Received${r.mode ? ` · ${r.mode}` : ""}${r.remark ? ` · ${r.remark}` : ""}`, debit: 0, credit: r.amount, claimId: String(r.claimId), at: r.createdAt })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "claim" ? -1 : 1) || String(a.at).localeCompare(String(b.at)));
  let opening = 0;
  entries.forEach((e) => { if (e.date < from) opening += e.debit - e.credit; });
  opening = round2(opening);
  let running = opening;
  const inRange = entries.filter((e) => e.date >= from && e.date <= to).map((e) => { running = round2(running + e.debit - e.credit); return { ...e, balance: running }; });
  const sum = (k, f) => round2(inRange.filter((e) => e.kind === k).reduce((t, e) => t + f(e), 0));
  const claimed = sum("claim", (e) => e.debit), received = sum("receipt", (e) => e.credit), writtenOff = sum("writeoff", (e) => e.credit);
  return { opening, claimed, received, writtenOff, outstanding: round2(opening + claimed - received - writtenOff), entries: inRange };
}