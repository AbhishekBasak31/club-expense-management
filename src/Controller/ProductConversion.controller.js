import { ProductConversion } from "../Model/productconv.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

export const createConversion = async (req, res) => {
  const { productId, fromUomId, toUomId, conversionFactor } = req.body;
  if (!productId || !fromUomId || !toUomId || conversionFactor == null)
    return sendError(res, "productId, fromUomId, toUomId and conversionFactor are required.");
  if (conversionFactor <= 0)
    return sendError(res, "Conversion factor must be greater than 0.");

  const conversion = await ProductConversion.create(req.body);
  return sendSuccess(res, conversion, "Conversion created.", 201);
};

export const getConversions = async (req, res) => {
  const { productId, active } = req.query;
  const filter = {};
  if (productId) filter.productId = productId;
  if (active !== undefined) filter.isActive = active === "true";

  const conversions = await ProductConversion.find(filter).sort({ createdAt: -1 }).lean();
  return sendSuccess(res, conversions);
};

export const getConversionById = async (req, res) => {
  const conversion = await ProductConversion.findById(req.params.id).lean();
  if (!conversion) return sendError(res, "Conversion not found.", 404);
  return sendSuccess(res, conversion);
};

export const updateConversion = async (req, res) => {
  const conversion = await ProductConversion.findByIdAndUpdate(
    req.params.id, { $set: req.body }, { new: true, runValidators: true }
  );
  if (!conversion) return sendError(res, "Conversion not found.", 404);
  return sendSuccess(res, conversion, "Conversion updated.");
};

export const deleteConversion = async (req, res) => {
  const conversion = await ProductConversion.findByIdAndUpdate(
    req.params.id, { isActive: false }, { new: true }
  );
  if (!conversion) return sendError(res, "Conversion not found.", 404);
  return sendSuccess(res, null, "Conversion deactivated.");
};