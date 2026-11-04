import mongoose from "mongoose";

// Product conversion — how a COUNT unit converts for ONE product, e.g.
//   1 Bottle = 750 ML     1 Crate = 12 Bottle     1 Bag = 50 Kg
// Volume↔volume (ML ↔ Litre ↔ Peg) is NOT stored here: it is defined once in the
// UOM master through each unit's base amount.
//
// Identity (productId / fromUomId / toUomId) is fixed once created — only the
// factor and the active flag can change, because stock quantities are interpreted
// through this row. To change a pairing, deactivate it and add a new one.
const ProductConversionSchema = new mongoose.Schema(
  {
    productId    : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName  : { type: String, default: "" },   // set by the server from productId

    fromUomId    : { type: mongoose.Schema.Types.ObjectId, ref: "UOM", required: true },
    fromUomName  : { type: String, default: "" },   // set by the server

    toUomId      : { type: mongoose.Schema.Types.ObjectId, ref: "UOM", required: true },
    toUomName    : { type: String, default: "" },   // set by the server

    // 1 fromUom = conversionFactor × toUom
    // e.g. 1 Crate = 24 Bottles → conversionFactor = 24
    conversionFactor : { type: Number, required: true, min: [0.000001, "Conversion factor must be greater than 0."] },

    isActive     : { type: Boolean, default: true },
    createdBy    : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy    : { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ProductConversionSchema.index({ productId: 1 });
// One active conversion per product and unit pair. (The controller checks first and
// answers with a readable message; this index is the backstop.)
ProductConversionSchema.index(
  { productId: 1, fromUomId: 1, toUomId: 1 },
  { name: "uniq_active_conversion", unique: true, partialFilterExpression: { isActive: true } }
);

export const ProductConversion = mongoose.model("ProductConversion", ProductConversionSchema);
export default ProductConversion;