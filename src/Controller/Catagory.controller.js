import { Category } from "../Model/catagory.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// CREATE
// Accepts any level: groupHead | group | main | sub | base
// Lineage (ancestors, path, fullPath) is built automatically.
// ─────────────────────────────────────────────────────────────────
export const createCategory = async (req, res) => {
  const { name, level, parentId, section, sortOrder } = req.body;

  if (!name?.trim()) return sendError(res, "Category name is required.");
  const VALID_LEVELS = ["groupHead", "group", "main", "sub", "base"];
  if (!VALID_LEVELS.includes(level))
    return sendError(res, `Level must be one of: ${VALID_LEVELS.join(", ")}.`);
  if (level !== "groupHead" && !parentId)
    return sendError(res, `A "${level}" category requires a parentId.`);

  const lineage = await Category.buildLineage(level, parentId);

  const category = new Category({
    name: name.trim(),
    level,
    sortOrder: sortOrder || 0,
    section:
      level === "groupHead" || level === "group"
        ? section || ""
        : lineage.section || "",
    ...lineage,
  });

  category.fullPath = category.buildFullPath();
  await category.save();
  return sendSuccess(res, category, "Category created.", 201);
};

// ─────────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────────
export const getCategories = async (req, res) => {
  const { level, parentId, groupHeadId, groupId, mainCategoryId, section, active } = req.query;

  const filter = {};
  if (level)          filter.level = level;
  if (parentId)       filter.parentId = parentId;
  if (groupHeadId)    filter.groupHeadId = groupHeadId;
  if (groupId)        filter.groupId = groupId;
  if (mainCategoryId) filter.mainCategoryId = mainCategoryId;
  if (section)        filter.section = section;
  if (active !== undefined) filter.isActive = active === "true";

  const categories = await Category.find(filter)
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return sendSuccess(res, categories);
};

// ─────────────────────────────────────────────────────────────────
// FULL TREE — groupHead → group → main → sub → base
// ─────────────────────────────────────────────────────────────────
export const getCategoryTree = async (req, res) => {
  const all = await Category.find({ isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  const byId = (id) => String(id);

  const tree = all
    .filter((c) => c.level === "groupHead")
    .map((gh) => ({
      ...gh,
      groups: all
        .filter((g) => g.level === "group" && byId(g.parentId) === byId(gh._id))
        .map((grp) => ({
          ...grp,
          mainCategories: all
            .filter((m) => m.level === "main" && byId(m.parentId) === byId(grp._id))
            .map((main) => ({
              ...main,
              subCategories: all
                .filter((s) => s.level === "sub" && byId(s.parentId) === byId(main._id))
                .map((sub) => ({
                  ...sub,
                  baseCategories: all.filter(
                    (b) => b.level === "base" && byId(b.parentId) === byId(sub._id)
                  ),
                })),
            })),
        })),
    }));

  return sendSuccess(res, tree);
};

// ─────────────────────────────────────────────────────────────────
// SUBTREE
// ─────────────────────────────────────────────────────────────────
export const getSubtree = async (req, res) => {
  const descendants = await Category.find({
    path: req.params.id,
    isActive: true,
  })
    .sort({ level: 1, sortOrder: 1 })
    .lean();
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
// UPDATE
// ─────────────────────────────────────────────────────────────────
export const updateCategory = async (req, res) => {
  const { name, section, sortOrder, isActive } = req.body;

  const category = await Category.findById(req.params.id);
  if (!category) return sendError(res, "Category not found.", 404);

  const oldName = category.name;
  if (name)                    category.name = name.trim();
  if (sortOrder !== undefined) category.sortOrder = sortOrder;
  if (section !== undefined)   category.section = section;
  if (isActive !== undefined)  category.isActive = isActive;

  category.fullPath = category.buildFullPath();
  await category.save();

  if (name && name.trim() !== oldName) {
    const fieldMap = {
      groupHead : { groupHeadName      : name.trim() },
      group     : { groupName          : name.trim() },
      main      : { mainCategoryName   : name.trim() },
      sub       : { subCategoryName    : name.trim() },
    };
    const updateFields = fieldMap[category.level];
    if (updateFields) {
      await Category.updateMany({ path: category._id }, updateFields);
    }
  }

  if (section !== undefined) {
    await Category.updateMany({ path: category._id }, { section });
  }

  // If deactivating, cascade to all descendants
  if (isActive === false) {
    await Category.updateMany({ path: category._id }, { isActive: false });
  }
  // If reactivating, cascade to all descendants
  if (isActive === true) {
    await Category.updateMany({ path: category._id }, { isActive: true });
  }

  return sendSuccess(res, category, "Category updated.");
};

// ─────────────────────────────────────────────────────────────────
// DELETE (soft)
// ─────────────────────────────────────────────────────────────────
export const deleteCategory = async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) return sendError(res, "Category not found.", 404);

  category.isActive = false;
  await category.save();
  await Category.updateMany({ path: category._id }, { isActive: false });

  return sendSuccess(res, null, "Category and all its descendants deactivated.");
};

// ─────────────────────────────────────────────────────────────────
// RELINK TO GROUP
//
// POST /categories/relink-to-group
// Body: { groupId: string, categoryIds: string[] }
//
// Purpose: Your existing Bar, Kitchen, Event main categories were
// created with parentId:null (old 3-level system). This endpoint
// assigns them to a Group in the new 5-level hierarchy and
// automatically cascades groupId/groupName/groupHeadId/groupHeadName
// down to ALL their existing sub and base children so you don't
// have to touch 41 base categories manually.
//
// Called by the "Link to Group" button in CategoryMaster.tsx.
// ─────────────────────────────────────────────────────────────────
export const relinkToGroup = async (req, res) => {
  const { groupId, categoryIds } = req.body;

  if (!groupId)
    return sendError(res, "groupId is required.");
  if (!Array.isArray(categoryIds) || categoryIds.length === 0)
    return sendError(res, "categoryIds must be a non-empty array.");

  // Fetch the target Group and verify it is actually a group
  const group = await Category.findById(groupId).lean();
  if (!group)
    return sendError(res, "Group not found.", 404);
  if (group.level !== "group")
    return sendError(res, "Target must be a 'group' level category.", 400);

  const results = [];

  for (const catId of categoryIds) {
    try {
      const main = await Category.findById(catId);

      if (!main) {
        results.push({ id: catId, ok: false, error: "Category not found" });
        continue;
      }
      if (main.level !== "main") {
        results.push({ id: catId, ok: false, error: `Expected level 'main', got '${main.level}'` });
        continue;
      }

      // Build the new path: ancestors of group + group itself
      const newPath = [...(group.path || []), group._id];

      // ── Update the main category document ──────────────────────
      main.parentId      = group._id;
      main.groupId       = group._id;
      main.groupName     = group.name;
      main.groupHeadId   = group.groupHeadId;
      main.groupHeadName = group.groupHeadName;
      main.path          = newPath;
      if (!main.section) main.section = group.section || "";
      main.fullPath = [group.groupHeadName, group.name, main.name]
        .filter(Boolean).join(" › ");
      await main.save();

      // ── Cascade group lineage to ALL descendants of main ───────
      // sub and base categories have main._id in their path array,
      // so we update them all in one query.
      await Category.updateMany(
        { path: main._id },
        {
          $set: {
            groupId       : group._id,
            groupName     : group.name,
            groupHeadId   : group.groupHeadId,
            groupHeadName : group.groupHeadName,
          },
        }
      );

      // ── Rebuild fullPath for sub children ──────────────────────
      const subs = await Category.find({ parentId: main._id, level: "sub" });
      for (const sub of subs) {
        sub.mainCategoryId   = main._id;
        sub.mainCategoryName = main.name;
        sub.fullPath = [group.groupHeadName, group.name, main.name, sub.name]
          .filter(Boolean).join(" › ");
        await sub.save();

        // ── Rebuild fullPath for base grandchildren ─────────────
        const bases = await Category.find({ parentId: sub._id, level: "base" });
        for (const base of bases) {
          base.mainCategoryId   = main._id;
          base.mainCategoryName = main.name;
          base.subCategoryName  = sub.name;
          base.fullPath = [group.groupHeadName, group.name, main.name, sub.name, base.name]
            .filter(Boolean).join(" › ");
          await base.save();
        }
      }

      results.push({ id: catId, name: main.name, ok: true });

    } catch (err) {
      results.push({ id: catId, ok: false, error: err.message });
    }
  }

  const allOk = results.every((r) => r.ok);
  return sendSuccess(
    res,
    results,
    allOk
      ? "All categories relinked successfully."
      : "Relink completed with some errors.",
    allOk ? 200 : 207
  );
};