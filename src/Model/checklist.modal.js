import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// Checklist (management data) — the operational fields for one
// checklist item: enrollment/validation dates, the responsible person,
// and the uploaded document. This collection no longer owns the
// checklist's NAME — that now lives in ChecklistMaster, and this
// document references it via checklistMasterId. Which rows exist on
// the Checklist Management page is entirely governed by ChecklistMaster
// (add/remove a checklist TYPE there); this collection only ever gets
// upserted (find-or-create-on-first-edit) by checklistMasterId — there
// is no standalone "create" or "delete" of a management row from the
// Management page itself, only from the cascade when a master item is
// deleted (see ChecklistMaster.controller.js).
//
// One management document per master item (1:1) — enforced by the
// unique index below AND by the controller always using
// findOneAndUpdate({checklistMasterId}, ..., {upsert:true}) rather than
// a plain create, so two management rows can never exist for the same
// checklist name.
//
// Status (Valid / Expiring Soon / Expired / Pending) is intentionally
// NOT stored here — it's derived from dateOfValidation + whether a
// document has been uploaded, computed at request time in the
// controller (see withStatus), the same way Employee.controller.js
// derives `age` from dateOfBirth rather than storing it. A stored
// status would silently go stale the moment a validation date passes
// without anyone re-saving the record.
// ─────────────────────────────────────────────────────────────────
const ChecklistSchema = new mongoose.Schema(
  {
    checklistMasterId: { type: mongoose.Schema.Types.ObjectId, ref: "ChecklistMaster", required: true, unique: true },

    // Not required at the schema level (unlike the old checklistName-
    // keyed version) — a management row can now come into existence via
    // upsert the moment the user fills in ANY single field, so none of
    // these can be mandatory up front the way they were when "create"
    // was an explicit, all-fields-at-once action.
    dateOfEnrollment : { type: Date, default: null },
    dateOfValidation : { type: Date, default: null },

    concernedPerson  : { type: String, trim: true, default: "" },
    email            : { type: String, trim: true, lowercase: true, default: "" },
    phoneNumber      : { type: String, trim: true, default: "" },

    // Populated once a file is uploaded via POST /:masterId/document.
    // documentPublicId is only set when Cloudinary storage is active
    // (see Utils/upload.js) — it's what a later delete/replace uses to
    // remove the old file from Cloudinary; it stays "" for local-disk
    // storage, where documentUrl alone is enough to locate the file.
    documentName     : { type: String, trim: true, default: "" },
    documentUrl      : { type: String, trim: true, default: "" },
    documentPublicId : { type: String, trim: true, default: "" },

    // Soft-delete — set false by the cascade when the owning
    // ChecklistMaster item is deleted. There is no direct user-facing
    // delete of a management row on its own.
    isActive         : { type: Boolean, default: true },

    createdBy        : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy        : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ChecklistSchema.index({ concernedPerson: 1 });
ChecklistSchema.index({ dateOfValidation: 1 });
ChecklistSchema.index({ isActive: 1 });

export const Checklist = mongoose.model("Checklist", ChecklistSchema);
export default Checklist;