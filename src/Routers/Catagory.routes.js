import express from "express";
import {
  createCategory, getCategories, getCategoryTree,
  getCategoryById, updateCategory, deleteCategory,
} from "../Controller/Catagory.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.post  ("/",     asyncHandler(createCategory));
router.get   ("/",     asyncHandler(getCategories));   // ?level=main&parentId=xxx
router.get   ("/tree", asyncHandler(getCategoryTree)); // full nested tree
router.get   ("/:id",  asyncHandler(getCategoryById));
router.put   ("/:id",  asyncHandler(updateCategory));
router.delete("/:id",  asyncHandler(deleteCategory));

export default router;