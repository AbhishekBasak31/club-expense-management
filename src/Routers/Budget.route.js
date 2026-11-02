import express from "express";
import {
  getBudgetAnalysis, getBudgetSuggestions, getBudgetAlerts, getRevenueHistory, saveBudgetPlan,saveBudgetSettings
} from "../Controller/Budget.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

// Fixed paths first, then the :month param route (so "settings" is never read as a month).
router.get("/analysis", asyncHandler(getBudgetAnalysis));
router.get("/suggest",  asyncHandler(getBudgetSuggestions));
router.get("/alerts",   asyncHandler(getBudgetAlerts));
router.get("/revenues", asyncHandler(getRevenueHistory));
router.put("/settings", asyncHandler(saveBudgetSettings));
router.put("/:month",   asyncHandler(saveBudgetPlan));
 
export default router;