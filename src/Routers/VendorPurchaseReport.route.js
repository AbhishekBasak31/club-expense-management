import express from "express";
import { getVendorPurchaseReport } from "../Controller/VendorPurchaseReport.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.get("/", asyncHandler(getVendorPurchaseReport));   // ?vendorId&view=month|year&from&to

export default router;