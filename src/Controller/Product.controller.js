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

// POST /bulk  { products: ProductPayload[] }
// The tabular "multiple products at once" add form's save action —
// every row in that table shares one category selection (picked once
// at the top of the form, not re-picked per row), so this endpoint
// doesn't do anything special with category fields; the frontend just
// sends the same mainCategoryId/subCategoryId/baseCategoryId on every
// row. Each row is validated with the exact same rule as the single-
// product create above (name required) — this isn't a looser bulk
// path. Uses insertMany with ordered:false so one bad row doesn't
// block the rest; the response reports exactly which rows succeeded
// and which failed, with the same per-row error message
// createProduct would have given for that row.
export const createProductsBulk = async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) return sendError(res, "Provide at least one product.");

  // `prepared` keeps each row's ORIGINAL index alongside its cleaned
  // doc — needed because once invalid rows are filtered out before
  // insertMany, position within `toInsert` no longer matches position
  // within the original `products` array, and that mapping has to be
  // carried through explicitly rather than re-derived from array
  // indices later.
  const prepared = products.map((p, index) => ({ index, doc: stripDerivedFields(p) }));
  const invalid = prepared.filter(p => !p.doc.name?.trim());
  const toInsert = prepared.filter(p => p.doc.name?.trim());

  const results = new Array(products.length);
  invalid.forEach(p => { results[p.index] = { index: p.index, ok: false, error: "Product name is required." }; });

  if (toInsert.length > 0) {
    try {
      const created = await Product.insertMany(toInsert.map(p => p.doc), { ordered: false });
      // Full success — insertMany preserves input order exactly here,
      // so position-for-position mapping back to toInsert is safe.
      created.forEach((doc, i) => { results[toInsert[i].index] = { index: toInsert[i].index, ok: true, product: doc }; });
    } catch (err) {
      // ordered:false throws on ANY failure but still performs every
      // valid insert. err.writeErrors gives the position WITHIN
      // toInsert of each failure; whichever toInsert positions are
      // NOT in that failure set succeeded, in the same relative order
      // as err.insertedDocs — that's the only reliable way to map
      // insertedDocs back to specific rows once some have failed,
      // since insertedDocs itself carries no row-index information.
      const writeErrors = err.writeErrors || [];
      const failedPositions = new Set(writeErrors.map(we => we.index));
      const succeededPositions = toInsert.map((_, i) => i).filter(i => !failedPositions.has(i));
      const insertedDocs = err.insertedDocs || [];

      succeededPositions.forEach((pos, i) => {
        const doc = insertedDocs[i];
        if (doc) results[toInsert[pos].index] = { index: toInsert[pos].index, ok: true, product: doc };
      });
      writeErrors.forEach(we => {
        const row = toInsert[we.index];
        if (row) results[row.index] = { index: row.index, ok: false, error: we.errmsg || we.err?.errmsg || "Failed to save this row." };
      });
    }
  }

  const successCount = results.filter(r => r?.ok).length;
  return sendSuccess(res, results, `${successCount} of ${products.length} product${products.length > 1 ? 's' : ''} saved.`, 201);
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