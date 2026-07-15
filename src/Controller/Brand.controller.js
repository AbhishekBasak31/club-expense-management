import { Brand } from "../Model/Brand.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// CREATE
export const createBrand = async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return sendError(res, "Brand name is required.");
  const brand = await Brand.create(req.body);
  return sendSuccess(res, brand, "Brand created.", 201);
};

// LIST (with optional search + active filter)
export const getBrands = async (req, res) => {
  const { search, active } = req.query;
  const filter = {};
  if (active !== undefined) filter.isActive = active === "true";
  if (search) filter.name = { $regex: search, $options: "i" };

  const brands = await Brand.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, brands);
};

// GET ONE
export const getBrandById = async (req, res) => {
  const brand = await Brand.findById(req.params.id).lean();
  if (!brand) return sendError(res, "Brand not found.", 404);
  return sendSuccess(res, brand);
};

// UPDATE
export const updateBrand = async (req, res) => {
  const brand = await Brand.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  );
  if (!brand) return sendError(res, "Brand not found.", 404);
  return sendSuccess(res, brand, "Brand updated.");
};

// DELETE (soft — set inactive)
export const deleteBrand = async (req, res) => {
  const brand = await Brand.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );
  if (!brand) return sendError(res, "Brand not found.", 404);
  return sendSuccess(res, null, "Brand deactivated.");
};