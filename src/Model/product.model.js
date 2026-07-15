import mongoose from "mongoose";

const ProductSchema = new mongoose.Schema(
  {
    name           : { type: String, required: true, trim: true },
    productCode    : { type: String, trim: true, default: "" },

    // ── Brand — lets the same product name be tracked separately per
    // brand (e.g. two different "Whiskey" purchases from different
    // brands), so price/expense history can be told apart by brand. ──
    brandId        : { type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: null },
    brandName      : { type: String, default: "" }, // denormalized for fast display without populate

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

    purchasePrice  : { type: Number, default: 0 }, // base/list price, set manually on the product
    sellingPrice   : { type: Number, default: 0 },
    gstPercent     : { type: Number, default: 0 },

    // ── Current price — NOT set directly from the product form. Auto-synced
    // by the Expense controller whenever an expense item's description
    // matches this product's name (case-insensitive): currentPrice takes
    // that expense item's unitPrice, lastPriceDate is when that sync
    // happened. Falls back to purchasePrice on the frontend if never set. ──
    currentPrice   : { type: Number, default: null },
    lastPriceDate  : { type: Date,   default: null },

    shelfLifeDays  : { type: Number, default: null }, // shelf life in days from date of purchase/receipt
    expiryDate     : { type: Date,   default: null }, // for a specific batch/lot, if tracked
    barcode        : { type: String, trim: true, default: "" },

    reorderLevel   : { type: Number, default: 0 },
    isActive       : { type: Boolean, default: true },
  },
  { timestamps: true }
);

ProductSchema.index({ name: 1 });
ProductSchema.index({ subCategoryId: 1 });
ProductSchema.index({ brandId: 1 });
ProductSchema.index({ isActive: 1 });
ProductSchema.index({ barcode: 1 });
// compound index — allows fast filtering by type
ProductSchema.index({ expenseType: 1, isActive: 1 });

export const Product = mongoose.model("Product", ProductSchema);
export default Product;