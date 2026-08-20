import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// Checklist — recurring compliance documents (licenses, certificates,
// contracts) with a responsible person and a validation/expiry date,
// so nothing lapses unnoticed. Status (Valid / Expiring Soon / Expired
// / Pending) is intentionally NOT stored here — it's derived from
// dateOfValidation + whether a document has been uploaded, computed at
// request time in the controller (see withStatus below), the same way
// Employee.controller.js derives `age` from dateOfBirth rather than
// storing it. A stored status would silently go stale the moment a
// validation date passes without anyone re-saving the record.
// ─────────────────────────────────────────────────────────────────
const ChecklistSchema = new mongoose.Schema(
  {
    checklistName    : { type: String, required: true, trim: true },
    dateOfEnrollment : { type: Date, default: null },
    dateOfValidation : { type: Date, required: true },

    concernedPerson  : { type: String, required: true, trim: true },
    email            : { type: String, trim: true, lowercase: true, default: "" },
    phoneNumber      : { type: String, trim: true, default: "" },

    // Populated once a file is uploaded via POST /:id/document.
    // documentPublicId is only set when Cloudinary storage is active
    // (see Utils/upload.js) — it's what a later delete/replace uses to
    // remove the old file from Cloudinary; it stays null for local-disk
    // storage, where documentUrl alone is enough to locate the file.
    documentName     : { type: String, trim: true, default: "" },
    documentUrl      : { type: String, trim: true, default: "" },
    documentPublicId : { type: String, trim: true, default: "" },

    // Soft-delete, matching Employee's isActive convention — compliance
    // documents are exactly the kind of record where losing history on
    // delete (rather than just hiding it) is the wrong default.
    isActive         : { type: Boolean, default: true },

    createdBy        : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy        : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ChecklistSchema.index({ checklistName: 1 });
ChecklistSchema.index({ concernedPerson: 1 });
ChecklistSchema.index({ dateOfValidation: 1 });
ChecklistSchema.index({ isActive: 1 });

export const Checklist = mongoose.model("Checklist", ChecklistSchema);
export default Checklist;