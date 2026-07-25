import mongoose from "mongoose";


const TravelAllowanceSchema = new mongoose.Schema(
  {
    name     : { type: String, required: true, trim: true }, 
    amount   : { type: Number, default: 0 },                  


    maxLimit : { type: Number, default: 0 },

    mainCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryId    : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    baseCategoryId   : { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },


    mainCategoryName : { type: String, default: "" },
    subCategoryName  : { type: String, default: "" },
    baseCategoryName : { type: String, default: "" },

    isActive : { type: Boolean, default: true },
  },
  { timestamps: true }
);

TravelAllowanceSchema.index({ name: 1 });
TravelAllowanceSchema.index({ isActive: 1 });
TravelAllowanceSchema.index({ subCategoryId: 1 });

export const TravelAllowance = mongoose.model("TravelAllowance", TravelAllowanceSchema);
export default TravelAllowance;