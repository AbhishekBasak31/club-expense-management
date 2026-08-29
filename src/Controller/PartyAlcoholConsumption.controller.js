import { PartyAlcoholConsumption } from "../Model/Partyalcoholconsumption.modal.js";
import { PartyQuery } from "../Model/PartyQuery.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// Builds the consumption arrays (with expectedQty snapshotted, actualQty
// starting at 0) from an RFP's beverageMenu — shared by createConsumption
// below.
function snapshotConsumption(beverageMenu) {
  const bev = beverageMenu || {};
  return {
    alcohols: (bev.alcohols || []).map(a => ({ drinkType: a.drinkType, brand: a.brand, expectedQty: a.expectedQty || 0, actualQty: 0 })),
    cocktails: (bev.cocktails || []).map(i => ({ name: i.name, expectedQty: i.expectedQty || 0, actualQty: 0 })),
    mocktails: (bev.mocktails || []).map(i => ({ name: i.name, expectedQty: i.expectedQty || 0, actualQty: 0 })),
    softBeverages: (bev.softBeverages || []).map(i => ({ name: i.name, expectedQty: i.expectedQty || 0, actualQty: 0 })),
  };
}

// POST /  { partyQueryId, actualSell }
// Everything except actualSell is pulled from the selected party's RFP —
// only valid once that party has an RFP (any status past 'not_generated'
// — doesn't require 'shared' specifically, since "select the RFP doc" is
// the trigger here, not delivery status). One consumption record per
// party — rejects if one already exists rather than silently overwriting
// or creating a duplicate.
export const createPartyAlcoholConsumption = async (req, res) => {
  const { partyQueryId, actualSell } = req.body;
  if (!partyQueryId) return sendError(res, "Select a party (via its RFP) first.");

  const party = await PartyQuery.findOne({ _id: partyQueryId, isActive: true });
  if (!party) return sendError(res, "Party query not found.");
  if (party.rfpStatus === "not_generated") return sendError(res, "This party doesn't have an RFP yet — create one before tracking consumption.");

  const existing = await PartyAlcoholConsumption.findOne({ partyQueryId, isActive: true });
  if (existing) return sendError(res, "A consumption record already exists for this party.");

  const rfp = party.rfp || {};
  const gi = rfp.generalInfo || {};

  const doc = await PartyAlcoholConsumption.create({
    partyQueryId,
    partyDate: party.date,
    timeRangeStart: party.timeRangeStart,
    timeRangeEnd: party.timeRangeEnd,
    hostName: party.name,
    packageBrochure: party.packageBrochure,
    expectedSell: (gi.alcoholPackageRate || 0) + (gi.beveragePackageRate || 0),
    actualSell: Number(actualSell) || 0,
    consumption: snapshotConsumption(rfp.beverageMenu),
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  return sendSuccess(res, doc, "Party added for consumption tracking.", 201);
};

export const getPartyAlcoholConsumptions = async (req, res) => {
  const { search } = req.query;
  const filter = { isActive: true };
  if (search) filter.hostName = { $regex: search, $options: "i" };

  const docs = await PartyAlcoholConsumption.find(filter).sort({ partyDate: -1, createdAt: -1 }).lean();
  return sendSuccess(res, docs);
};

export const getPartyAlcoholConsumptionById = async (req, res) => {
  const doc = await PartyAlcoholConsumption.findOne({ _id: req.params.id, isActive: true }).lean();
  if (!doc) return sendError(res, "Consumption record not found.", 404);
  return sendSuccess(res, doc);
};

// PUT /:id — base-field edits (currently just actualSell; the fields
// snapshotted from the RFP are deliberately not editable here — if the
// wrong party was selected, delete this record and create a new one
// rather than repointing an existing one at different source data).
export const updatePartyAlcoholConsumption = async (req, res) => {
  const { actualSell } = req.body;
  const doc = await PartyAlcoholConsumption.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Consumption record not found.", 404);

  if (actualSell != null) doc.actualSell = Number(actualSell) || 0;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, doc, "Updated.");
};

// PUT /:id/consumption  { consumption: { alcohols: [...], cocktails: [...], mocktails: [...], softBeverages: [...] } }
// The "Party Consume" modal's save action — updates ONLY actualQty per
// item, matched by name (or drinkType+brand for alcohol). expectedQty
// stays whatever was snapshotted at creation regardless of what's sent —
// this endpoint can't be used to retroactively change what was expected.
export const updateConsumption = async (req, res) => {
  const { consumption } = req.body;
  if (!consumption) return sendError(res, "No consumption data provided.");

  const doc = await PartyAlcoholConsumption.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Consumption record not found.", 404);

  const applyActuals = (existingItems, incomingItems, matchFn) =>
    existingItems.map(existing => {
      const incoming = (incomingItems || []).find(i => matchFn(existing, i));
      return incoming ? { ...existing.toObject(), actualQty: Number(incoming.actualQty) || 0 } : existing;
    });

  doc.consumption.alcohols = applyActuals(doc.consumption.alcohols, consumption.alcohols, (a, b) => a.drinkType === b.drinkType && a.brand === b.brand);
  doc.consumption.cocktails = applyActuals(doc.consumption.cocktails, consumption.cocktails, (a, b) => a.name === b.name);
  doc.consumption.mocktails = applyActuals(doc.consumption.mocktails, consumption.mocktails, (a, b) => a.name === b.name);
  doc.consumption.softBeverages = applyActuals(doc.consumption.softBeverages, consumption.softBeverages, (a, b) => a.name === b.name);

  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, doc, "Consumption updated.");
};

export const deletePartyAlcoholConsumption = async (req, res) => {
  const doc = await PartyAlcoholConsumption.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Consumption record not found.", 404);
  doc.isActive = false;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, null, "Deleted.");
};

// GET /available-parties — parties with an RFP that DON'T already have a
// consumption record yet, for the Add form's RFP-select dropdown (so it
// only ever offers parties that can actually be added, matching the
// unique-per-party constraint above).
export const getAvailablePartiesForConsumption = async (req, res) => {
  const alreadyTracked = await PartyAlcoholConsumption.find({ isActive: true }).distinct("partyQueryId");
  const parties = await PartyQuery.find({
    isActive: true,
    rfpStatus: { $ne: "not_generated" },
    _id: { $nin: alreadyTracked },
  }).select("name date timeRangeStart timeRangeEnd packageBrochure rfp rfpStatus").sort({ date: -1 }).lean();
  return sendSuccess(res, parties);
};