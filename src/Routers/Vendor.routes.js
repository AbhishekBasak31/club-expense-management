import express from "express";
import {
  createVendor, getVendors, getVendorById, updateVendor, deleteVendor,
} from "../Controller/Vendor.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate); // all vendor routes require login

router.post  ("/",    asyncHandler(createVendor));
router.get   ("/",    asyncHandler(getVendors));
router.get   ("/:id", asyncHandler(getVendorById));
router.put   ("/:id", asyncHandler(updateVendor));
router.delete("/:id", asyncHandler(deleteVendor));

export default router;