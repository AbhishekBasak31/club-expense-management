import express from "express";
import {
  createConversion, getConversions, getConversionById,
  updateConversion, deleteConversion,
} from "../Controller/ProductConversion.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.post  ("/",    asyncHandler(createConversion));
router.get   ("/",    asyncHandler(getConversions)); // ?productId=xxx
router.get   ("/:id", asyncHandler(getConversionById));
router.put   ("/:id", asyncHandler(updateConversion));
router.delete("/:id", asyncHandler(deleteConversion));

export default router;