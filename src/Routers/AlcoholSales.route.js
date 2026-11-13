import express from "express";
import { getSalesMeta, getSalesDay, saveSalesDay, importSales, getSalesView, getSalesReport } from "../Controller/AlcoholSalesController.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.get("/meta",    asyncHandler(getSalesMeta));     // the volume UOMs, the alcohol that can be sold, settlement modes and stewards seen so far
router.get("/view",    asyncHandler(getSalesView));     // ?level=year|month|day&year|month|date[&yearType&split&type&brand&productId]
router.get("/report",  asyncHandler(getSalesReport));   // ?from&to&groupBy=product|brand|type|day|steward|mode
router.get("/day",     asyncHandler(getSalesDay));      // ?date=YYYY-MM-DD   a day's header and lines
router.put("/day",     asyncHandler(saveSalesDay));     // { date, posTotal?, notes?, lines:[{ billNo, time, orderNo, steward, productId, uomId, qty, discPct, discAmt, settMode, amount }] }
router.post("/import", asyncHandler(importSales));      // { dryRun?, mode, rows:[ the same line, each with its date ] }

export default router;