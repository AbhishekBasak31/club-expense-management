import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// ORGANIZATION MODEL
// The root of the multi-tenant system.
// Every user, role, vendor, expense — everything is scoped to an org.
// One organization = one club / restaurant / pub / hotel.
// ─────────────────────────────────────────────────────────────────
const OrganizationSchema = new mongoose.Schema(
  {
    name : { type: String, required: true, trim: true },
    // e.g. "The Grand Club"

    type : {
      type     : String,
      enum     : ["club", "restaurant", "pub", "hotel", "other"],
      default  : "club",
    },

    // ── Optional business details ────────────────────────────────
    email       : { type: String, lowercase: true, trim: true, default: "" },
    phone       : { type: String, trim: true, default: "" },
    address     : { type: String, trim: true, default: "" },
    gstNumber   : { type: String, trim: true, default: "" },
    logoUrl     : { type: String, default: "" },

    // ── Subscription / plan (for future billing) ────────────────
    plan : {
      type    : String,
      enum    : ["free", "pro", "enterprise"],
      default : "free",
    },

    // ── The superadmin who owns this org ─────────────────────────
    // Set right after the owner user is created during registration
    ownerId : {
      type    : mongoose.Schema.Types.ObjectId,
      ref     : "User",
      default : null,
    },

    isActive : { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Organization = mongoose.model("Organization", OrganizationSchema);
export default Organization;