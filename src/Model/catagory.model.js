import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// CATEGORY MODEL — 5-level hierarchy
//
//  groupHead  →  group       →  main    →  sub       →  base
//  COGS       →  Food Cost   →  Kitchen →  Non-Veg   →  Prawn
//  COGS       →  Bev Cost    →  Bar     →  Alcohol   →  Whiskey
//  OC         →  Employee    →  (none)  →  (none)    →  BOH
//  OC         →  Property    →  (none)  →  (none)    →  Outlet Rent
//
//  level enum: "groupHead" | "group" | "main" | "sub" | "base"
//
//  Parent chain enforced:
//    group's parent  → groupHead
//    main's parent   → group
//    sub's parent    → main
//    base's parent   → sub
//
//  Denormalized ancestor fields allow full-path display without joins:
//    groupHeadId / groupHeadName
//    groupId     / groupName
//    mainCategoryId   / mainCategoryName
//    subCategoryId    / subCategoryName
//
//  path[] — materialized array of ancestor ids for subtree queries
//  fullPath — "COGS › Food Cost › Kitchen › Non-Veg › Prawn"
//
//  categoryType — "standard" | "capex" (inherited from groupHead)
// ─────────────────────────────────────────────────────────────────

const CategorySchema = new mongoose.Schema(
  {
    name     : { type: String, required: true, trim: true },
    level    : {
      type     : String,
      required : true,
      enum     : ["groupHead", "group", "main", "sub", "base"],
      index    : true,
    },

    // ── Direct parent ────────────────────────────────────────────
    parentId : {
      type    : mongoose.Schema.Types.ObjectId,
      ref     : "Category",
      default : null,
      index   : true,
    },

    // ── Denormalized ancestors ───────────────────────────────────
    groupHeadId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    groupHeadName : { type: String, default: "" },   // "COGS"

    groupId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    groupName : { type: String, default: "" },       // "Food Cost"

    mainCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    mainCategoryName : { type: String, default: "" }, // "Kitchen"

    subCategoryId    : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryName  : { type: String, default: "" }, // "Non-Veg"

    // ── Materialized path (ancestor id chain, root → direct parent) ─
    // e.g. for "Prawn": [cogsId, foodCostId, kitchenId, nonVegId]
    path : [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],

    // ── Full readable path ───────────────────────────────────────
    fullPath : { type: String, default: "" },

    // ── Business fields ──────────────────────────────────────────
    // categoryType is set on groupHead and cascades down automatically.
    // "standard" = regular operating categories
    // "capex"    = capital-expenditure categories
    categoryType : {
      type    : String,
      enum    : ["standard", "capex"],
      default : "standard",
      index   : true,
    },

    // section — optional P&L tag (bar / kitchen / admin …)
    // typically set on groupHead or group, cascades down
    section : { type: String, trim: true, default: "" },

    sortOrder : { type: Number, default: 0 },
    isActive  : { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ─────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────
CategorySchema.index({ level: 1, parentId: 1 });
CategorySchema.index({ path: 1 });
CategorySchema.index({ isActive: 1 });
CategorySchema.index({ categoryType: 1, level: 1, isActive: 1 });
CategorySchema.index({ groupHeadId: 1, level: 1 });
CategorySchema.index({ groupId: 1, level: 1 });
// Unique active name per parent
CategorySchema.index(
  { parentId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// ─────────────────────────────────────────────────────────────────
// STATIC — buildLineage
// Given (level, parentId) validates the chain and returns all
// denormalized ancestor fields ready to spread onto a new doc.
// ─────────────────────────────────────────────────────────────────
CategorySchema.statics.buildLineage = async function (level, parentId) {
  const PARENT_LEVEL = {
    group    : "groupHead",
    main     : "group",
    sub      : "main",
    base     : "sub",
  };

  // groupHead has no parent
  if (level === "groupHead" || !parentId) {
    return {
      parentId: null,
      groupHeadId: null, groupHeadName: "",
      groupId: null,     groupName: "",
      mainCategoryId: null,   mainCategoryName: "",
      subCategoryId: null,    subCategoryName: "",
      path: [],
    };
  }

  const expectedParentLevel = PARENT_LEVEL[level];
  if (!expectedParentLevel) {
    throw Object.assign(new Error(`Unknown level: ${level}`), { status: 400 });
  }

  const parent = await this.findById(parentId).lean();
  if (!parent) {
    throw Object.assign(new Error("Parent category not found."), { status: 404 });
  }
  if (parent.level !== expectedParentLevel) {
    throw Object.assign(
      new Error(`A "${level}" category's parent must be a "${expectedParentLevel}" category. Got "${parent.level}".`),
      { status: 400 }
    );
  }

  const ancestorPath = [...(parent.path || []), parent._id];

  if (level === "group") {
    return {
      parentId: parent._id,
      groupHeadId: parent._id, groupHeadName: parent.name,
      groupId: null,     groupName: "",
      mainCategoryId: null,   mainCategoryName: "",
      subCategoryId: null,    subCategoryName: "",
      path: ancestorPath,
      categoryType: parent.categoryType || "standard",
      section: parent.section || "",
    };
  }

  if (level === "main") {
    return {
      parentId: parent._id,
      groupHeadId: parent.groupHeadId, groupHeadName: parent.groupHeadName,
      groupId: parent._id,   groupName: parent.name,
      mainCategoryId: null,   mainCategoryName: "",
      subCategoryId: null,    subCategoryName: "",
      path: ancestorPath,
      categoryType: parent.categoryType || "standard",
      section: parent.section || "",
    };
  }

  if (level === "sub") {
    return {
      parentId: parent._id,
      groupHeadId: parent.groupHeadId, groupHeadName: parent.groupHeadName,
      groupId: parent.groupId,         groupName: parent.groupName,
      mainCategoryId: parent._id,   mainCategoryName: parent.name,
      subCategoryId: null,           subCategoryName: "",
      path: ancestorPath,
      categoryType: parent.categoryType || "standard",
      section: parent.section || "",
    };
  }

  // base — parent is sub
  return {
    parentId: parent._id,
    groupHeadId: parent.groupHeadId, groupHeadName: parent.groupHeadName,
    groupId: parent.groupId,         groupName: parent.groupName,
    mainCategoryId: parent.mainCategoryId, mainCategoryName: parent.mainCategoryName,
    subCategoryId: parent._id,             subCategoryName: parent.name,
    path: ancestorPath,
    categoryType: parent.categoryType || "standard",
    section: parent.section || "",
  };
};

// ─────────────────────────────────────────────────────────────────
// METHOD — buildFullPath
// "COGS › Food Cost › Kitchen › Non-Veg › Prawn"
// ─────────────────────────────────────────────────────────────────
CategorySchema.methods.buildFullPath = function () {
  const parts = [
    this.groupHeadName,
    this.groupName,
    this.mainCategoryName,
    this.subCategoryName,
    this.name,
  ].filter(Boolean);
  const unique = [];
  for (const p of parts) if (unique[unique.length - 1] !== p) unique.push(p);
  return unique.join(" › ");
};

export const Category = mongoose.model("Category", CategorySchema);
export default Category;
