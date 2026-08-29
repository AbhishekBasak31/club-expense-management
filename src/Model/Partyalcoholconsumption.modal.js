import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// PartyAlcoholConsumption — post-event tracking for a party that
// already happened: what was expected to be sold/consumed (per the
// party's RFP) versus what actually was. One record per PartyQuery,
// created by selecting its RFP — everything except actualSell is
// snapshotted from the party/RFP at that moment (date, time, host,
// brochure, expected sell, expected quantities per item). Snapshotting
// matters here for the same reason it does elsewhere in this app: this
// is a historical record of what was actually promised for THIS party,
// and must stay accurate even if the RFP is edited or the menu presets
// change afterward.
//
// actualQty per item — and only that — is filled in later via the
// "Party Consume" action, kept as a separate update path from the rest
// of the record so accidentally editing one thing can't silently touch
// the historical expected figures.
// ─────────────────────────────────────────────────────────────────

const ConsumptionItemSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true },
    expectedQty: { type: Number, default: 0, min: 0 }, // snapshotted from the RFP, immutable after creation
    actualQty: { type: Number, default: 0, min: 0 },    // filled in via the "Party Consume" modal
  },
  { _id: false }
);

const AlcoholConsumptionItemSchema = new mongoose.Schema(
  {
    drinkType: { type: String, trim: true, required: true },
    brand: { type: String, trim: true, required: true },
    expectedQty: { type: Number, default: 0, min: 0 },
    actualQty: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const PartyAlcoholConsumptionSchema = new mongoose.Schema(
  {
    partyQueryId: { type: mongoose.Schema.Types.ObjectId, ref: "PartyQuery", required: true, unique: true },

    // Snapshot fields — copied from PartyQuery/RFP at creation time, not
    // re-derived on every read, so this stays a stable historical record.
    partyDate: { type: Date, required: true },
    timeRangeStart: { type: String, trim: true, default: "" },
    timeRangeEnd: { type: String, trim: true, default: "" },
    hostName: { type: String, trim: true, default: "" },
    packageBrochure: { type: String, trim: true, default: "" },

    // = rfp.generalInfo.alcoholPackageRate + rfp.generalInfo.beveragePackageRate
    // at the time this record was created — the "budget" the RFP itself
    // quoted for alcohol + beverages, per the explicit instruction that
    // this must come from the RFP, not be typed in by hand.
    expectedSell: { type: Number, default: 0, min: 0 },
    // The only manually-entered money figure on this record.
    actualSell: { type: Number, default: 0, min: 0 },

    consumption: {
      alcohols: { type: [AlcoholConsumptionItemSchema], default: [] },
      cocktails: { type: [ConsumptionItemSchema], default: [] },
      mocktails: { type: [ConsumptionItemSchema], default: [] },
      softBeverages: { type: [ConsumptionItemSchema], default: [] },
    },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

PartyAlcoholConsumptionSchema.index({ partyDate: 1 });
PartyAlcoholConsumptionSchema.index({ isActive: 1 });

export const PartyAlcoholConsumption = mongoose.model("PartyAlcoholConsumption", PartyAlcoholConsumptionSchema);
export default PartyAlcoholConsumption;