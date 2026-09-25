import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// Package Master — a named bundle of Digital Menu items (food,
// beverage, alcohol, cloud — anything in the menu master, mixed
// freely) with a total price, built so RFPs can later pull in a
// whole package at once instead of selecting every item by hand
// each time. Each item is a snapshot of the Digital Menu item it
// came from (name/category/subCategory/dietaryType/price captured
// at the time it was added to the package), not a live reference —
// so a package's price stays stable even if a menu item's own price
// changes later, matching the same snapshot convention used for an
// RFP's selectedFoodItems/selectedBeverageItems.
// ─────────────────────────────────────────────────────────────────
const PackageItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "DigitalMenuItem", default: null },
    name: { type: String, trim: true, required: true },
    category: { type: String, trim: true, default: "" },
    subCategory: { type: String, trim: true, default: "" },
    dietaryType: { type: String, enum: ["", "Veg", "Non-Veg", "Veg / Non-Veg"], default: "" },
    price: { type: Number, default: 0, min: 0 },
    isCustomisable: { type: Boolean, default: false },
    qty: { type: Number, default: 1, min: 0 },
  },
  { _id: false }
);

const PackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    items: { type: [PackageItemSchema], default: [] },
    // Server-recalculated on every save from items (price × qty, skipping
    // Customisable items) — never trusted from the client, same
    // convention as BillingModal's saveBilling.
    totalPrice: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

PackageSchema.index({ name: 1 });

export const Package = mongoose.model("Package", PackageSchema);
export default Package;