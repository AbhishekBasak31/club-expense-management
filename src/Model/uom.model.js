import mongoose from "mongoose";
import { UOM_TYPES, validateUomShape } from "../Utils/Uom.resolver.js";

const UOMSchema = new mongoose.Schema(
  {
    name         : { type: String, required: true, trim: true },   // "Kilogram"
    abbreviation : { type: String, required: true, trim: true },   // "kg"

    // Measurement family. "" = not classified yet (records created before this
    // field existed) — they keep working and are classified from the UOM page.
    //   volume | weight → carry a base amount;  count | length → do not.
    type         : { type: String, enum: ["", ...UOM_TYPES], default: "" },

    // volume → millilitres in 1 of this unit (ML = 1, Litre = 1000, Peg = 30)
    // weight → grams in 1 of this unit        (Gram = 1, Kilogram = 1000)
    // count / length / unclassified → null
    baseFactor   : {
      type     : Number,
      default  : null,
      min      : 0,
      // Safety net behind the controller's own check (type ↔ base amount must agree).
      validate : {
        validator: function (v) { return !validateUomShape({ type: this.type, baseFactor: v }); },
        message  : "Base amount does not match the unit type.",
      },
    },

    isActive     : { type: Boolean, default: true },
    createdBy    : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy    : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

UOMSchema.index({ name: 1 });
// Case-insensitive, among ACTIVE units only — "ML", "ml" and "Ml" can't coexist,
// but a deactivated unit never blocks a new one. (The controller checks the same
// thing first, so a clear message is returned even before this index exists —
// building it can fail if old duplicates are already in the data.)
UOMSchema.index({ name: 1 }, { name: "uniq_active_uom_name_ci", unique: true, collation: { locale: "en", strength: 2 }, partialFilterExpression: { isActive: true } });
UOMSchema.index({ abbreviation: 1 }, { name: "uniq_active_uom_abbr_ci", unique: true, collation: { locale: "en", strength: 2 }, partialFilterExpression: { isActive: true } });

export const UOM = mongoose.model("UOM", UOMSchema);
export default UOM;