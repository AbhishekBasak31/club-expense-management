import express from "express";
import {
  getDashboard, getDeals, createDeal, updateDeal, cancelDeal, getClaims, createClaim, cancelClaim,
  createReceipt, deleteReceipt, getLedger, getIncome, getDealPurchases
} from "../Controller/AlcoholKickBack.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.get   ("/dashboard",    asyncHandler(getDashboard));    // ?asOn=YYYY-MM-DD
router.get   ("/deals",        asyncHandler(getDeals));        // ?brandId&type
router.get   ("/deals/:id/purchases", asyncHandler(getDealPurchases)); // the purchase lines counted for a target, and the other alcohol bought in its window
router.post  ("/deals",        asyncHandler(createDeal));
router.put   ("/deals/:id",    asyncHandler(updateDeal));
router.delete("/deals/:id",    asyncHandler(cancelDeal));
router.get   ("/claims",       asyncHandler(getClaims));       // ?brandId&status&from&to
router.post  ("/claims",       asyncHandler(createClaim));     // { dealId, claimDate?, invoiceNo?, gstPercent?, forced?, forceReason?, amount? }
router.delete("/claims/:id",   asyncHandler(cancelClaim));
router.post  ("/receipts",     asyncHandler(createReceipt));   // { claimId, date, amount, mode?, reference?, remark?, type?: receipt|writeoff }
router.delete("/receipts/:id", asyncHandler(deleteReceipt));
router.get   ("/ledger",       asyncHandler(getLedger));       // ?from&to[&brandId]
router.get   ("/income",       asyncHandler(getIncome));       // ?from&to — money received by month, for the P&L "Kick Back" revenue line

export default router;