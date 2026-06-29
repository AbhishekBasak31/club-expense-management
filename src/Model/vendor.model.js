import mongoose from "mongoose";

const VendorSchema = new mongoose.Schema(
  {
    vendorCode     : { type: String, trim: true, default: "" },
    name           : { type: String, required: true, trim: true },
    vendorCategory : { type: String, trim: true, default: "" },
    phone          : { type: String, trim: true, default: "" },
    email          : { type: String, lowercase: true, trim: true, default: "" },
    address        : { type: String, trim: true, default: "" },
    gstNumber      : { type: String, trim: true, default: "" },
    creditDays     : { type: Number, default: 0 },
    bankDetails: {
      accountName   : { type: String, default: "" },
      accountNumber : { type: String, default: "" },
      ifsc          : { type: String, default: "" },
      bankName      : { type: String, default: "" },
    },
    openingBalance : { type: Number, default: 0 },
    isActive       : { type: Boolean, default: true },
  },
  { timestamps: true }
);

VendorSchema.index({ name: 1 });
VendorSchema.index({ isActive: 1 });

export const Vendor = mongoose.model("Vendor", VendorSchema);
export default Vendor;