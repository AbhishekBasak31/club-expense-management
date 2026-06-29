import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// CATEGORY MODEL — 3-level hierarchy
//
//   main  →  sub  →  base
//   Bar   →  Alcohol  →  Whiskey
//   Kitchen → Vegetables → Onion
//
// Design decisions:
//   • Single collection (not 3 separate ones) — simpler, one API
//   • Denormalized parent names — display "Bar › Alcohol › Whiskey"
//     without extra lookups
//   • materialized `path` of ancestor ids — query "everything under Bar"
//     with one indexed lookup, no recursion
//   • `section` cascades down from the main category automatically
//   • unique name per parent — no two "Whiskey" under the same "Alcohol"
// ─────────────────────────────────────────────────────────────────

const CategorySchema = new mongoose.Schema(
  {
    name : { type: String, required: true, trim: true },

    // Which level this category sits at
    level : {
      type     : String,
      required : true,
      enum     : ["main", "sub", "base"],
      index    : true,
    },

    // ── Hierarchy links ──────────────────────────────────────────
    // Direct parent (null for main)
    parentId : {
      type    : mongoose.Schema.Types.ObjectId,
      ref     : "Category",
      default : null,
      index   : true,
    },

    // Denormalized lineage — so a base category knows its full ancestry
    // without populating up the chain on every read
    mainCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    mainCategoryName : { type: String, default: "" }, // "Bar"
    subCategoryId    : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryName  : { type: String, default: "" }, // "Alcohol"

    // Materialized path — array of ancestor ids (root → parent)
    // e.g. for Whiskey: [barId, alcoholId]
    // lets you query  { path: barId }  to get the whole Bar subtree
    path : [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],

    // Full readable path: "Bar › Alcohol › Whiskey" — display/search
    fullPath : { type: String, default: "" },

    // ── Business fields ──────────────────────────────────────────
    // Section for P&L grouping. Set on the main category, cascades
    // down to all its sub/base children automatically.
    // categoryType — "standard" = bar/kitchen, "capex" = capital hierarchy
    categoryType : {
      type    : String,
      enum    : ["standard", "capex"],
      default : "standard",
      index   : true,
    },

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
CategorySchema.index({ path: 1 });                  // subtree queries
CategorySchema.index({ isActive: 1 });
CategorySchema.index({ categoryType: 1, level: 1, isActive: 1 });
// Prevent duplicate active names under the same parent
CategorySchema.index(
  { parentId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// ─────────────────────────────────────────────────────────────────
// STATIC — build denormalized lineage from a parent.
// Called by the controller before creating sub/base categories.
// Also validates the level chain (sub→main, base→sub).
// ─────────────────────────────────────────────────────────────────
CategorySchema.statics.buildLineage = async function (level, parentId) {
  // main has no parent
  if (level === "main" || !parentId) {
    return {
      parentId: null, mainCategoryId: null, mainCategoryName: "",
      subCategoryId: null, subCategoryName: "", path: [],
    };
  }

  const parent = await this.findById(parentId).lean();
  if (!parent) {
    throw Object.assign(new Error("Parent category not found."), { status: 404 });
  }

  // Enforce the chain: sub's parent = main, base's parent = sub
  const expected = level === "sub" ? "main" : "sub";
  if (parent.level !== expected) {
    throw Object.assign(
      new Error(`A ${level} category's parent must be a ${expected} category.`),
      { status: 400 }
    );
  }

  if (level === "sub") {
    return {
      parentId: parent._id,
      mainCategoryId: parent._id, mainCategoryName: parent.name,
      subCategoryId: null, subCategoryName: "",
      path: [parent._id],
      section: parent.section, // inherit from main
    };
  }

  // base — parent is the sub
  return {
    parentId: parent._id,
    mainCategoryId: parent.mainCategoryId, mainCategoryName: parent.mainCategoryName,
    subCategoryId: parent._id, subCategoryName: parent.name,
    path: [...(parent.path || []), parent._id],
    section: parent.section, // inherit down the chain
  };
};

// Build readable "Bar › Alcohol › Whiskey"
CategorySchema.methods.buildFullPath = function () {
  const parts = [this.mainCategoryName, this.subCategoryName, this.name].filter(Boolean);
  const unique = [];
  for (const p of parts) if (unique[unique.length - 1] !== p) unique.push(p);
  return unique.join(" › ");
};

export const Category = mongoose.model("Category", CategorySchema);
export default Category;