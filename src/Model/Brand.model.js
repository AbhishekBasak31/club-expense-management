import mongoose from "mongoose";

const BrandSchema = new mongoose.Schema(
  {
    name        : { type: String, required: true, trim: true },
    brandCode   : { type: String, trim: true, default: "" },
    description : { type: String, trim: true, default: "" },
    manufacturer: { type: String, trim: true, default: "" }, // parent company / manufacturer, if different from brand name
    website     : { type: String, trim: true, default: "" },
    remarks     : { type: String, trim: true, default: "" },
    isActive    : { type: Boolean, default: true },
  },
  { timestamps: true }
);

BrandSchema.index({ name: 1 });
BrandSchema.index({ isActive: 1 });

export const Brand = mongoose.model("Brand", BrandSchema);
export default Brand;