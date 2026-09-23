import express from "express";
import {
  createMenuItem, getMenuItems, getMenuItemById, updateMenuItem, deleteMenuItem, bulkImportMenuItems,
} from "../Controller/DigitalMenu.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.post  ("/",       asyncHandler(createMenuItem));
router.post  ("/bulk",   asyncHandler(bulkImportMenuItems));
router.get   ("/",       asyncHandler(getMenuItems));
router.get   ("/:id",    asyncHandler(getMenuItemById));
router.put   ("/:id",    asyncHandler(updateMenuItem));
router.delete("/:id",    asyncHandler(deleteMenuItem));

export default router;