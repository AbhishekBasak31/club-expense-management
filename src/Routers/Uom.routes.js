import express from "express";
import { createUOM, getUOMs, getUOMById, updateUOM, deleteUOM } from "../Controller/Uom.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.post  ("/",    asyncHandler(createUOM));
router.get   ("/",    asyncHandler(getUOMs));
router.get   ("/:id", asyncHandler(getUOMById));
router.put   ("/:id", asyncHandler(updateUOM));
router.delete("/:id", asyncHandler(deleteUOM));

export default router;