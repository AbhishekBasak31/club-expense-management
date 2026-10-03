import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// ChecklistMaster — catalog of checklist NAMES + optional per-item
// norms (FSSAI compliance questions).
//
// NEW:  `norms[]` — an ordered list of compliance questions defined
//       at the MASTER level for this checklist item. Each norm has:
//         - text        : the question / norm description
//         - answerType  : "yes_no" | "document"
//           "yes_no"   → maker answers Yes / No on the management page
//           "document" → maker uploads a document for this specific norm
//       Norms are optional — checklist items that don't have FSSAI
//       requirements simply leave this array empty.
//
//       The `category` field now ships with a "FSSAI" preset
//       (alongside the existing "License" and "KYC") — enforced only
//       at the frontend level (PRESET_CATEGORIES constant); the field
//       itself is still a free-text string, so no migration is needed.
//
// NEW:  `createdByName` / `createdAt` — the master already gets
//       Mongoose timestamps (createdAt/updatedAt), and createdBy
//       already stores the userId ObjectId reference. The new
//       `createdByName` field stores the display name at creation time
//       so the Master listing can show it without a populate() join
//       on every list call (the same pattern as makerStamp.name on
//       the management side — denormalized for cheap display).
// ─────────────────────────────────────────────────────────────────

const NormSchema = new mongoose.Schema(
  {
    text       : { type: String, required: true, trim: true },
    answerType : { type: String, enum: ["yes_no", "document"], required: true },
    // Display order on the maker's form — auto-set to array index if
    // not supplied.
    order      : { type: Number, default: 0 },
  },
  { timestamps: false }
);

const ChecklistMasterSchema = new mongoose.Schema(
  {
    name     : { type: String, required: true, trim: true, unique: true },

    // Free-text — front end presets are "License", "KYC", "FSSAI"
    // (FSSAI added this version). Still not an enum — any string works.
    category : { type: String, trim: true, default: "" },

    // Compliance norms for this checklist item (optional, FSSAI-style).
    // Makers answer these on the Checklist Management page.
    norms    : { type: [NormSchema], default: [] },

    // Denormalized display name of the person who created this master
    // item — stored at write time so the listing page never needs
    // a populate() call.
    createdByName: { type: String, trim: true, default: "" },
    updatedByName: { type: String, trim: true, default: "" },

    isActive : { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ChecklistMasterSchema.index({ isActive : 1 });
ChecklistMasterSchema.index({ category : 1 });

export const ChecklistMaster = mongoose.model("ChecklistMaster", ChecklistMasterSchema);
export default ChecklistMaster;