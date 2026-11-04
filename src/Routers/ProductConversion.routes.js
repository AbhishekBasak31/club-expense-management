import express from "express";
import {
  createConversion, getConversions, getConversionById, updateConversion, deleteConversion,
  resolveQuantity, getReadiness, bulkCreateConversions,
} from "../Controller/ProductConversion.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

// Fixed paths BEFORE /:id so they are not read as an id.
router.get ("/resolve",   asyncHandler(resolveQuantity));        // ?productId=&uomId=&qty=&servingUomId=
router.get ("/readiness", asyncHandler(getReadiness));           // ?subCategoryName=Alcohol
router.post("/bulk",      asyncHandler(bulkCreateConversions));  // { items:[…], dryRun? }

router.post  ("/",    asyncHandler(createConversion));
router.get   ("/",    asyncHandler(getConversions)); // ?productId=xxx
router.get   ("/:id", asyncHandler(getConversionById));
router.put   ("/:id", asyncHandler(updateConversion));
router.delete("/:id", asyncHandler(deleteConversion));

export default router;