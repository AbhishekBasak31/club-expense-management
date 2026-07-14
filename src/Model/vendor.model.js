import mongoose from "mongoose";

// ── Sub-schemas ──────────────────────────────────────────────────
const AddressSchema = new mongoose.Schema(
  {
    label     : { type: String, trim: true, default: "" }, // e.g. "Main Godown", "Warehouse 2"
    address   : { type: String, trim: true, default: "" },
    isDefault : { type: Boolean, default: false },
  },
  { _id: true }
);

const ContactPersonSchema = new mongoose.Schema(
  {
    name        : { type: String, trim: true, default: "" },
    designation : { type: String, trim: true, default: "" },
    phone       : { type: String, trim: true, default: "" },
    email       : { type: String, lowercase: true, trim: true, default: "" },
    isPrimary   : { type: Boolean, default: false },
  },
  { _id: true }
);

const VendorSchema = new mongoose.Schema(
  {
    vendorCode     : { type: String, trim: true, default: "" },
    name           : { type: String, required: true, trim: true },
    vendorCategory : { type: String, trim: true, default: "" },

    // ── Statutory / registration identifiers ──────────────────────
    gstNumber      : { type: String, trim: true, uppercase: true, default: "" }, // shown as "GSTIN/UIN" in UI
    panNo          : { type: String, trim: true, uppercase: true, default: "" },
    msmeNo         : { type: String, trim: true, default: "" },
    fssaiNo        : { type: String, trim: true, default: "" },
    cinNo          : { type: String, trim: true, uppercase: true, default: "" },

    // ── Address & contact (repeatable) ─────────────────────────────
    // Primary/registered address kept as a plain string for backward compatibility
    // with existing records; `addresses` holds any additional / godown addresses.
    address        : { type: String, trim: true, default: "" },
    addresses      : { type: [AddressSchema], default: [] }, // godown / additional addresses

    phone          : { type: String, trim: true, default: "" }, // default/primary phone
    phones         : { type: [String], default: [] },           // additional phone numbers

    email          : { type: String, lowercase: true, trim: true, default: "" }, // default/primary email
    emails         : { type: [String], default: [] },                            // additional emails

    // ── Contact persons (repeatable, tabular) ──────────────────────
    contactPersons : { type: [ContactPersonSchema], default: [] },

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
VendorSchema.index({ gstNumber: 1 });

export const Vendor = mongoose.model("Vendor", VendorSchema);
export default Vendor;