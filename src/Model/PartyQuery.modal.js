import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// PartyQuery — a booking enquiry that moves through a fixed workflow:
//
//   pending ──accept──> accepted ──(advance paid)──> RFP generated
//     └──reject──> rejected [terminal — nothing else happens on this query]
//
//   RFP generated ──approve──> RFP approved ──send──> RFP shared
//                └──reject──> back to "generated" (can be regenerated/
//                             resubmitted for approval — never a dead end,
//                             unlike the party-level reject above)
//
//   RFP shared ──close cycle (final value recorded)──> closed [terminal]
//
// paymentStatus (pending/partial/paid) tracks the client's own payment
// for the party — separate from `advance` (the booking deposit) and
// from the status workflow above — and can be updated independently at
// any point the party isn't rejected.
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
  {
    name: { type: String, trim: true, required: true },
    // How much of this item is expected to be consumed at the party —
    // set when the RFP is built, so the new Party Alcohol Consumption
    // page can show "Expected" alongside "Actual" without guessing.
    // Not required (defaults to 0) since it wasn't captured on RFPs
    // created before this field existed — those just show 0 expected
    // until someone edits the RFP and fills it in.
    expectedQty: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const AlcoholItemSchema = new mongoose.Schema(
  {
    drinkType: { type: String, trim: true, required: true },
    brand: { type: String, trim: true, required: true },
    expectedQty: { type: Number, default: 0, min: 0 },
  },
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
    partyHostName: { type: String, trim: true, default: "" },
    partyHostAddress: { type: String, trim: true, default: "" },
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
      // Package rates — NUMBERS, not free text. Previously these were
      // plain strings (matching examples like "4000++" seen in a
      // reference document), but that made them impossible to reliably
      // sum into a real "Expected Sell" figure for the new Party
      // Alcohol Consumption page. If a rate genuinely needs a "++"-style
      // qualifier noted, that belongs in `note` above, not baked into
      // a number field that other features now depend on being clean.
      alcoholPackageRate: { type: Number, default: 0, min: 0 },
      foodPackageRate: { type: Number, default: 0, min: 0 },
      beveragePackageRate: { type: Number, default: 0, min: 0 },
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
    occasion: { type: String, trim: true, default: "" },
    packageBrochure: { type: String, trim: true, default: "" },
    remark: { type: String, trim: true, default: "" },
    rate: { type: Number, default: 0 },

    // 'closed' is reached only via the dedicated close-cycle endpoint,
    // once rfpStatus === 'shared' — never set directly through the
    // generic update endpoint. finalValue/closedAt are only ever
    // populated by that same endpoint.
    status: { type: String, enum: ["pending", "accepted", "rejected", "closed"], default: "pending" },
    // Set together, only by closeCycle in the controller: actual (guest
    // headcount who attended), alacarteAmount, and discount are the real
    // inputs; finalValue is always server-recalculated from
    // (actual * rate + alacarteAmount) - discount — never trusted from
    // the client, same principle already used for PLStatement's
    // gstAmount/finalAmount. Grand Total itself (actual*rate+alacarteAmount,
    // pre-discount) isn't stored separately — it's cheap to recompute from
    // these same three fields wherever it's needed, same as Budget already is.
    actual: { type: Number, default: 0, min: 0 },
    alacarteAmount: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    finalValue: { type: Number, default: 0, min: 0 },
    closedAt: { type: Date, default: null },

    concernPerson: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    advance: { type: AdvanceSchema, default: () => ({}) },

    // Tracks the client's own payment for the party (separate from the
    // advance, which is just the booking deposit) — updated independently
    // via its own endpoint, any time the party isn't rejected. paidAmount
    // is set together with paymentStatus by that same endpoint; due amount
    // (finalValue - paidAmount, floored at 0) is computed on read, never stored.
    paymentStatus: { type: String, enum: ["pending", "partial", "paid"], default: "pending" },
    paidAmount: { type: Number, default: 0, min: 0 },

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
PartyQuerySchema.index({ paymentStatus: 1 });
PartyQuerySchema.index({ isActive: 1 });

export const PartyQuery = mongoose.model("PartyQuery", PartyQuerySchema);
export default PartyQuery;