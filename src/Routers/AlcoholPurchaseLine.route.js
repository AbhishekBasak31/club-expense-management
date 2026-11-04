import express from "express";
import { getAlcoholPurchaseLines } from "../Controller/AlcoholPurchaseLine.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.get("/", asyncHandler(getAlcoholPurchaseLines));

export default router;