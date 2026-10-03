import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// Checklist — management data + maker/checker workflow.
//
// WORKFLOW (per item):
//   1. Maker fills in operational fields (dates, concerned person)
//      AND answers each norm-question (Yes/No or document upload).
//   2. On submit, a "Maker Confirm" modal auto-opens: maker types
//      their name, timestamp is captured, workflowStatus → "under_review".
//   3. Checker sees the item on their dashboard, opens a read-only
//      view, verifies each answer, ticks the confirmation checkbox,
//      types their name — timestamp is captured automatically.
//      workflowStatus → "completed".
//
// checklistNorms: stores per-item answers keyed by normId (from
//   ChecklistMaster.norms[]). Each answer is either:
//     { type: "yes_no", value: "yes"|"no" }
//     { type: "document", documentName, documentUrl, documentPublicId }
//   A norm that hasn't been answered yet has no key in this map.
//
// Status derivation (existing logic, unchanged):
//   valid / expiring_soon / expired / pending — from dateOfValidation
//   + whether a document has been uploaded. Stored separately from
//   workflowStatus (the 4-state validation status and the 3-state
//   maker/checker status are orthogonal concepts).
// ─────────────────────────────────────────────────────────────────

const NormAnswerSchema = new mongoose.Schema(
  {
    normId   : { type: mongoose.Schema.Types.ObjectId, required: true },
    normText : { type: String, required: true },          // snapshot at answer time
    answerType: { type: String, enum: ["yes_no", "document"], required: true },
    // yes_no answer
    yesNoValue      : { type: String, enum: ["yes", "no", ""], default: "" },
    // document answer
    documentName    : { type: String, default: "" },
    documentUrl     : { type: String, default: "" },
    documentPublicId: { type: String, default: "" },
  },
  { _id: false }
);

const MakerStampSchema = new mongoose.Schema(
  {
    name      : { type: String, trim: true, default: "" },
    timestamp : { type: Date, default: null },
    // Which action the maker took: "submitted" (fields + norms answered
    // and submitted for review) or "document" (uploaded the primary doc)
    action    : { type: String, enum: ["submitted", "document", ""], default: "" },
  },
  { _id: false }
);

const CheckerStampSchema = new mongoose.Schema(
  {
    name      : { type: String, trim: true, default: "" },
    timestamp : { type: Date, default: null },
    verified  : { type: Boolean, default: false },
  },
  { _id: false }
);

const ChecklistSchema = new mongoose.Schema(
  {
    checklistMasterId: {
      type    : mongoose.Schema.Types.ObjectId,
      ref     : "ChecklistMaster",
      required: true,
      unique  : true,
    },

    // ── Operational fields (unchanged from v1) ──────────────────────
    dateOfEnrollment : { type: Date,   default: null },
    dateOfValidation : { type: Date,   default: null },
    concernedPerson  : { type: String, trim: true, default: "" },
    email            : { type: String, trim: true, lowercase: true, default: "" },
    phoneNumber      : { type: String, trim: true, default: "" },

    // Primary document (unchanged from v1)
    documentName     : { type: String, trim: true, default: "" },
    documentUrl      : { type: String, trim: true, default: "" },
    documentPublicId : { type: String, trim: true, default: "" },

    // ── FSSAI / norm answers ────────────────────────────────────────
    // One entry per answered norm (norms themselves live in
    // ChecklistMaster.norms[]). Unanswered norms are simply absent.
    normAnswers: { type: [NormAnswerSchema], default: [] },

    // ── Maker/Checker workflow ──────────────────────────────────────
    // "draft"        → maker is editing, nothing submitted yet
    // "under_review" → maker submitted; waiting for checker
    // "completed"    → checker verified
    workflowStatus: {
      type   : String,
      enum   : ["draft", "under_review", "completed"],
      default: "draft",
    },
    makerStamp : { type: MakerStampSchema,  default: () => ({}) },
    checkerStamp: { type: CheckerStampSchema, default: () => ({}) },

    isActive : { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ChecklistSchema.index({ concernedPerson   : 1 });
ChecklistSchema.index({ dateOfValidation  : 1 });
ChecklistSchema.index({ isActive          : 1 });
ChecklistSchema.index({ workflowStatus    : 1 });

export const Checklist = mongoose.model("Checklist", ChecklistSchema);
export default Checklist;