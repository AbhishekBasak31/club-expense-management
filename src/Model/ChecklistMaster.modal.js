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
    isActive : { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ChecklistMasterSchema.index({ isActive: 1 });

export const ChecklistMaster = mongoose.model("ChecklistMaster", ChecklistMasterSchema);
export default ChecklistMaster;