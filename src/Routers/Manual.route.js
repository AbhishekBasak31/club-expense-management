import express from "express";
import { getManualExpenses, upsertManualExpense, getManualExpenseSummary } from "../Controller/Manual.Controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.get ("/summary", asyncHandler(getManualExpenseSummary)); // before "/" so it isn't shadowed
router.get ("/",  asyncHandler(getManualExpenses));
router.post("/",  asyncHandler(upsertManualExpense));

export default router;