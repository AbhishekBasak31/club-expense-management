import mongoose from "mongoose";

const UOMSchema = new mongoose.Schema(
  {
    name         : { type: String, required: true, trim: true },   // "Kilogram"
    abbreviation : { type: String, required: true, trim: true },   // "kg"
    isActive     : { type: Boolean, default: true },
  },
  { timestamps: true }
);

UOMSchema.index({ name: 1 });

export const UOM = mongoose.model("UOM", UOMSchema);
export default UOM;