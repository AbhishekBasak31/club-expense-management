import express from "express";
import {
  createCategory,
  getCategories,
  getCategoryTree,
  getSubtree,
  getCategoryById,
  updateCategory,
  deleteCategory,
  relinkToGroup,
} from "../Controller/Catagory.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.post   ("/",                    asyncHandler(createCategory));
router.get    ("/",                    asyncHandler(getCategories));
router.get    ("/tree",                asyncHandler(getCategoryTree));
router.get    ("/:id/subtree",         asyncHandler(getSubtree));
router.get    ("/:id",                 asyncHandler(getCategoryById));
router.put    ("/:id",                 asyncHandler(updateCategory));
router.delete ("/:id",                 asyncHandler(deleteCategory));
// Migration helper — links existing main categories to a group
router.post   ("/relink-to-group",     asyncHandler(relinkToGroup));

export default router;
