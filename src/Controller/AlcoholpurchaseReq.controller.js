import { AlcoholPurchaseRequirement } from "../Model/AlcoholpurchaseReq.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// totalValue/reqQtyPrice are always recalculated server-side from
// currentQty/currentPrice/reqQty on every create/update below — never
// trusted from the request body — matching how GST amounts elsewhere
// in this app are always server-recalculated rather than client-sent.

export const createAlcoholPurchaseRequirement = async (req, res) => {
  const { date, alcoholItemDetails, currentQty, currentPrice, reqQty } = req.body;
  if (!date) return sendError(res, "Date is required.");
  if (!alcoholItemDetails?.trim()) return sendError(res, "Alcohol item details are required.");
  if (currentQty == null || Number(currentQty) < 0) return sendError(res, "A valid current quantity is required.");
  if (currentPrice == null || Number(currentPrice) < 0) return sendError(res, "A valid current price is required.");
  if (reqQty == null || Number(reqQty) < 0) return sendError(res, "A valid requested quantity is required.");

  const doc = await AlcoholPurchaseRequirement.create({
    date, alcoholItemDetails: alcoholItemDetails.trim(),
    currentQty: Number(currentQty), currentPrice: Number(currentPrice), reqQty: Number(reqQty),
    totalValue: Math.round(Number(currentQty) * Number(currentPrice) * 100) / 100,
    reqQtyPrice: Math.round(Number(reqQty) * Number(currentPrice) * 100) / 100,
    issuedBy: req.user?.userId ?? null,
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  const populated = await doc.populate("issuedBy", "name");
  return sendSuccess(res, populated, "Purchase requirement issued.", 201);
};

// Query params: search, dateFrom, dateTo (all optional). Returns every
// active record — the frontend computes the footer totals itself from
// this full list (this dataset is small enough that server-side
// pagination/aggregation isn't needed yet; revisit if the list grows
// into the thousands).
export const getAlcoholPurchaseRequirements = async (req, res) => {
  const { search, dateFrom, dateTo } = req.query;
  const filter = { isActive: true };
  if (search) filter.alcoholItemDetails = { $regex: search, $options: "i" };
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) filter.date.$lte = new Date(dateTo);
  }

  const docs = await AlcoholPurchaseRequirement.find(filter)
    .sort({ date: -1, createdAt: -1 })
    .populate("issuedBy", "name")
    .lean();
  return sendSuccess(res, docs);
};

export const getAlcoholPurchaseRequirementById = async (req, res) => {
  const doc = await AlcoholPurchaseRequirement.findOne({ _id: req.params.id, isActive: true }).populate("issuedBy", "name").lean();
  if (!doc) return sendError(res, "Purchase requirement not found.", 404);
  return sendSuccess(res, doc);
};

export const updateAlcoholPurchaseRequirement = async (req, res) => {
  const existing = await AlcoholPurchaseRequirement.findOne({ _id: req.params.id, isActive: true });
  if (!existing) return sendError(res, "Purchase requirement not found.", 404);

  const { totalValue, reqQtyPrice, issuedBy, ...safeBody } = req.body; // computed/identity fields never accepted from the client
  Object.assign(existing, safeBody);
  existing.totalValue = Math.round((existing.currentQty || 0) * (existing.currentPrice || 0) * 100) / 100;
  existing.reqQtyPrice = Math.round((existing.reqQty || 0) * (existing.currentPrice || 0) * 100) / 100;
  existing.updatedBy = req.user?.userId ?? null;
  await existing.save();
  const populated = await existing.populate("issuedBy", "name");
  return sendSuccess(res, populated, "Purchase requirement updated.");
};

// Soft delete, matching the convention used throughout this app.
export const deleteAlcoholPurchaseRequirement = async (req, res) => {
  const doc = await AlcoholPurchaseRequirement.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Purchase requirement not found.", 404);
  doc.isActive = false;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, null, "Purchase requirement deleted.");
};