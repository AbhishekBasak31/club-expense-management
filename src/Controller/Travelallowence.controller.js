import { TravelAllowance } from "../Model/Travelallowence.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

export const createTravelAllowance = async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return sendError(res, "Name is required.");
  const item = await TravelAllowance.create(req.body);
  return sendSuccess(res, item, "Travel allowance created.", 201);
};

export const getTravelAllowances = async (req, res) => {
  const { search, active } = req.query;
  const filter = {};
  if (active !== undefined) filter.isActive = active === "true";
  if (search) filter.name = { $regex: search, $options: "i" };

  const items = await TravelAllowance.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, items);
};

export const getTravelAllowanceById = async (req, res) => {
  const item = await TravelAllowance.findById(req.params.id).lean();
  if (!item) return sendError(res, "Travel allowance not found.", 404);
  return sendSuccess(res, item);
};

export const updateTravelAllowance = async (req, res) => {
  const item = await TravelAllowance.findByIdAndUpdate(
    req.params.id, { $set: req.body }, { new: true, runValidators: true }
  );
  if (!item) return sendError(res, "Travel allowance not found.", 404);
  return sendSuccess(res, item, "Travel allowance updated.");
};

export const deleteTravelAllowance = async (req, res) => {
  const item = await TravelAllowance.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!item) return sendError(res, "Travel allowance not found.", 404);
  return sendSuccess(res, null, "Travel allowance deactivated.");
};