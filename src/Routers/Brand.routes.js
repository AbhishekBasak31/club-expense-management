import express from "express";
import {
  createBrand, getBrands, getBrandById, updateBrand, deleteBrand,
} from "../Controller/Brand.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate); // all brand routes require login

router.post  ("/",    asyncHandler(createBrand));
router.get   ("/",    asyncHandler(getBrands));
router.get   ("/:id", asyncHandler(getBrandById));
router.put   ("/:id", asyncHandler(updateBrand));
router.delete("/:id", asyncHandler(deleteBrand));

export default router;