import express from "express";
import {
  createPackage, getPackages, getPackageById, updatePackage, deletePackage,
} from "../Controller/Package.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.post  ("/",       asyncHandler(createPackage));
router.get   ("/",       asyncHandler(getPackages));
router.get   ("/:id",    asyncHandler(getPackageById));
router.put   ("/:id",    asyncHandler(updatePackage));
router.delete("/:id",    asyncHandler(deletePackage));

export default router;