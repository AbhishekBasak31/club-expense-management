import { Package } from "../Model/PackageMaster.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// Total price = sum(price × qty) across items, skipping Customisable
// ones (their price is meaningless until the actual qty is known, same
// rule as an RFP's package-rate calculation and Cloud's billing-time
// pricing) — never trusted from the client, recomputed here every time.
const computeTotal = (items) => (items || []).reduce((s, it) => s + (it.isCustomisable ? 0 : (Number(it.price) || 0) * (Number(it.qty) || 0)), 0);

const sanitizeItems = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .filter(it => it?.name?.trim())
    .map(it => ({
      menuItemId: it.menuItemId || null,
      name: it.name.trim(),
      category: (it.category || "").trim(),
      subCategory: (it.subCategory || "").trim(),
      dietaryType: it.dietaryType || "",
      price: Math.max(Number(it.price) || 0, 0),
      isCustomisable: !!it.isCustomisable,
      qty: Math.max(Number(it.qty) || 1, 0),
    }));
};

export const createPackage = async (req, res) => {
  const { name, description, items } = req.body;
  if (!name?.trim()) return sendError(res, "Package name is required.");
  const cleanItems = sanitizeItems(items);
  if (cleanItems.length === 0) return sendError(res, "A package needs at least one item.");

  const doc = await Package.create({
    name: name.trim(),
    description: (description || "").trim(),
    items: cleanItems,
    totalPrice: computeTotal(cleanItems),
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  return sendSuccess(res, doc, "Package created.", 201);
};

// GET /?search=&active=
export const getPackages = async (req, res) => {
  const { search, active } = req.query;
  const filter = {};
  filter.isActive = active === undefined ? true : active === "true";
  if (search?.trim()) {
    const re = new RegExp(search.trim(), "i");
    filter.$or = [{ name: re }, { description: re }, { "items.name": re }];
  }
  const packages = await Package.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, packages);
};

export const getPackageById = async (req, res) => {
  const doc = await Package.findById(req.params.id).lean();
  if (!doc) return sendError(res, "Package not found.", 404);
  return sendSuccess(res, doc);
};

export const updatePackage = async (req, res) => {
  const { name, description, items } = req.body;
  const doc = await Package.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Package not found.", 404);

  if (name !== undefined) {
    if (!name.trim()) return sendError(res, "Package name is required.");
    doc.name = name.trim();
  }
  if (description !== undefined) doc.description = (description || "").trim();
  if (items !== undefined) {
    const cleanItems = sanitizeItems(items);
    if (cleanItems.length === 0) return sendError(res, "A package needs at least one item.");
    doc.items = cleanItems;
    doc.totalPrice = computeTotal(cleanItems);
  }
  doc.updatedBy = req.user?.userId ?? null;

  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "Package updated.");
};

export const deletePackage = async (req, res) => {
  const doc = await Package.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!doc) return sendError(res, "Package not found.", 404);
  return sendSuccess(res, null, "Package removed.");
};