import { PartyQuery } from "../Model/PartyQuery.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { sendRfpEmail } from "../Utils/Mailer.js";

// ─────────────────────────────────────────────────────────────────
// Workflow enforced here (not just implied by the frontend disabling
// buttons — every transition is re-checked server-side):
//
//   status: pending → accepted → rfp generated
//                   → rejected [terminal — every RFP action blocked]
//   (advance can be recorded any time after acceptance, but is optional
//   and no longer a precondition for generating an RFP)
//
//   rfpStatus: not_generated → generated ⇄ rejected (editable, can be
//              resubmitted) → approved → shared [terminal]
// ─────────────────────────────────────────────────────────────────

export const createPartyQuery = async (req, res) => {
  // No fields are mandated here anymore (relaxed on request, so bulk/Excel
  // import rows can be saved incomplete and filled in later via Edit — see
  // the matching change on the schema). The single "Add Party Query" form
  // still checks for these client-side before it ever calls this endpoint.
  //
  // status/finalValue/closedAt/paymentStatus are server-controlled — a new
  // query always starts pending/₹0/not-closed/payment-pending regardless
  // of what's in the request body.
  const { status, rfpStatus, finalValue, closedAt, paymentStatus, actual, alacarteAmount, discount, paidAmount, date, guestList, billing, paymentHistory, closeRemark, closeRating, cancelled, cancellationReason, cancellationAmount, refundAmount, ...safeBody } = req.body;

  // An empty/invalid date string must become null, not be handed straight
  // to Mongoose's Date cast — "" fails that cast even though `date` is no
  // longer a required field.
  const parsedDate = date ? new Date(date) : null;
  const cleanDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null;

  const doc = await PartyQuery.create({
    ...safeBody,
    date: cleanDate,
    status: "pending",
    rfpStatus: "not_generated",
    concernPerson: req.user?.userId ?? null,
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  return sendSuccess(res, doc, "Party query submitted.", 201);
};

// Query params: search, status, rfpStatus (all optional)
export const getPartyQueries = async (req, res) => {
  const { search, status, rfpStatus } = req.query;
  const filter = { isActive: true };
  if (status) filter.status = status;
  if (rfpStatus) filter.rfpStatus = rfpStatus;
  if (search) {
    const q = search.trim();
    filter.$or = [
      { name: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
      { phone: { $regex: q, $options: "i" } },
      { pack: { $regex: q, $options: "i" } },
    ];
  }

  const docs = await PartyQuery.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .populate("concernPerson", "name")
    .lean();
  return sendSuccess(res, docs);
};

export const getPartyQueryById = async (req, res) => {
  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true })
    .populate("concernPerson", "name")
    .lean();
  if (!doc) return sendError(res, "Party query not found.", 404);
  return sendSuccess(res, doc);
};

// Edits to the base query fields (date/time/client details/pack/rate/
// remark/occasion) — allowed any time before the party is rejected or
// closed (both are terminal from the base-edit form's point of view;
// status/finalValue/closedAt/paymentStatus each have their own
// dedicated endpoint below and are never touched here).
export const updatePartyQuery = async (req, res) => {
  const existing = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!existing) return sendError(res, "Party query not found.", 404);
  if (existing.status === "closed") return sendError(res, "This party query is closed and can no longer be edited.");

  const { status, rfpStatus, advance, rfp, concernPerson, finalValue, closedAt, paymentStatus, actual, alacarteAmount, discount, paidAmount, guestList, billing, paymentHistory, closeRemark, closeRating, cancelled, cancellationReason, cancellationAmount, refundAmount, ...safeBody } = req.body;
  const doc = await PartyQuery.findByIdAndUpdate(
    req.params.id,
    { $set: { ...safeBody, updatedBy: req.user?.userId ?? null } },
    { new: true, runValidators: true }
  ).populate("concernPerson", "name");
  return sendSuccess(res, doc, "Party query updated.");
};

// PUT /:id/status  { action: 'accept' | 'reject' }
// Only valid from 'pending'. Rejecting is terminal — the frontend hides
// every other action once status === 'rejected', and every other
// endpoint below re-checks status server-side too, so there's no way
// to advance a rejected query through the API either.
export const updatePartyQueryStatus = async (req, res) => {
  const { action } = req.body;
  if (!["accept", "reject"].includes(action)) return sendError(res, "action must be 'accept' or 'reject'.");

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.status !== "pending") return sendError(res, `This query is already ${doc.status} — status can't be changed again.`);

  doc.status = action === "accept" ? "accepted" : "rejected";
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, `Party query ${doc.status}.`);
};

// PUT /:id/advance  { amount, paymentType }
// Only valid once status === 'accepted'.
export const updateAdvance = async (req, res) => {
  const { amount, paymentType } = req.body;
  if (amount == null || Number(amount) <= 0) return sendError(res, "A valid advance amount is required.");
  if (!["cash", "card", "upi", "net_banking"].includes(paymentType)) return sendError(res, "A valid payment type is required.");

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.status !== "accepted") return sendError(res, "Advance can only be recorded for an accepted party query.");

  doc.advance = { amount: Number(amount), paymentType };
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "Advance payment recorded.");
};

// PUT /:id/rfp — create OR edit the RFP draft. Valid once status ===
// 'accepted'; valid at any point before rfpStatus === 'shared' (so a
// 'generated' or even 'rejected' draft can still be edited and
// resubmitted — only 'shared' is a hard stop, since the client has
// already received it by then). Advance payment is NOT required to
// create an RFP — in practice some parties never pay one; recording an
// advance (see updateAdvance above) stays available any time after
// acceptance but is no longer a precondition here. No field on the RFP
// itself is mandatory either — it can be saved as a partial draft and
// filled in over time.
export const saveRfp = async (req, res) => {
  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.status === "closed") return sendError(res, "This party query is closed and can no longer be edited.");
  if (doc.rfpStatus === "shared") return sendError(res, "This RFP has already been shared with the client and can no longer be edited.");

  const { approvedBy, generatedAt, approvedAt, sharedAt, ...safeRfpBody } = req.body;
  doc.rfp = { ...(doc.rfp?.toObject?.() ?? doc.rfp ?? {}), ...safeRfpBody };
  if (!doc.rfp.generatedAt) doc.rfp.generatedAt = new Date();
  // Any save — first draft or an edit after a rejection — puts the RFP
  // back in front of the approver; approvedBy from a previous round
  // doesn't carry over to a resubmitted draft.
  doc.rfp.approvedBy = "";
  doc.rfp.approvedAt = null;
  doc.rfpStatus = "generated";
  doc.updatedBy = req.user?.userId ?? null;
  // Belt-and-suspenders: force the whole rfp subdocument to be treated as
  // changed. Whole-path reassignment like above is normally tracked fine
  // on its own, but this guards against the well-known Mongoose class of
  // bugs where a nested object's change goes undetected and silently
  // fails to persist even though save() reports success.
  doc.markModified("rfp");
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "RFP saved.");
};

// PUT /:id/rfp/status  { action: 'approve' | 'reject', approvedBy? }
// Only valid from rfpStatus === 'generated'. Approving requires a name;
// rejecting sends it back to 'rejected' — still editable via saveRfp
// above, never a dead end the way the party-level reject is.
export const updateRfpStatus = async (req, res) => {
  const { action, approvedBy } = req.body;
  if (!["approve", "reject"].includes(action)) return sendError(res, "action must be 'approve' or 'reject'.");

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.rfpStatus !== "generated") return sendError(res, `The RFP must be in 'generated' status to be reviewed (currently: ${doc.rfpStatus}).`);

  if (action === "approve") {
    if (!approvedBy?.trim()) return sendError(res, "Approver name is required to approve an RFP.");
    doc.rfpStatus = "approved";
    doc.rfp.approvedBy = approvedBy.trim();
    doc.rfp.approvedAt = new Date();
  } else {
    doc.rfpStatus = "rejected";
  }
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, `RFP ${doc.rfpStatus}.`);
};

// POST /:id/rfp/send — only valid once rfpStatus === 'approved'. Emails
// the RFP to the client's address (the party query's own `email` field
// — not doc.rfp.email, which is a separate "contact email on the RFP
// document" field the sales rep fills in and may differ). On a real
// send failure, rfpStatus is left at 'approved', not advanced to
// 'shared' — a failed send must be visibly re-triable, not silently
// treated as done.
export const sendRfp = async (req, res) => {
  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.rfpStatus !== "approved") return sendError(res, `The RFP must be approved before it can be sent (currently: ${doc.rfpStatus}).`);

  const html = renderRfpEmailHtml(doc);
  const result = await sendRfpEmail({
    to: doc.email,
    partyName: doc.name,
    rfpNo: doc.rfp?.rfpNo,
    html,
  });
  if (!result.sent) return sendError(res, result.error || "Could not send the RFP email.");

  doc.rfpStatus = "shared";
  doc.rfp.sharedAt = new Date();
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "RFP sent to client.");
};

const GST_RATE = 0.18; // 18% GST, flat, on Tables 1-4 (Main/Alacarte/Photography/Decor)
const CLOUD_GST_RATE = 0.40; // Cloud (Table 5) is billed at 40% GST, not the standard 18%

// PUT /:id/guest-list  { guestList: [{ name, count, phone }] }
// Only valid once an RFP has actually been generated (rfpStatus !==
// 'not_generated') — this is the first step of the post-RFP cycle. The
// "+N" suffix convention (e.g. "Rahul +1" → count 2) is parsed on the
// frontend before this ever reaches here; this endpoint just stores
// whatever {name, count, phone} rows it's given. Replaces the whole list
// each call (not additive) — this is also how "Edit" resubmits after a
// correction.
export const saveGuestList = async (req, res) => {
  const { guestList } = req.body;
  if (!Array.isArray(guestList) || guestList.length === 0) return sendError(res, "At least one guest is required.");

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.rfpStatus === "not_generated") return sendError(res, "The RFP must be generated before the guest list can be captured.");

  const cleaned = guestList
    .filter(g => g?.name?.toString().trim())
    .map(g => ({
      name: g.name.toString().trim(),
      count: Number(g.count) > 0 ? Math.floor(Number(g.count)) : 1,
      phone: (g.phone || "").toString().trim(),
    }));
  if (cleaned.length === 0) return sendError(res, "At least one guest with a name is required.");

  doc.guestList = cleaned;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "Guest list saved.");
};

// PUT /:id/billing  { mg, actual, billingRate, alacarteAmount, photographyAmount, decorAmount, discount }
// Only valid once the guest list has been captured. Every GST amount and
// every *Total figure is ALWAYS server-recalculated at 18% flat — never
// trusted from the client, same principle used everywhere else in this
// file. finalPartyValue = grandTotal (sum of the 4 table totals) minus
// discount, floored at 0. Also keeps the legacy top-level
// actual/alacarteAmount/discount/finalValue fields in sync, purely so
// anything still reading those directly doesn't see stale data — the new
// UI reads from `billing` itself.
export const saveBilling = async (req, res) => {
  const {
    mg, actual, billingRate, alacarteAmount, photographyAmount, decorAmount, discount, cloudActualQty,
    mainGstEnabled, alacarteGstEnabled, photographyGstEnabled, decorGstEnabled, cloudGstEnabled,
    mainGstMode, alacarteGstMode, photographyGstMode, decorGstMode, cloudGstMode,
    mainGstManualAmount, alacarteGstManualAmount, photographyGstManualAmount, decorGstManualAmount, cloudGstManualAmount,
  } = req.body;

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.status === "closed") return sendError(res, "This party query is closed and can no longer be edited.");

  const mgN = Number(mg) || 0;
  const actualN = Number(actual) || 0;
  const rateN = Number(billingRate) || 0;
  const alacarteN = Number(alacarteAmount) || 0;
  const photoN = Number(photographyAmount) || 0;
  const decorN = Number(decorAmount) || 0;
  const discN = Number(discount) || 0;
  const cloudActualQtyN = Number(cloudActualQty) || 0;
  const mainGstManualN = Math.max(Number(mainGstManualAmount) || 0, 0);
  const alacarteGstManualN = Math.max(Number(alacarteGstManualAmount) || 0, 0);
  const photographyGstManualN = Math.max(Number(photographyGstManualAmount) || 0, 0);
  const decorGstManualN = Math.max(Number(decorGstManualAmount) || 0, 0);
  const cloudGstManualN = Math.max(Number(cloudGstManualAmount) || 0, 0);
  if ([mgN, actualN, rateN, alacarteN, photoN, decorN, discN, cloudActualQtyN].some(n => n < 0)) {
    return sendError(res, "None of the billing figures can be negative.");
  }
  // Each table's GST checkbox — GST is only computed (and included in that
  // table's total) when its flag is true; otherwise the GST amount is 0.
  const mainGstOn = mainGstEnabled !== false;
  const alacarteGstOn = alacarteGstEnabled !== false;
  const photographyGstOn = photographyGstEnabled !== false;
  const decorGstOn = decorGstEnabled !== false;
  const cloudGstOn = cloudGstEnabled !== false;

  // gstMode 'direct' uses the manually typed amount as-is instead of
  // computing it from the percentage rate — for whenever the % figure
  // doesn't match what actually needs to be billed for that table.
  const mainGstModeV = mainGstMode === "direct" ? "direct" : "percent";
  const alacarteGstModeV = alacarteGstMode === "direct" ? "direct" : "percent";
  const photographyGstModeV = photographyGstMode === "direct" ? "direct" : "percent";
  const decorGstModeV = decorGstMode === "direct" ? "direct" : "percent";
  const cloudGstModeV = cloudGstMode === "direct" ? "direct" : "percent";

  const mainAmount = actualN * rateN;
  const mainGst = !mainGstOn ? 0 : mainGstModeV === "direct" ? mainGstManualN : Math.round(mainAmount * GST_RATE);
  const mainTotal = mainAmount + mainGst;

  const alacarteGst = !alacarteGstOn ? 0 : alacarteGstModeV === "direct" ? alacarteGstManualN : Math.round(alacarteN * GST_RATE);
  const alacarteTotal = alacarteN + alacarteGst;

  const photographyGst = !photographyGstOn ? 0 : photographyGstModeV === "direct" ? photographyGstManualN : Math.round(photoN * GST_RATE);
  const photographyTotal = photoN + photographyGst;

  const decorGst = !decorGstOn ? 0 : decorGstModeV === "direct" ? decorGstManualN : Math.round(decorN * GST_RATE);
  const decorTotal = decorN + decorGst;

  // Cloud is priced off the RFP's own cloudPackage — compulsory qty and
  // per-unit price are NOT entered here, only Actual Qty is. The
  // compulsory qty is included in the package at no charge; only
  // whatever Actual Qty exceeds it is chargeable.
  const cloudCompulsoryQtyN = Number(doc.rfp?.cloudPackage?.compulsoryQty) || 0;
  const cloudUnitPriceN = Number(doc.rfp?.cloudPackage?.perUnitPrice) || 0;
  const cloudChargeableQty = Math.max(cloudActualQtyN - cloudCompulsoryQtyN, 0);
  const cloudAmount = cloudChargeableQty * cloudUnitPriceN;
  const cloudGst = !cloudGstOn ? 0 : cloudGstModeV === "direct" ? cloudGstManualN : Math.round(cloudAmount * CLOUD_GST_RATE);
  const cloudTotal = cloudAmount + cloudGst;

  const grandTotal = mainTotal + alacarteTotal + photographyTotal + decorTotal + cloudTotal;
  const finalPartyValue = Math.max(grandTotal - discN, 0);

  doc.billing = {
    mg: mgN, actual: actualN, billingRate: rateN, mainAmount,
    mainGstEnabled: mainGstOn, mainGstMode: mainGstModeV, mainGstManualAmount: mainGstManualN, mainGst, mainTotal,
    alacarteAmount: alacarteN, alacarteGstEnabled: alacarteGstOn, alacarteGstMode: alacarteGstModeV, alacarteGstManualAmount: alacarteGstManualN, alacarteGst, alacarteTotal,
    photographyAmount: photoN, photographyGstEnabled: photographyGstOn, photographyGstMode: photographyGstModeV, photographyGstManualAmount: photographyGstManualN, photographyGst, photographyTotal,
    decorAmount: decorN, decorGstEnabled: decorGstOn, decorGstMode: decorGstModeV, decorGstManualAmount: decorGstManualN, decorGst, decorTotal,
    cloudCompulsoryQty: cloudCompulsoryQtyN, cloudActualQty: cloudActualQtyN, cloudChargeableQty, cloudUnitPrice: cloudUnitPriceN,
    cloudAmount, cloudGstEnabled: cloudGstOn, cloudGstMode: cloudGstModeV, cloudGstManualAmount: cloudGstManualN, cloudGst, cloudTotal,
    grandTotal, discount: discN, finalPartyValue, savedAt: new Date(),
  };
  // Legacy mirrors — see comment above.
  doc.actual = actualN;
  doc.alacarteAmount = alacarteN;
  doc.discount = discN;
  doc.finalValue = finalPartyValue;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "Billing saved.");
};

// POST /:id/payment  { amount, method, kind: 'advance' | 'final', note?, date? }
// Appends one entry to the payment ledger — never edits or removes a
// past entry; a correction is a new entry, not a rewrite of history.
// A 'final' entry requires billing to already be saved (there's nothing
// to be "payable" against otherwise). After appending, paidAmount and
// paymentStatus are recomputed from the FULL ledger (advance + final
// entries together) — and, for backward compatibility with the older
// single-shot `advance` field/column, that field is kept mirroring the
// running total of just the 'advance'-kind entries.
export const addPaymentEntry = async (req, res) => {
  const { amount, method, kind, note, date } = req.body;
  const amt = Number(amount);
  if (!amt || amt <= 0) return sendError(res, "A valid payment amount is required.");
  if (!["cash", "card", "upi", "net_banking"].includes(method)) return sendError(res, "A valid payment method is required.");
  if (!["advance", "final"].includes(kind)) return sendError(res, "kind must be 'advance' or 'final'.");

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.status === "rejected") return sendError(res, "Payments can't be recorded on a rejected party query.");
  if (kind === "final" && !doc.billing?.finalPartyValue) return sendError(res, "Billing must be saved before recording the final payment.");

  doc.paymentHistory.push({
    date: date ? new Date(date) : new Date(),
    amount: amt, method, kind, note: (note || "").toString().trim(),
  });

  const advanceTotal = doc.paymentHistory.filter(p => p.kind === "advance").reduce((s, p) => s + p.amount, 0);
  const paidTotal = doc.paymentHistory.reduce((s, p) => s + p.amount, 0);
  doc.advance = { amount: advanceTotal, paymentType: method };
  doc.paidAmount = paidTotal;
  doc.paymentStatus = doc.billing?.finalPartyValue && paidTotal >= doc.billing.finalPartyValue ? "paid" : paidTotal > 0 ? "partial" : "pending";
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "Payment recorded.");
};

// PUT /:id/close  { remark }
// Only valid once status === 'accepted', rfpStatus === 'shared', AND
// billing has been saved (finalPartyValue > 0) — guest list and payment
// are expected to have happened by this point in the UI flow, but aren't
// re-validated here beyond billing; a party can be closed with a
// remaining due amount (dueAmount is just finalPartyValue − paidAmount,
// computed on read, not a close-time gate). Remark is the only field
// this step itself captures — everything financial was already captured
// by saveBilling/addPaymentEntry before this.
// PUT /:id/close  { remark, rating?, cancelled?, cancellationReason?, cancellationAmount? }
// Only requires status === 'accepted' (not already closed/rejected) — this
// is a "close this party out, whatever state it's in" action, not gated on
// the RFP having been shared or billing having been saved. The one
// exception: a NON-cancelled close still needs billing.finalPartyValue set,
// since that's the number Due/Paid are computed against — a cancelled
// close doesn't need that, because cancelling SETS finalPartyValue itself.
//
// Cancellation: cancellationAmount is the fee actually charged, always
// server-computed/clamped, never trusted as-is from the client. If no
// advance was ever collected there's nothing to charge a fee against, so
// the fee is forced to 0 regardless of what was submitted. Otherwise the
// fee is whatever was submitted (including 0, for the "waive it entirely"
// case) — refundAmount is simply whatever's left of the advance after
// that fee. finalPartyValue is overwritten to equal the fee, since that
// becomes this party's actual final value once cancelled.
export const closeCycle = async (req, res) => {
  const { remark, rating, cancelled, cancellationReason, cancellationAmount } = req.body;
  if (!remark?.toString().trim()) return sendError(res, "A closing remark is required.");
  const ratingN = rating == null || rating === '' ? 0 : Number(rating);
  if (isNaN(ratingN) || ratingN < 0 || ratingN > 5) return sendError(res, "Rating must be between 0 and 5.");

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.status !== "accepted") return sendError(res, `Only an accepted party query can be closed (currently: ${doc.status}).`);

  const isCancelled = !!cancelled;
  if (isCancelled) {
    if (!cancellationReason?.toString().trim()) return sendError(res, "A cancellation reason is required.");

    const advancePaid = (doc.paymentHistory || []).filter(p => p.kind === "advance").reduce((s, p) => s + p.amount, 0);
    const requestedFee = Math.max(Number(cancellationAmount) || 0, 0);
    const fee = advancePaid === 0 ? 0 : requestedFee; // nothing to charge against with no advance collected
    const refund = Math.max(advancePaid - fee, 0);

    doc.cancelled = true;
    doc.cancellationReason = cancellationReason.toString().trim();
    doc.cancellationAmount = fee;
    doc.refundAmount = refund;
    doc.billing.finalPartyValue = fee;
    doc.markModified("billing");
  } else {
    if (!doc.billing?.finalPartyValue) return sendError(res, "Billing must be saved (with a valid final party value) before closing.");
  }

  doc.status = "closed";
  doc.closedAt = new Date();
  doc.closeRemark = remark.toString().trim();
  doc.closeRating = ratingN;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, isCancelled ? "Party cancelled and closed." : "Party cycle closed.");
};

// PUT /:id/payment-status  { paymentStatus: 'pending' | 'partial' | 'paid', paymentAmount }
// Tracks the CLIENT's payment for the party — independent of the
// `advance` (booking deposit) and independent of the status workflow.
// Can be updated at any point except on a rejected query, since there's
// nothing left to collect payment for once a query is rejected.
// paymentAmount SETS the running total paid to date (it does not add to
// a previous value) — this call represents "as of now, this much has
// been paid in total", which the frontend uses to compute Due Amount
// (finalValue - paidAmount, floored at 0) once the party is closed.
export const updatePaymentStatus = async (req, res) => {
  const { paymentStatus, paymentAmount } = req.body;
  if (!["pending", "partial", "paid"].includes(paymentStatus)) return sendError(res, "paymentStatus must be 'pending', 'partial', or 'paid'.");
  const paid = Number(paymentAmount) || 0;
  if (paid < 0) return sendError(res, "Payment amount can't be negative.");

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.status === "rejected") return sendError(res, "Payment status can't be tracked on a rejected party query.");

  doc.paymentStatus = paymentStatus;
  doc.paidAmount = paid;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "Payment status updated.");
};

function renderRfpEmailHtml(doc) {
  const r = doc.rfp || {};
  return `
    <div style="font-family:sans-serif;max-width:600px">
      <h2>Event Proposal${r.rfpNo ? ` — ${r.rfpNo}` : ""}</h2>
      <p>Dear ${doc.name},</p>
      <p>Please find your event proposal details below.</p>
      <table cellpadding="6" style="border-collapse:collapse;width:100%">
        <tr><td><b>Date</b></td><td>${r.date ? new Date(r.date).toLocaleDateString() : ""}</td></tr>
        <tr><td><b>Kitchen time</b></td><td>${r.kitchenTime || ""}</td></tr>
        <tr><td><b>Type of function</b></td><td>${r.typeOfFunction || ""}</td></tr>
        <tr><td><b>Venue / Zone</b></td><td>${r.venueZone || ""}</td></tr>
        <tr><td><b>Booked by</b></td><td>${r.bookedBy || ""}</td></tr>
      </table>
      <p style="margin-top:16px">This proposal was approved by ${r.approvedBy || "our team"}. For any questions, please contact us directly.</p>
    </div>
  `;
}