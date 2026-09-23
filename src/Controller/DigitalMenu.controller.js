import { DigitalMenuItem } from "../Model/DigitalMenu.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

export const createMenuItem = async (req, res) => {
  const { category, subCategory, name, price, isCustomisable, dietaryType, description } = req.body;
  if (!category?.trim()) return sendError(res, "Category is required.");
  if (!name?.trim()) return sendError(res, "Item name is required.");

  const doc = await DigitalMenuItem.create({
    category: category.trim(),
    subCategory: (subCategory || "").trim(),
    name: name.trim(),
    price: isCustomisable ? 0 : Math.max(Number(price) || 0, 0),
    isCustomisable: !!isCustomisable,
    dietaryType: dietaryType || "",
    description: (description || "").trim(),
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  return sendSuccess(res, doc, "Menu item created.", 201);
};

// GET /?category=&subCategory=&dietaryType=&search=&active=
export const getMenuItems = async (req, res) => {
  const { category, subCategory, dietaryType, search, active } = req.query;
  const filter = {};
  filter.isActive = active === undefined ? true : active === "true";
  if (category) filter.category = category;
  if (subCategory) filter.subCategory = subCategory;
  if (dietaryType) filter.dietaryType = dietaryType;
  if (search?.trim()) {
    const re = new RegExp(search.trim(), "i");
    filter.$or = [{ name: re }, { description: re }];
  }
  const items = await DigitalMenuItem.find(filter).sort({ category: 1, subCategory: 1, name: 1 }).lean();
  return sendSuccess(res, items);
};

export const getMenuItemById = async (req, res) => {
  const doc = await DigitalMenuItem.findById(req.params.id).lean();
  if (!doc) return sendError(res, "Menu item not found.", 404);
  return sendSuccess(res, doc);
};

export const updateMenuItem = async (req, res) => {
  const { category, subCategory, name, price, isCustomisable, dietaryType, description } = req.body;
  const doc = await DigitalMenuItem.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Menu item not found.", 404);

  if (category !== undefined) doc.category = category.trim();
  if (subCategory !== undefined) doc.subCategory = (subCategory || "").trim();
  if (name !== undefined) doc.name = name.trim();
  if (isCustomisable !== undefined) doc.isCustomisable = !!isCustomisable;
  if (price !== undefined) doc.price = doc.isCustomisable ? 0 : Math.max(Number(price) || 0, 0);
  if (dietaryType !== undefined) doc.dietaryType = dietaryType || "";
  if (description !== undefined) doc.description = (description || "").trim();
  doc.updatedBy = req.user?.userId ?? null;

  await doc.save({ validateModifiedOnly: true });
  return sendSuccess(res, doc, "Menu item updated.");
};

export const deleteMenuItem = async (req, res) => {
  const doc = await DigitalMenuItem.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!doc) return sendError(res, "Menu item not found.", 404);
  return sendSuccess(res, null, "Menu item removed.");
};

// POST /bulk  { items: [{ category, subCategory, name, price, isCustomisable, dietaryType, description }] }
// Used by the Digital Menu's "Import from Excel" flow — each row is
// validated and created independently, so one bad row (missing name,
// say) never blocks the rest of a large migration from a multi-sheet
// workbook.
export const bulkImportMenuItems = async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) return sendError(res, "No menu items to import.");

  const created = [];
  const failed = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {};
    try {
      if (!it.category?.trim()) throw new Error("Category is required.");
      if (!it.name?.trim()) throw new Error("Item name is required.");
      const doc = await DigitalMenuItem.create({
        category: it.category.trim(),
        subCategory: (it.subCategory || "").trim(),
        name: it.name.trim(),
        price: it.isCustomisable ? 0 : Math.max(Number(it.price) || 0, 0),
        isCustomisable: !!it.isCustomisable,
        dietaryType: it.dietaryType || "",
        description: (it.description || "").trim(),
        createdBy: req.user?.userId ?? null,
        updatedBy: req.user?.userId ?? null,
      });
      created.push(doc);
    } catch (err) {
      failed.push({ index: i, error: err.message || "Could not create this row." });
    }
  }
  return sendSuccess(res, { created, failed }, `Imported ${created.length} of ${items.length} items.`, 201);
};