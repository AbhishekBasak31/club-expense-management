import express from "express";
import {
  createUOM, getUOMs, getUOMById, updateUOM, deleteUOM, getUomDiagnostics, seedStandardUoms,
} from "../Controller/Uom.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

// Fixed paths BEFORE /:id so they are not read as an id.
router.get   ("/diagnostics", asyncHandler(getUomDiagnostics));
router.post  ("/seed",        asyncHandler(seedStandardUoms)); // preview unless { apply: true }

router.post  ("/",    asyncHandler(createUOM));
router.get   ("/",    asyncHandler(getUOMs));
router.get   ("/:id", asyncHandler(getUOMById));
router.put   ("/:id", asyncHandler(updateUOM));
router.delete("/:id", asyncHandler(deleteUOM));

export default router;