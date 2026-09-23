import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// Digital Menu — the master list of every food/spirit/beverage item
// the club serves, organized the same two-level way the real printed
// menu is: a top-level Category (Food, Bar, Cocktail Chronicles, Zero
// A.B.V, Aerated Beverage, Energy Zone, ...) and, for categories that
// have one, a Sub-Category underneath it (e.g. Food → "Salad &
// Greens", "Signature Sushi Roll"; Bar → "Blended Scotch", "Vodka").
// Not every category has sub-categories — Zero A.B.V, Aerated
// Beverage and Energy Zone are flat lists — so subCategory is
// optional, not required.
//
// This is the source list packages are built FROM (Package Master)
// and, downstream, what an RFP's menu selection ultimately points
// back to — so name/category/price here are the single source of
// truth for both, not duplicated data entered again at either of
// those later stages.
// ─────────────────────────────────────────────────────────────────
const DigitalMenuItemSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true },
    subCategory: { type: String, trim: true, default: "" },
    name: { type: String, required: true, trim: true },

    // Some items on the real menu are priced "Customisable" (varies by
    // what the guest picks) rather than a fixed number — isCustomisable
    // flags that; price stays 0 and is ignored for those, never treated
    // as "free".
    price: { type: Number, default: 0, min: 0 },
    isCustomisable: { type: Boolean, default: false },

    // Only meaningful for food items — the real menu has no dietary
    // classification for spirits/cocktails/beverages, so this is "" for
    // those rather than a forced default that would be misleading.
    dietaryType: { type: String, enum: ["", "Veg", "Non-Veg", "Veg / Non-Veg"], default: "" },

    description: { type: String, trim: true, default: "" },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

DigitalMenuItemSchema.index({ category: 1, subCategory: 1, name: 1 });
DigitalMenuItemSchema.index({ name: "text", description: "text" });

export const DigitalMenuItem = mongoose.model("DigitalMenuItem", DigitalMenuItemSchema);
export default DigitalMenuItem;