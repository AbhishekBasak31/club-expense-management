import mongoose from "mongoose";

// Product conversion — defines how one unit converts to another.
// e.g. 1 Crate = 24 Bottles, 1 Bag = 50 Kg
const ProductConversionSchema = new mongoose.Schema(
  {
    productId    : { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productName  : { type: String, default: "" },

    fromUomId    : { type: mongoose.Schema.Types.ObjectId, ref: "UOM", required: true },
    fromUomName  : { type: String, default: "" },

    toUomId      : { type: mongoose.Schema.Types.ObjectId, ref: "UOM", required: true },
    toUomName    : { type: String, default: "" },

    // 1 fromUom = conversionFactor × toUom
    // e.g. 1 Crate = 24 Bottles → conversionFactor = 24
    conversionFactor : { type: Number, required: true, min: 0 },

    isActive     : { type: Boolean, default: true },
  },
  { timestamps: true }
);

ProductConversionSchema.index({ productId: 1 });

export const ProductConversion = mongoose.model("ProductConversion", ProductConversionSchema);
export default ProductConversion;