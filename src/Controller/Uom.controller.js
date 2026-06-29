import { UOM } from "../Model/uom.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

export const createUOM = async (req, res) => {
  const { name, abbreviation } = req.body;
  if (!name?.trim() || !abbreviation?.trim())
    return sendError(res, "Name and abbreviation are required.");
  const uom = await UOM.create({ name, abbreviation });
  return sendSuccess(res, uom, "UOM created.", 201);
};

export const getUOMs = async (req, res) => {
  const { active } = req.query;
  const filter = {};
  if (active !== undefined) filter.isActive = active === "true";
  const uoms = await UOM.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, uoms);
};

export const getUOMById = async (req, res) => {
  const uom = await UOM.findById(req.params.id).lean();
  if (!uom) return sendError(res, "UOM not found.", 404);
  return sendSuccess(res, uom);
};

export const updateUOM = async (req, res) => {
  const uom = await UOM.findByIdAndUpdate(
    req.params.id, { $set: req.body }, { new: true, runValidators: true }
  );
  if (!uom) return sendError(res, "UOM not found.", 404);
  return sendSuccess(res, uom, "UOM updated.");
};

export const deleteUOM = async (req, res) => {
  const uom = await UOM.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!uom) return sendError(res, "UOM not found.", 404);
  return sendSuccess(res, null, "UOM deactivated.");
};