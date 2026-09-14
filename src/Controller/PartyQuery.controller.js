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
  const { status, rfpStatus, finalValue, closedAt, paymentStatus, actual, alacarteAmount, discount, paidAmount, date, ...safeBody } = req.body;

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
  if (existing.status === "rejected") return sendError(res, "This party query was rejected and can no longer be edited.");
  if (existing.status === "closed") return sendError(res, "This party query is closed and can no longer be edited.");

  const { status, rfpStatus, advance, rfp, concernPerson, finalValue, closedAt, paymentStatus, actual, alacarteAmount, discount, paidAmount, ...safeBody } = req.body;
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
  if (doc.status !== "accepted") return sendError(res, "The party query must be accepted before an RFP can be created.");
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

// PUT /:id/close  { actual, alacarteAmount, discount }
// Only valid once status === 'accepted' AND rfpStatus === 'shared' — i.e.
// the full booking → RFP → send-to-client cycle has actually completed.
// Grand Total (actual * rate + alacarteAmount) isn't stored — it's cheap
// to recompute from actual/alacarteAmount wherever it's needed (same as
// Budget already is). finalValue IS stored, as Grand Total - discount,
// floored at 0 — and it's ALWAYS server-recalculated from these three
// inputs, never trusted from the client, same principle already used for
// PLStatement's gstAmount/finalAmount. Setting these and flipping status
// to 'closed' happen together as one action — there's no separate "set
// final value" step. 'closed' is terminal: updatePartyQuery above already
// refuses to edit a closed query, and every other action's own
// status/rfpStatus check naturally disables itself once status is no
// longer 'accepted'.
export const closeCycle = async (req, res) => {
  const { actual, alacarteAmount, discount } = req.body;
  if (actual == null || Number(actual) <= 0) return sendError(res, "A valid actual guest count is required.");
  const alacarte = Number(alacarteAmount) || 0;
  if (alacarte < 0) return sendError(res, "Alacarte amount can't be negative.");
  const disc = Number(discount) || 0;
  if (disc < 0) return sendError(res, "Discount can't be negative.");

  const doc = await PartyQuery.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Party query not found.", 404);
  if (doc.status !== "accepted") return sendError(res, `Only an accepted party query can be closed (currently: ${doc.status}).`);
  if (doc.rfpStatus !== "shared") return sendError(res, `The RFP must be shared with the client before the cycle can be closed (currently: ${doc.rfpStatus}).`);
  if (!doc.rate) return sendError(res, "This party query has no Rate set, so Total (Actual × Rate) can't be calculated — set a Rate via Edit first.");

  const grandTotal = (Number(actual) * doc.rate) + alacarte; // Total + Alacarte
  doc.actual = Number(actual);
  doc.alacarteAmount = alacarte;
  doc.discount = disc;
  doc.finalValue = Math.max(grandTotal - disc, 0);
  doc.status = "closed";
  doc.closedAt = new Date();
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "Party cycle closed.");
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