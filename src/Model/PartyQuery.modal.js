import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// PartyQuery — a booking enquiry that moves through a fixed workflow:
//
//   pending ──accept──> accepted ──> RFP generated
//     └──reject──> rejected [terminal — nothing else happens on this query]
//   (advance can be recorded any time once accepted, but it's optional —
//   not every party pays one in practice, and it's no longer required
//   before an RFP can be generated)
//
//   RFP generated ──approve──> RFP approved ──send──> RFP shared
//                └──reject──> back to "generated" (can be regenerated/
//                             resubmitted for approval — never a dead end,
//                             unlike the party-level reject above)
//
//   RFP shared ──guest list──> billing──> payment(s)──> close (remark)──> closed [terminal]
//   (guest list, billing and payment are each their own step/endpoint —
//   closeCycle itself now only takes a remark; it requires billing to
//   already be filled in, but does not require the party to be fully
//   paid off — dueAmount can stay > 0 after closing)
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

// Each selected item is a snapshot of the Digital Menu item it came from
// (name/category/subCategory/dietaryType/price captured at selection
// time), plus the quantity chosen — not a live reference, so an RFP's
// printed menu stays exactly what was agreed even if the master item's
// price changes later. category/subCategory/dietaryType are what let
// Rfpdocview group a flat list back into the sections a real menu has
// (Sushi/Starters/Main Course split by Veg/Non-Veg, etc.) without this
// schema needing to hardcode which sub-categories exist — the real menu
// has 14+ of them under Food alone.
const SelectedRfpMenuItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalMenuItem", default: null },
    name: { type: String, trim: true, required: true },
    category: { type: String, trim: true, default: "" },
    subCategory: { type: String, trim: true, default: "" },
    dietaryType: { type: String, enum: ["", "Veg", "Non-Veg", "Veg / Non-Veg"], default: "" },
    price: { type: Number, default: 0, min: 0 },
    isCustomisable: { type: Boolean, default: false },
    qty: { type: Number, default: 1, min: 0 },
  },
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

    // Food tab = Digital Menu categories "Food" + "Zero A.B.V".
    // Beverage tab = everything else (Bar, Cocktail Chronicles, Aerated
    // Beverage, Energy Zone) — matching how the club's own menu itself
    // groups these two tabs, not an arbitrary split.
    selectedFoodItems: { type: [SelectedRfpMenuItemSchema], default: [] },
    selectedBeverageItems: { type: [SelectedRfpMenuItemSchema], default: [] },

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
    // Nothing below is mandatory at the schema level (relaxed on request,
    // for bulk/Excel import) — rows can be saved incomplete and filled in
    // later via Edit, rather than the whole row being rejected because one
    // field is missing. The single "Add Party Query" form on the frontend
    // still asks for these before submitting on its own — this only
    // affects bulk import and any other path that creates a query with
    // some fields blank.
    date: { type: Date, default: null },
    timeRangeStart: { type: String, trim: true, default: "" },
    timeRangeEnd: { type: String, trim: true, default: "" },

    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },

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

    // ── Guest List (captured after the RFP is generated/shared) ───────
    // "+N" suffix convention (handled on the frontend's Excel import,
    // not here): a name like "Rahul +1" means 1 guest brought along, so
    // count = N + 1. A bare name with no "+N" is count 1.
    guestList: {
      type: [
        {
          name: { type: String, trim: true, required: true },
          count: { type: Number, default: 1, min: 1 },
          phone: { type: String, trim: true, default: "" },
        },
      ],
      default: [],
    },

    // ── Billing (4-table breakdown, filled in after the guest list) ───
    // Every *Total/*Gst field here is ALWAYS server-recalculated from its
    // own amount — never trusted from the client, same principle used
    // everywhere else in this file (closeCycle, PLStatement, etc.).
    // finalPartyValue = grandTotal (sum of the 4 table totals) − discount.
    // discount is entered against the alacarte line specifically (per
    // how the venue itemizes it), but arithmetically it's just subtracted
    // from the overall sum to reach the final figure.
    billing: {
      mg: { type: Number, default: 0, min: 0 },
      actual: { type: Number, default: 0, min: 0 },
      billingRate: { type: Number, default: 0, min: 0 },
      mainAmount: { type: Number, default: 0, min: 0 }, // actual * billingRate
      mainGstEnabled: { type: Boolean, default: true },
      mainGst: { type: Number, default: 0, min: 0 }, // 0 whenever mainGstEnabled is false
      mainTotal: { type: Number, default: 0, min: 0 }, // mainAmount + mainGst

      alacarteAmount: { type: Number, default: 0, min: 0 },
      alacarteGstEnabled: { type: Boolean, default: true },
      alacarteGst: { type: Number, default: 0, min: 0 },
      alacarteTotal: { type: Number, default: 0, min: 0 },

      photographyAmount: { type: Number, default: 0, min: 0 },
      photographyGstEnabled: { type: Boolean, default: true },
      photographyGst: { type: Number, default: 0, min: 0 },
      photographyTotal: { type: Number, default: 0, min: 0 },

      decorAmount: { type: Number, default: 0, min: 0 },
      decorGstEnabled: { type: Boolean, default: true },
      decorGst: { type: Number, default: 0, min: 0 },
      decorTotal: { type: Number, default: 0, min: 0 },

      // Cloud — priced off the RFP's cloudPackage (compulsory qty + per-
      // unit price), not typed directly. Only the amount BEYOND the
      // compulsory qty is chargeable: cloudChargeableQty = max(actualQty
      // - compulsoryQty, 0), cloudAmount = cloudChargeableQty * per-unit
      // price. All server-recalculated on save — see saveBilling.
      cloudCompulsoryQty: { type: Number, default: 0, min: 0 },
      cloudActualQty: { type: Number, default: 0, min: 0 },
      cloudChargeableQty: { type: Number, default: 0, min: 0 },
      cloudUnitPrice: { type: Number, default: 0, min: 0 },
      cloudAmount: { type: Number, default: 0, min: 0 },
      cloudGstEnabled: { type: Boolean, default: true },
      cloudGst: { type: Number, default: 0, min: 0 },
      cloudTotal: { type: Number, default: 0, min: 0 },

      grandTotal: { type: Number, default: 0, min: 0 }, // sum of the 5 *Total fields, before discount
      discount: { type: Number, default: 0, min: 0 },
      finalPartyValue: { type: Number, default: 0, min: 0 }, // grandTotal − discount, floored at 0
      savedAt: { type: Date, default: null },
    },

    // ── Payment ledger ──────────────────────────────────────────────────
    // Every transaction — every advance instalment AND the final
    // settlement payment — lives here in order, so a full timeline can be
    // rendered (per party or advance-only) and any single entry can
    // produce its own receipt. Entries are never edited or removed once
    // added; a correction is a new entry, not a rewrite of history.
    paymentHistory: {
      type: [
        {
          date: { type: Date, default: Date.now },
          amount: { type: Number, required: true, min: 0 },
          method: { type: String, enum: ["cash", "card", "upi", "net_banking"], default: "cash" },
          kind: { type: String, enum: ["advance", "final"], default: "advance" },
          note: { type: String, trim: true, default: "" },
        },
      ],
      default: [],
    },

    // Remark captured on the dedicated close step — the only field that
    // step takes; everything else needed to close (billing, payment) was
    // already captured by the steps before it.
    closeRemark: { type: String, trim: true, default: "" },
    closeRating: { type: Number, default: 0, min: 0, max: 5 },

    // ── Cancellation (an alternate outcome of closeCycle) ────────────────
    // cancellationAmount is the fee actually charged; refundAmount is
    // whatever's left of the advance after that fee — both always
    // server-computed at close time, never trusted from the client.
    // finalPartyValue itself is overwritten to equal cancellationAmount
    // when a party is cancelled — see closeCycle.
    cancelled: { type: Boolean, default: false },
    cancellationReason: { type: String, trim: true, default: "" },
    cancellationAmount: { type: Number, default: 0, min: 0 },
    refundAmount: { type: Number, default: 0, min: 0 },

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