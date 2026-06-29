import { Vendor } from "../Model/vendor.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js"
// CREATE
export const createVendor = async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return sendError(res, "Vendor name is required.");
  const vendor = await Vendor.create(req.body);
  return sendSuccess(res, vendor, "Vendor created.", 201);
};

// LIST (with optional search + active filter)
export const getVendors = async (req, res) => {
  const { search, active } = req.query;
  const filter = {};
  if (active !== undefined) filter.isActive = active === "true";
  if (search) filter.name = { $regex: search, $options: "i" };

  const vendors = await Vendor.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, vendors);
};

// GET ONE
export const getVendorById = async (req, res) => {
  const vendor = await Vendor.findById(req.params.id).lean();
  if (!vendor) return sendError(res, "Vendor not found.", 404);
  return sendSuccess(res, vendor);
};

// UPDATE
export const updateVendor = async (req, res) => {
  const vendor = await Vendor.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true }
  );
  if (!vendor) return sendError(res, "Vendor not found.", 404);
  return sendSuccess(res, vendor, "Vendor updated.");
};

// DELETE (soft — set inactive)
export const deleteVendor = async (req, res) => {
  const vendor = await Vendor.findByIdAndUpdate(
    req.params.id,
    { isActive: false },
    { new: true }
  );
  if (!vendor) return sendError(res, "Vendor not found.", 404);
  return sendSuccess(res, null, "Vendor deactivated.");
};