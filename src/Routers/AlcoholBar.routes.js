import express from "express";
import { getRegister, saveDay, closeDay, reopenDay, createIssue, getIssues, getVariance, getConsumptionGrid } from "../Controller/AlcoholBar.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.get ("/register", asyncHandler(getRegister));   // ?date=YYYY-MM-DD[&tolerance=30]
router.put ("/day",      asyncHandler(saveDay));       // { date, counts:[…], outflows:[…] } — the open day's draft
router.post("/close",    asyncHandler(closeDay));      // { date, confirmNoSales? }
router.post("/reopen",   asyncHandler(reopenDay));     // { date, reason } — the latest closed day only
router.post("/issues",   asyncHandler(createIssue));   // { date, remark?, lines:[{ productId, bottles, looseMl }] }
router.get ("/issues",   asyncHandler(getIssues));     // ?from&to — the issue register
router.get ("/variance", asyncHandler(getVariance));   // ?from&to — sales vs actual use, closed days
router.get ("/consumption-grid", asyncHandler(getConsumptionGrid)); // ?view=day|month|year&from[&to] — consumption by hour / day / month

export default router;