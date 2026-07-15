import { Product } from "../Model/product.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// currentPrice/lastPriceDate are derived — auto-synced by the Expense
// controller whenever a matching expense is saved. Strip them from any
// client payload so they can never be set directly through this API.
const stripDerivedFields = (body) => {
  const { currentPrice, lastPriceDate, ...rest } = body || {};
  return rest;
};

export const createProduct = async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return sendError(res, "Product name is required.");
  const product = await Product.create(stripDerivedFields(req.body));
  return sendSuccess(res, product, "Product created.", 201);
};

export const getProducts = async (req, res) => {
  const { search, subCategoryId, active, expenseType, brandId } = req.query; // ← added brandId

  const filter = {};
  if (active !== undefined) filter.isActive = active === "true";
  if (subCategoryId)  filter.subCategoryId = subCategoryId;
  if (search)         filter.name = { $regex: search, $options: "i" };
  if (expenseType)    filter.expenseType = expenseType;
  if (brandId)        filter.brandId = brandId;  // ← one new line

  const products = await Product.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, products);
};

export const getProductById = async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) return sendError(res, "Product not found.", 404);
  return sendSuccess(res, product);
};

export const updateProduct = async (req, res) => {
  const product = await Product.findByIdAndUpdate(
    req.params.id, { $set: stripDerivedFields(req.body) }, { new: true, runValidators: true }
  );
  if (!product) return sendError(res, "Product not found.", 404);
  return sendSuccess(res, product, "Product updated.");
};

export const deleteProduct = async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!product) return sendError(res, "Product not found.", 404);
  return sendSuccess(res, null, "Product deactivated.");
};