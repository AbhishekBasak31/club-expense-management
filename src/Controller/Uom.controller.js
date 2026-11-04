import { UOM } from "../Model/uom.model.js";
import { ProductConversion } from "../Model/productconv.model.js";
import { Product } from "../Model/product.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { validateUomShape, planSeed, norm, hasValue } from "../Utils/Uom.resolver.js";

const uid = (req) => req.user?.userId ?? null;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// A UOM is "in use" when an active conversion or an active product points at it.
// Once in use, its type and base amount are locked and it cannot be deactivated —
// stock quantities and conversions are interpreted through them.
async function usageOf(uomId) {
  const [conversions, products] = await Promise.all([
    ProductConversion.countDocuments({ isActive: true, $or: [{ fromUomId: uomId }, { toUomId: uomId }] }),
    Product.countDocuments({ isActive: true, uomId }),
  ]);
  return { conversions, products, total: conversions + products };
}
const usageText = (u) => `${plural(u.conversions, "conversion")} and ${plural(u.products, "product")}`;

// Name and abbreviation share ONE namespace among ACTIVE units, ignoring case and
// spacing: no two units may answer to the same text, whether it is a name or an
// abbreviation. (The Excel import and every lookup match a unit by "name OR
// abbreviation", so "ml" as one unit's name and another's abbreviation would be
// ambiguous.)
function duplicateMessage(active, { name, abbreviation }, excludeId) {
  const others = active.filter((u) => String(u._id) !== String(excludeId));
  const clash = (value) => others.find((u) => norm(u.name) === norm(value) || norm(u.abbreviation) === norm(value));
  if (name !== undefined) {
    const hit = clash(name);
    if (hit) return norm(hit.name) === norm(name) ? `A unit named "${hit.name}" already exists.` : `"${String(name).trim()}" can't be used as a name — it is already the abbreviation of "${hit.name}".`;
  }
  if (abbreviation !== undefined) {
    const hit = clash(abbreviation);
    if (hit) return norm(hit.abbreviation) === norm(abbreviation) ? `The abbreviation "${hit.abbreviation}" is already used by "${hit.name}".` : `"${String(abbreviation).trim()}" can't be used as an abbreviation — it is already the name of "${hit.name}".`;
  }
  return null;
}

const mapDup = (err) => (err?.code === 11000 ? "A unit with this name or abbreviation already exists." : null);

export const createUOM = async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const abbreviation = String(req.body?.abbreviation || "").trim();
  if (!name || !abbreviation) return sendError(res, "Name and abbreviation are required.");

  const type = req.body.type || "";
  const baseFactor = hasValue(req.body.baseFactor) ? Number(req.body.baseFactor) : null;
  const shapeError = validateUomShape({ type, baseFactor });
  if (shapeError) return sendError(res, shapeError);

  const active = await UOM.find({ isActive: true }).lean();
  const dup = duplicateMessage(active, { name, abbreviation });
  if (dup) return sendError(res, dup, 409);

  try {
    const uom = await UOM.create({
      name, abbreviation, type, baseFactor,
      isActive: req.body.isActive !== false,
      createdBy: uid(req), updatedBy: uid(req),
    });
    return sendSuccess(res, uom, "UOM created.", 201);
  } catch (err) {
    const msg = mapDup(err);
    if (msg) return sendError(res, msg, 409);
    throw err;
  }
};

export const getUOMs = async (req, res) => {
  const { active, type } = req.query;
  const filter = {};
  if (active !== undefined) filter.isActive = active === "true";
  if (type !== undefined) filter.type = type;
  const uoms = await UOM.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, uoms);
};

export const getUOMById = async (req, res) => {
  const uom = await UOM.findById(req.params.id).lean();
  if (!uom) return sendError(res, "UOM not found.", 404);
  return sendSuccess(res, uom);
};

// Only name, abbreviation, type, baseFactor and isActive can be edited — nothing
// else in the body is ever written (no more $set: req.body).
export const updateUOM = async (req, res) => {
  const doc = await UOM.findById(req.params.id);
  if (!doc) return sendError(res, "UOM not found.", 404);
  const body = req.body || {};

  const next = {
    name: body.name !== undefined ? String(body.name).trim() : doc.name,
    abbreviation: body.abbreviation !== undefined ? String(body.abbreviation).trim() : doc.abbreviation,
    type: body.type !== undefined ? body.type || "" : doc.type || "",
    baseFactor: body.baseFactor !== undefined ? (hasValue(body.baseFactor) ? Number(body.baseFactor) : null) : (doc.baseFactor ?? null),
    isActive: body.isActive !== undefined ? !!body.isActive : doc.isActive,
  };
  if (!next.name || !next.abbreviation) return sendError(res, "Name and abbreviation are required.");

  const shapeError = validateUomShape(next);
  if (shapeError) return sendError(res, shapeError);

  // Duplicates are only checked for what is being changed, so a legacy duplicate
  // never stops someone from editing something else on the same unit.
  const nameChanged = norm(next.name) !== norm(doc.name);
  const abbrChanged = norm(next.abbreviation) !== norm(doc.abbreviation);
  if (nameChanged || abbrChanged) {
    const active = await UOM.find({ isActive: true }).lean();
    const dup = duplicateMessage(active, { name: nameChanged ? next.name : undefined, abbreviation: abbrChanged ? next.abbreviation : undefined }, doc._id);
    if (dup) return sendError(res, dup, 409);
  }

  // First-time classification (no type yet) is always allowed — that is how the
  // existing units get set up. Changing an ALREADY-set type or base amount, or
  // deactivating, is blocked while anything uses the unit.
  const wasClassified = !!doc.type || doc.baseFactor != null;
  const typeChanged = next.type !== (doc.type || "");
  const baseChanged = next.baseFactor !== (doc.baseFactor ?? null);
  const deactivating = doc.isActive !== false && next.isActive === false;
  if ((wasClassified && (typeChanged || baseChanged)) || deactivating) {
    const usage = await usageOf(doc._id);
    if (usage.total > 0) {
      return sendError(res,
        deactivating
          ? `"${doc.name}" is used by ${usageText(usage)} and cannot be deactivated.`
          : `The type and base amount of "${doc.name}" are locked — it is used by ${usageText(usage)}. Create a new unit instead of changing this one.`,
        409);
    }
  }

  doc.name = next.name; doc.abbreviation = next.abbreviation;
  doc.type = next.type; doc.baseFactor = next.baseFactor; doc.isActive = next.isActive;
  doc.updatedBy = uid(req);
  try {
    await doc.save();
  } catch (err) {
    const msg = mapDup(err);
    if (msg) return sendError(res, msg, 409);
    throw err;
  }
  return sendSuccess(res, doc, "UOM updated.");
};

export const deleteUOM = async (req, res) => {
  const doc = await UOM.findById(req.params.id);
  if (!doc) return sendError(res, "UOM not found.", 404);
  const usage = await usageOf(doc._id);
  if (usage.total > 0) return sendError(res, `"${doc.name}" is used by ${usageText(usage)} and cannot be deleted.`, 409);
  doc.isActive = false;
  doc.updatedBy = uid(req);
  await doc.save();
  return sendSuccess(res, null, "UOM deactivated.");
};

// GET /uoms/diagnostics — read-only data-quality report.
export const getUomDiagnostics = async (req, res) => {
  const all = await UOM.find({ isActive: true }).lean();
  const pick = (u) => ({ _id: String(u._id), name: u.name, abbreviation: u.abbreviation });
  const groupBy = (keyFn) => {
    const m = new Map();
    all.forEach((u) => { const k = keyFn(u); if (!m.has(k)) m.set(k, []); m.get(k).push(u); });
    return [...m.entries()].filter(([, v]) => v.length > 1);
  };
  const duplicates = [
    ...groupBy((u) => norm(u.name)).map(([key, v]) => ({ kind: "name", key, items: v.map(pick) })),
    ...groupBy((u) => norm(u.abbreviation)).map(([key, v]) => ({ kind: "abbreviation", key, items: v.map(pick) })),
  ];
  const plan = planSeed(all);
  return sendSuccess(res, {
    total: all.length,
    unclassified: all.filter((u) => !u.type).map(pick),
    duplicates,
    missingStandard: plan.create.map((c) => c.name),
  });
};

// POST /uoms/seed  { apply?: boolean }
// Sets up the standard alcohol units (ML, Litre, Peg 30, Large Peg 60, Wine Glass,
// Bottle, Crate, Can, Keg). A PREVIEW unless apply is true — nothing is changed
// without it. Existing units are matched by name/abbreviation and only given a
// type when they have none; anything already set differently is left alone.
export const seedStandardUoms = async (req, res) => {
  const apply = req.body?.apply === true || req.query.apply === "true";
  const all = await UOM.find({ isActive: true }).lean();
  const plan = planSeed(all);

  if (apply) {
    for (const c of plan.create) {
      await UOM.create({ ...c, createdBy: uid(req), updatedBy: uid(req) });
    }
    for (const c of plan.classify) {
      const doc = await UOM.findById(c._id);
      if (!doc || doc.type) continue;
      doc.type = c.type; doc.baseFactor = c.baseFactor; doc.updatedBy = uid(req);
      await doc.save();
    }
  }
  return sendSuccess(res, { applied: apply, plan }, apply ? "Standard units set up." : "Preview only — nothing was changed.");
};