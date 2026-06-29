import express from "express";
import {
  createProduct, getProducts, getProductById, updateProduct, deleteProduct,
} from "../Controller/Product.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.post  ("/",    asyncHandler(createProduct));
router.get   ("/",    asyncHandler(getProducts));
router.get   ("/:id", asyncHandler(getProductById));
router.put   ("/:id", asyncHandler(updateProduct));
router.delete("/:id", asyncHandler(deleteProduct));

export default router;