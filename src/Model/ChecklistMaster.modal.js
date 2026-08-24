import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// ChecklistMaster — the catalog of checklist NAMES only (e.g. "Fire
// Safety Certificate", "FSSAI License"). This is the source of truth
// for which checklist rows exist at all; the Checklist Management page
// no longer creates or deletes rows itself — it only fills in the
// operational fields (dates, concerned person, document, etc.) for
// whichever names exist here. See checklist.modal.js for the other
// half of this split.
// ─────────────────────────────────────────────────────────────────
const ChecklistMasterSchema = new mongoose.Schema(
  {
    name     : { type: String, required: true, trim: true, unique: true },
    // Free-text tag, not a fixed enum — 'License' and 'KYC' are the two
    // starting presets offered on the frontend's Add form, but the field
    // itself accepts any string so new categories can be introduced from
    // the UI at any time without a schema change or a separate category-
    // master collection. Empty string means "uncategorised" — not every
    // checklist item needs to be tagged as one of these.
    category : { type: String, trim: true, default: "" },
    isActive : { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ChecklistMasterSchema.index({ isActive: 1 });
ChecklistMasterSchema.index({ category: 1 });

export const ChecklistMaster = mongoose.model("ChecklistMaster", ChecklistMasterSchema);
export default ChecklistMaster;