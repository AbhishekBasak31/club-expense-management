import express from "express";
import {
  getAlcoholStock, getAlcoholStockAlerts, getPendingReceipts, receiveStock,
  setOpeningStock, updateLevels, allocateToBar, adjustStock, getMovements,
} from "../Controller/AlcoholStock.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.get ("/",          asyncHandler(getAlcoholStock));        // ?month=YYYY-MM
router.get ("/alerts",    asyncHandler(getAlcoholStockAlerts));  // what the bell shows
router.get ("/pending",   asyncHandler(getPendingReceipts));     // purchase lines waiting to be received
router.get ("/movements", asyncHandler(getMovements));           // ?productId&from&to&location&type
router.post("/receive",   asyncHandler(receiveStock));           // { lines:[{ entryId, itemId, qty? }] }
router.post("/opening",   asyncHandler(setOpeningStock));        // { date, items:[{ productId, bottles, looseMl }] }
router.put ("/levels",    asyncHandler(updateLevels));           // { productId, min?, max?, barPar?, leadTimeDays? }
router.post("/allocate",  asyncHandler(allocateToBar));          // { productId, date, bottles?, looseMl?, remark? }
router.post("/adjust",    asyncHandler(adjustStock));            // { productId, date, direction, bottles?, looseMl?, reason }

export default router;