import mongoose from "mongoose";

const TravelAllowanceSchema = new mongoose.Schema(
  {
    name     : { type: String, required: true, trim: true }, // e.g. "Local Conveyance", "Outstation — Sr. Staff"
    amount   : { type: Number, default: 0 },                   // default/standard allowance amount for this type
    isActive : { type: Boolean, default: true },
  },
  { timestamps: true }
);

TravelAllowanceSchema.index({ name: 1 });
TravelAllowanceSchema.index({ isActive: 1 });

export const TravelAllowance = mongoose.model("TravelAllowance", TravelAllowanceSchema);
export default TravelAllowance;