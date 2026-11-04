import { ProductConversion } from "../Model/productconv.model.js";
import { UOM } from "../Model/uom.model.js";
import { Product } from "../Model/product.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { validatePair, toBase, splitServings, parseSizeFromName, norm } from "../Utils/Uom.resolver.js";

const uid = (req) => req.user?.userId ?? null;
const same = (a, b) => String(a) === String(b);
const fmtF = (n) => String(Math.round(Number(n) * 1e6) / 1e6);

// ─────────────────────────────────────────────────────────────────
// ONE rule-set for creating a conversion — used by create, update (re-activation)
// and bulk, so they can never disagree.
//   ctx = { productsById, uomsById, activeConversions }   (plain data, no DB)
// Returns { ok:true, names } or { ok:false, error, status }.
// ─────────────────────────────────────────────────────────────────
export function evaluateConversion(input, ctx, excludeId = null) {
  const { productId, fromUomId, toUomId } = input;
  const factor = Number(input.conversionFactor);
  const bad = (error, status = 400) => ({ ok: false, error, status });

  if (!productId || !fromUomId || !toUomId || input.conversionFactor === undefined || input.conversionFactor === null || input.conversionFactor === "")
    return bad("productId, fromUomId, toUomId and conversionFactor are required.");
  if (!Number.isFinite(factor) || factor <= 0) return bad("Conversion factor must be greater than 0.");

  const product = ctx.productsById.get(String(productId));
  if (!product) return bad("Product not found.");
  const from = ctx.uomsById.get(String(fromUomId));
  const to = ctx.uomsById.get(String(toUomId));
  if (!from || !to) return bad("Unit not found.");
  if (from.isActive === false || to.isActive === false) return bad("Both units must be active.");

  const pairError = validatePair(from, to);
  if (pairError) return bad(pairError);

  const others = ctx.activeConversions.filter((c) => same(c.productId, productId) && !same(c._id, excludeId));
  const dup = others.find((c) => same(c.fromUomId, fromUomId) && same(c.toUomId, toUomId));
  if (dup) return bad(`${product.name} already has an active ${from.name} → ${to.name} conversion (1 ${from.name} = ${fmtF(dup.conversionFactor)} ${to.name}). Edit that one instead.`, 409);
  const rev = others.find((c) => same(c.fromUomId, toUomId) && same(c.toUomId, fromUomId));
  if (rev) return bad(`${product.name} already has the reverse conversion ${to.name} → ${from.name} (1 ${to.name} = ${fmtF(rev.conversionFactor)} ${from.name}). One direction is enough — use that one.`, 409);

  return { ok: true, names: { productName: product.name, fromUomName: from.name, toUomName: to.name }, factor };
}

async function loadContext(productIds = null) {
  const [uoms, products, activeConversions] = await Promise.all([
    UOM.find({}).lean(),
    productIds
      ? Product.find({ _id: { $in: productIds } }).lean()
      : Product.find({}).lean(),
    ProductConversion.find({ isActive: true }).lean(),
  ]);
  return {
    uoms,
    productsById: new Map(products.map((p) => [String(p._id), p])),
    uomsById: new Map(uoms.map((u) => [String(u._id), u])),
    activeConversions,
  };
}

const dupFromIndex = (err) => (err?.code === 11000 ? "This product already has an active conversion for that unit pair." : null);

export const createConversion = async (req, res) => {
  const { productId, fromUomId, toUomId, conversionFactor } = req.body || {};
  const ctx = await loadContext(productId ? [productId] : []);
  const result = evaluateConversion({ productId, fromUomId, toUomId, conversionFactor }, ctx);
  if (!result.ok) return sendError(res, result.error, result.status);

  try {
    const conversion = await ProductConversion.create({
      productId, fromUomId, toUomId, conversionFactor: result.factor,
      ...result.names, // names always come from the master data, never from the request
      createdBy: uid(req), updatedBy: uid(req),
    });
    return sendSuccess(res, conversion, "Conversion created.", 201);
  } catch (err) {
    const msg = dupFromIndex(err);
    if (msg) return sendError(res, msg, 409);
    throw err;
  }
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

// Only the factor and the active flag can change. The product and the two units
// are fixed — stock is interpreted through them — so an attempt to change one is
// refused with an explanation instead of being silently ignored.
export const updateConversion = async (req, res) => {
  const doc = await ProductConversion.findById(req.params.id);
  if (!doc) return sendError(res, "Conversion not found.", 404);
  const body = req.body || {};

  for (const key of ["productId", "fromUomId", "toUomId"]) {
    if (body[key] !== undefined && !same(body[key], doc[key])) {
      return sendError(res, "The product and units of a conversion cannot be changed. Deactivate this conversion and add a new one.", 400);
    }
  }

  const nextFactor = body.conversionFactor !== undefined ? Number(body.conversionFactor) : doc.conversionFactor;
  const nextActive = body.isActive !== undefined ? !!body.isActive : doc.isActive;
  if (!Number.isFinite(nextFactor) || nextFactor <= 0) return sendError(res, "Conversion factor must be greater than 0.");

  if (nextActive) {
    // Re-run the full rules (excluding this row itself), also refreshing the names
    // so a renamed product or unit is picked up the next time it is saved.
    const ctx = await loadContext([doc.productId]);
    const result = evaluateConversion(
      { productId: doc.productId, fromUomId: doc.fromUomId, toUomId: doc.toUomId, conversionFactor: nextFactor }, ctx, doc._id);
    if (!result.ok) return sendError(res, result.error, result.status);
    Object.assign(doc, result.names);
  }
  doc.conversionFactor = nextFactor;
  doc.isActive = nextActive;
  doc.updatedBy = uid(req);
  try {
    await doc.save();
  } catch (err) {
    const msg = dupFromIndex(err);
    if (msg) return sendError(res, msg, 409);
    throw err;
  }
  return sendSuccess(res, doc, "Conversion updated.");
};

export const deleteConversion = async (req, res) => {
  const doc = await ProductConversion.findById(req.params.id);
  if (!doc) return sendError(res, "Conversion not found.", 404);
  doc.isActive = false;
  doc.updatedBy = uid(req);
  await doc.save();
  return sendSuccess(res, null, "Conversion deactivated.");
};

// ─────────────────────────────────────────────────────────────────
// GET /product-conversions/resolve?productId=&uomId=&qty=1&servingUomId=
// "How many ml (or g) is this?" — walks the product's conversions, so Crate →
// Bottle → ML works. Stock, sales and reports should call this rather than redo
// the maths. uomId defaults to the product's own unit; servingUomId (e.g. Peg)
// adds whole servings + the leftover ml.
// ─────────────────────────────────────────────────────────────────
export const resolveQuantity = async (req, res) => {
  const { productId, servingUomId } = req.query;
  if (!productId) return sendError(res, "productId is required.");
  const qty = req.query.qty === undefined ? 1 : Number(req.query.qty);
  if (!Number.isFinite(qty) || qty < 0) return sendError(res, "qty must be a number of 0 or more.");

  const [uoms, product, conversions] = await Promise.all([
    UOM.find({}).lean(),
    Product.findById(productId).lean(),
    ProductConversion.find({ productId, isActive: true }).lean(),
  ]);
  if (!product) return sendError(res, "Product not found.", 404);
  const uomId = req.query.uomId || product.uomId;
  if (!uomId) return sendError(res, "This product has no unit set and no uomId was given.");

  const result = toBase({ uoms, conversions, uomId, qty });
  if (result.ok && servingUomId) {
    const s = uoms.find((u) => same(u._id, servingUomId));
    if (s && s.type === result.kind && Number(s.baseFactor) > 0) {
      result.servings = { uomId: String(s._id), name: s.name, unitBase: Number(s.baseFactor), ...splitServings(result.baseQty, Number(s.baseFactor)) };
    }
  }
  return sendSuccess(res, result);
};

// ─────────────────────────────────────────────────────────────────
// GET /product-conversions/readiness?subCategoryName=Alcohol
// Which products can't yet be expressed in ml? (read-only)
//   ready   — 1 of the product's own unit resolves to ml/g
//   missing — it has a unit but no conversion path (suggestedMl = a size guessed
//             from the NAME, for a person to confirm — never applied automatically)
//   no-uom  — the product has no unit at all (fix on the product itself)
// ─────────────────────────────────────────────────────────────────
export const getReadiness = async (req, res) => {
  const sub = norm(req.query.subCategoryName || "Alcohol");
  const ctx = await loadContext();
  const byProduct = new Map();
  ctx.activeConversions.forEach((c) => {
    const k = String(c.productId);
    if (!byProduct.has(k)) byProduct.set(k, []);
    byProduct.get(k).push(c);
  });

  const rows = [...ctx.productsById.values()]
    .filter((p) => p.isActive !== false && norm(p.subCategoryName) === sub)
    .map((p) => {
      const base = { productId: String(p._id), name: p.name, brandName: p.brandName || "", uomName: p.uomName || "" };
      if (!p.uomId) return { ...base, status: "no-uom", unitMl: null, suggestedMl: parseSizeFromName(p.name) };
      const r = toBase({ uoms: ctx.uoms, conversions: byProduct.get(String(p._id)) || [], uomId: p.uomId, qty: 1 });
      return r.ok
        ? { ...base, status: "ready", unitMl: r.base === "ml" ? r.baseQty : null, suggestedMl: null }
        : { ...base, status: "missing", unitMl: null, suggestedMl: parseSizeFromName(p.name) };
    })
    .sort((a, b) => (a.status === "ready") - (b.status === "ready") || a.name.localeCompare(b.name));

  return sendSuccess(res, {
    subCategoryName: req.query.subCategoryName || "Alcohol",
    total: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    missing: rows.filter((r) => r.status === "missing").length,
    noUom: rows.filter((r) => r.status === "no-uom").length,
    rows,
  });
};

// ─────────────────────────────────────────────────────────────────
// POST /product-conversions/bulk  { items:[{productId,fromUomId,toUomId,conversionFactor}], dryRun? }
// Same rules as create, row by row; one bad row never blocks the others, and rows
// that already exist are reported as "exists" instead of failing. dryRun checks
// everything and writes nothing.
// ─────────────────────────────────────────────────────────────────
export const bulkCreateConversions = async (req, res) => {
  const { items, dryRun } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return sendError(res, "Provide at least one conversion.");
  if (items.length > 500) return sendError(res, "A bulk request can hold at most 500 conversions.");

  const ctx = await loadContext(items.map((i) => i?.productId).filter(Boolean));
  const results = [];
  for (let index = 0; index < items.length; index++) {
    const it = items[index] || {};
    const r = evaluateConversion(it, ctx);
    if (!r.ok) {
      const exists = r.status === 409 && /already has an active/.test(r.error);
      results.push({ index, ok: exists, action: exists ? "exists" : "error", ...(exists ? {} : { error: r.error }) });
      continue;
    }
    if (dryRun) { results.push({ index, ok: true, action: "would-create" }); }
    else {
      try {
        const created = await ProductConversion.create({
          productId: it.productId, fromUomId: it.fromUomId, toUomId: it.toUomId, conversionFactor: r.factor,
          ...r.names, createdBy: uid(req), updatedBy: uid(req),
        });
        results.push({ index, ok: true, action: "created" });
        ctx.activeConversions.push(created.toObject ? created.toObject() : created); // later rows in the same batch see it
      } catch (err) {
        results.push({ index, ok: false, action: "error", error: dupFromIndex(err) || "Failed to save this row." });
        continue;
      }
    }
    if (dryRun) ctx.activeConversions.push({ _id: `dry-${index}`, productId: it.productId, fromUomId: it.fromUomId, toUomId: it.toUomId, conversionFactor: r.factor });
  }
  const count = (a) => results.filter((x) => x.action === a).length;
  return sendSuccess(res, {
    dryRun: !!dryRun, results,
    summary: { created: count("created"), wouldCreate: count("would-create"), exists: count("exists"), errors: count("error") },
  }, dryRun ? "Preview only — nothing was saved." : `${count("created")} conversion${count("created") === 1 ? "" : "s"} created.`, dryRun ? 200 : 201);
};