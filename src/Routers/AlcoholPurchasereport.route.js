import express from "express";
import { getMonthlyAlcoholReport, getFinancialYearAlcoholReport } from "../Controller/AlcoholPurchaseReport.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const AlcoholPurchaseReportRouter = express.Router();
AlcoholPurchaseReportRouter.use(authenticate);

AlcoholPurchaseReportRouter.get("/monthly",        asyncHandler(getMonthlyAlcoholReport));
AlcoholPurchaseReportRouter.get("/financial-year",  asyncHandler(getFinancialYearAlcoholReport));

export default AlcoholPurchaseReportRouter;