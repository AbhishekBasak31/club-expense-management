import { Category } from "../Model/catagory.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// CREATE — builds denormalized lineage + full path automatically
// ─────────────────────────────────────────────────────────────────
export const createCategory = async (req, res) => {
  const { name, level, parentId, section, sortOrder, categoryType } = req.body;

  if (!name?.trim()) return sendError(res, "Category name is required.");
  if (!["main", "sub", "base"].includes(level))
    return sendError(res, "Level must be main, sub, or base.");
  if (level !== "main" && !parentId)
    return sendError(res, `A ${level} category requires a parentId.`);

  // buildLineage validates the chain + returns denormalized fields
  const lineage = await Category.buildLineage(level, parentId);

  const category = new Category({
    name: name.trim(),
    level,
    categoryType: categoryType || "standard", // "standard" | "capex"
    sortOrder: sortOrder || 0,
    // section: explicit for main, inherited for sub/base
    section: level === "main" ? (section || "") : (lineage.section || ""),
    ...lineage,
  });

  category.fullPath = category.buildFullPath();
  await category.save();

  return sendSuccess(res, category, "Category created.", 201);
};

// ─────────────────────────────────────────────────────────────────
// LIST — filter by level, parentId, section, active, categoryType
// ─────────────────────────────────────────────────────────────────
export const getCategories = async (req, res) => {
  const { level, parentId, section, active, categoryType } = req.query; // ← categoryType added

  const filter = {};
  if (level)    filter.level    = level;
  if (parentId) filter.parentId = parentId;
  if (section)  filter.section  = section;
  if (active !== undefined) filter.isActive = active === "true";

  // ── categoryType filter ──────────────────────────────────────────
  // Old documents have no categoryType field (created before this field existed).
  // Treat missing/null categoryType as "standard" so existing data still loads correctly.
  if (categoryType === "capex") {
    filter.categoryType = "capex";
  } else if (categoryType === "standard") {
    // Match docs where categoryType is "standard" OR the field doesn't exist yet
    filter.$or = [
      { categoryType: "standard" },
      { categoryType: { $exists: false } },
      { categoryType: null },
    ];
  }
  // If categoryType is not provided at all — no filter, returns everything

  const categories = await Category.find(filter)
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return sendSuccess(res, categories);
};

// ─────────────────────────────────────────────────────────────────
// FULL TREE — main → sub → base nested
// ─────────────────────────────────────────────────────────────────
export const getCategoryTree = async (req, res) => {
  const all = await Category.find({ isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  const mains = all.filter((c) => c.level === "main");
  const tree = mains.map((main) => ({
    ...main,
    subCategories: all
      .filter((s) => s.level === "sub" && String(s.parentId) === String(main._id))
      .map((sub) => ({
        ...sub,
        baseCategories: all.filter(
          (b) => b.level === "base" && String(b.parentId) === String(sub._id)
        ),
      })),
  }));

  return sendSuccess(res, tree);
};

// ─────────────────────────────────────────────────────────────────
// SUBTREE — everything under a given category (uses path index)
// e.g. GET /categories/:id/subtree on Bar → returns Alcohol, Whiskey...
// ─────────────────────────────────────────────────────────────────
export const getSubtree = async (req, res) => {
  const descendants = await Category.find({
    path: req.params.id,
    isActive: true,
  }).sort({ level: 1, sortOrder: 1 }).lean();
  return sendSuccess(res, descendants);
};

// ─────────────────────────────────────────────────────────────────
// GET ONE
// ─────────────────────────────────────────────────────────────────
export const getCategoryById = async (req, res) => {
  const category = await Category.findById(req.params.id).lean();
  if (!category) return sendError(res, "Category not found.", 404);
  return sendSuccess(res, category);
};

// ─────────────────────────────────────────────────────────────────
// UPDATE — name/section/sortOrder only (not level or parent —
// changing those would require rebuilding the whole subtree)
// ─────────────────────────────────────────────────────────────────
export const updateCategory = async (req, res) => {
  const { name, section, sortOrder } = req.body;

  const category = await Category.findById(req.params.id);
  if (!category) return sendError(res, "Category not found.", 404);

  if (name) category.name = name.trim();
  if (sortOrder !== undefined) category.sortOrder = sortOrder;

  // If a main category's section changes, cascade to all descendants
  if (section !== undefined && category.level === "main") {
    category.section = section;
    await Category.updateMany({ path: category._id }, { section });
  }

  category.fullPath = category.buildFullPath();
  await category.save();

  // If name changed, refresh denormalized names in descendants
  if (name) {
    if (category.level === "main") {
      await Category.updateMany({ path: category._id }, { mainCategoryName: category.name });
    } else if (category.level === "sub") {
      await Category.updateMany(
        { path: category._id },
        { subCategoryName: category.name }
      );
    }
  }

  return sendSuccess(res, category, "Category updated.");
};

// ─────────────────────────────────────────────────────────────────
// DELETE (soft) — also deactivates all descendants
// ─────────────────────────────────────────────────────────────────
export const deleteCategory = async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) return sendError(res, "Category not found.", 404);

  category.isActive = false;
  await category.save();

  // Cascade soft-delete to everything underneath
  await Category.updateMany({ path: category._id }, { isActive: false });

  return sendSuccess(res, null, "Category and its sub-items deactivated.");
};