import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// PartyQuery — a booking enquiry that moves through a fixed workflow:
//
//   pending ──accept──> accepted ──(advance paid)──> RFP generated
//     └──reject──> rejected [terminal — nothing else happens on this query]
//
//   RFP generated ──approve──> RFP approved ──send──> RFP shared [terminal]
//                └──reject──> back to "generated" (can be regenerated/
//                             resubmitted for approval — never a dead end,
//                             unlike the party-level reject above)
//
// The RFP itself lives EMBEDDED on the party query document (RfpSchema
// below), not as a separate collection — there is exactly one RFP per
// party query, it only ever exists in the context of that query, and
// nothing else ever references an RFP independently. A separate
// collection would just mean an extra unique-FK relationship to
// enforce for no real benefit.
//
// Beverage/food menu selections are stored as plain denormalized
// {category, subCategory, name} entries chosen at RFP-build time, not
// references into a separate menu-catalog collection — there is no
// menu master in this system yet (see MENU_PRESETS on the frontend for
// the starting list of selectable items); a party's RFP keeps whatever
// items were picked even if the preset list changes later.
// ─────────────────────────────────────────────────────────────────

const AdvanceSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: 0 },
    paymentType: { type: String, enum: ["cash", "card", "upi", "net_banking"], default: null },
  },
  { _id: false }
);

const MenuItemSchema = new mongoose.Schema(
  { name: { type: String, trim: true, required: true } },
  { _id: false }
);

const AlcoholItemSchema = new mongoose.Schema(
  { drinkType: { type: String, trim: true, required: true }, brand: { type: String, trim: true, required: true } },
  { _id: false }
);

const VegNonVegSchema = new mongoose.Schema(
  { veg: { type: [MenuItemSchema], default: [] }, nonVeg: { type: [MenuItemSchema], default: [] } },
  { _id: false }
);

const RfpSchema = new mongoose.Schema(
  {
    rfpNo: { type: String, trim: true, default: "" },
    kitchenTime: { type: String, trim: true, default: "" },
    date: { type: Date, default: null },
    day: { type: String, trim: true, default: "" },
    salesRepresentative: { type: String, trim: true, default: "" },
    typeOfFunction: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
    partyHostNameAddress: { type: String, trim: true, default: "" },
    billingInstruction: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    landlineNumber: { type: String, trim: true, default: "" },
    venueZone: { type: String, trim: true, default: "" },
    company: { type: String, trim: true, default: "" },
    mobile: { type: String, trim: true, default: "" },
    bookedBy: { type: String, trim: true, default: "" },
    guestList: { type: String, trim: true, default: "" },

    beverageMenu: {
      alcohols: { type: [AlcoholItemSchema], default: [] },
      cocktails: { type: [MenuItemSchema], default: [] },
      mocktails: { type: [MenuItemSchema], default: [] },
      softBeverages: { type: [MenuItemSchema], default: [] },
    },
    foodMenu: {
      sushi: { type: VegNonVegSchema, default: () => ({}) },
      starters: { type: VegNonVegSchema, default: () => ({}) },
      mainCourse: { type: VegNonVegSchema, default: () => ({}) },
      dessert: { type: [MenuItemSchema], default: [] },
    },

    generalInfo: {
      partyTiming: { type: String, trim: true, default: "" },
      guestArrival: { type: String, trim: true, default: "" },
      buffetTiming: { type: String, trim: true, default: "" },
      minimumGuarantee: { type: String, trim: true, default: "" },
      maximumExpected: { type: String, trim: true, default: "" },
      billingBy: { type: String, trim: true, default: "" },
      alcoholPackageRate: { type: String, trim: true, default: "" },
      foodPackageRate: { type: String, trim: true, default: "" },
      beveragePackageRate: { type: String, trim: true, default: "" },
      packageTime: { type: String, trim: true, default: "" },
      audio: { type: String, trim: true, default: "" },
      laptop: { type: Boolean, default: false },
      decoration: { type: String, trim: true, default: "" },
      cake: { type: String, trim: true, default: "" },
      flowerBouquet: { type: String, trim: true, default: "" },
      zoneReadyBy: { type: String, trim: true, default: "" },
      houseKeeping: { type: String, trim: true, default: "" },
      maintenance: { type: String, trim: true, default: "" },
      buffetSetUp: { type: String, trim: true, default: "" },
      seatingArrangement: { type: String, trim: true, default: "" },
    },

    acknowledgement: {
      guestSignatureDate: { type: String, trim: true, default: "" },
      managerSignatureDate: { type: String, trim: true, default: "" },
    },

    // RFP-level approval — separate from the party query's own
    // pending/accepted/rejected status above. approvedBy is required to
    // move rfpStatus from 'generated' to 'approved'.
    approvedBy: { type: String, trim: true, default: "" },

    generatedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    sharedAt: { type: Date, default: null },
  },
  { _id: false }
);

const PartyQuerySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    timeRangeStart: { type: String, trim: true, required: true },
    timeRangeEnd: { type: String, trim: true, required: true },

    name: { type: String, trim: true, required: true },
    email: { type: String, trim: true, lowercase: true, required: true },
    phone: { type: String, trim: true, required: true },

    pack: { type: String, trim: true, default: "" },
    packageBrochure: { type: String, trim: true, default: "" },
    remark: { type: String, trim: true, default: "" },
    rate: { type: Number, default: 0 },

    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
    concernPerson: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    advance: { type: AdvanceSchema, default: () => ({}) },

    rfpStatus: { type: String, enum: ["not_generated", "generated", "approved", "rejected", "shared"], default: "not_generated" },
    rfp: { type: RfpSchema, default: null },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

PartyQuerySchema.index({ date: 1 });
PartyQuerySchema.index({ status: 1 });
PartyQuerySchema.index({ rfpStatus: 1 });
PartyQuerySchema.index({ isActive: 1 });

export const PartyQuery = mongoose.model("PartyQuery", PartyQuerySchema);
export default PartyQuery;