import mongoose from "mongoose";

// ── Sub-schemas ──────────────────────────────────────────────────
const AddressSchema = new mongoose.Schema(
  {
    label     : { type: String, trim: true, default: "" }, // e.g. "Main Godown", "Warehouse 2"
    address   : { type: String, trim: true, default: "" },
    city      : { type: String, trim: true, default: "" },
    state     : { type: String, trim: true, default: "" },
    pincode   : { type: String, trim: true, default: "" },
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

    // ── Category (multiple — a vendor can sell more than one type of product) ──
    // vendorCategory kept as-is for backward compatibility with existing records
    // (holds the first/primary category); vendorCategories is the real list.
    vendorCategory  : { type: String, trim: true, default: "" },
    vendorCategories: { type: [String], default: [] },

    // ── Statutory / registration identifiers ──────────────────────
    gstNumber      : { type: String, trim: true, uppercase: true, default: "" }, // shown as "GSTIN/UIN" in UI
    panNo          : { type: String, trim: true, uppercase: true, default: "" },
    msmeNo         : { type: String, trim: true, default: "" },
    fssaiNo        : { type: String, trim: true, default: "" },
    cinNo          : { type: String, trim: true, uppercase: true, default: "" },

    // ── Address (broken into components) & contact (repeatable) ───
    // Primary/registered address — kept as discrete fields instead of one
    // free-text block, so city/state/pincode are queryable/reportable.
    address        : { type: String, trim: true, default: "" },
    city           : { type: String, trim: true, default: "" },
    state          : { type: String, trim: true, default: "" },
    pincode        : { type: String, trim: true, default: "" },
    addresses      : { type: [AddressSchema], default: [] }, // godown / additional addresses

    phone          : { type: String, trim: true, default: "" }, // default/primary phone
    phones         : { type: [String], default: [] },           // additional phone numbers

    email          : { type: String, lowercase: true, trim: true, default: "" }, // default/primary email
    emails         : { type: [String], default: [] },                            // additional emails

    // ── WhatsApp numbers (repeatable) ──────────────────────────────
    whatsappNumbers: { type: [String], default: [] },

    // ── Website URLs (repeatable) ──────────────────────────────────
    websiteUrls    : { type: [String], default: [] },

    // ── Social media handles (repeatable per platform) ─────────────
    facebookUrls   : { type: [String], default: [] },
    instagramUrls  : { type: [String], default: [] },
    twitterUrls    : { type: [String], default: [] },

    // ── Contact persons (repeatable, tabular) ──────────────────────
    contactPersons : { type: [ContactPersonSchema], default: [] },

    // ── Order details ───────────────────────────────────────────────
    orderEmail       : { type: String, lowercase: true, trim: true, default: "" },
    orderWhatsapp    : { type: String, trim: true, default: "" }, // order WhatsApp number

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
VendorSchema.index({ vendorCategories: 1 });

export const Vendor = mongoose.model("Vendor", VendorSchema);
export default Vendor;