import express from "express";
import { getStockList, upsertStockEntry, getStockSummary, getConsumptionList } from "../Controller/Stock.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.get ("/summary",     asyncHandler(getStockSummary));    // before "/" so it isn't shadowed
router.get ("/consumption", asyncHandler(getConsumptionList)); // before "/" so it isn't shadowed
router.get ("/",  asyncHandler(getStockList));
router.post("/",  asyncHandler(upsertStockEntry));

export default router;