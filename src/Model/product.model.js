import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema(
  {
    name           : { type: String, required: true, trim: true },
    productCode    : { type: String, trim: true, default: "" },
    
    // 👉 NEW: HSN Code for tax classification
    hsnCode        : { type: String, trim: true, default: "" },

    // ── NEW — what kind of product this is ───────────────────────────
    // "inventory" = bar/kitchen stock (Whiskey, Chicken)
    // "variable"  = variable expense consumable (Dettol, Tissue Paper)
    // "capital"   = CAPEX asset (Ice Machine, POS System, Chair)
    // Defaults to "inventory" so all existing records are unaffected
    expenseType : {
      type    : String,
      enum    : ["inventory", "variable", "capital"],
      default : "inventory",
      index   : true,
    },

    // Links to category hierarchy
    mainCategoryId : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryId  : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    baseCategoryId : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },

    // denormalized names for fast display without populate
    mainCategoryName : { type: String, default: "" },
    subCategoryName  : { type: String, default: "" },

    uomId          : { type: mongoose.Schema.Types.ObjectId, ref: "UOM", default: null },
    uomName        : { type: String, default: "" },

    purchasePrice  : { type: Number, default: 0 },
    sellingPrice   : { type: Number, default: 0 },
    gstPercent     : { type: Number, default: 0 },

    reorderLevel   : { type: Number, default: 0 },
    isActive       : { type: Boolean, default: true },
  },
  { timestamps: true }
);

ProductSchema.index({ name: 1 });
ProductSchema.index({ subCategoryId: 1 });
ProductSchema.index({ isActive: 1 });
// compound index — allows fast filtering by type
ProductSchema.index({ expenseType: 1, isActive: 1 });

export const Product = mongoose.model("Product", ProductSchema);
export default Product;