import express from "express";
import {
  createExpense, getExpenses, getExpenseById,
  updateExpense, deleteExpense, getExpenseSummary, getExpenseRegister,getExpenseReport,
  verifyExpenseItem,
} from "../Controller/Expense.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

// Reports come BEFORE /:id so they're not captured as an id param
router.get   ("/summary",  asyncHandler(getExpenseSummary));
router.get   ("/register", asyncHandler(getExpenseRegister)); // expense register report
router.get("/report",   asyncHandler(getExpenseReport));
router.post  ("/",    asyncHandler(createExpense));
router.get   ("/",    asyncHandler(getExpenses));
router.get   ("/:id", asyncHandler(getExpenseById));
router.put   ("/:id", asyncHandler(updateExpense)); 
router.delete("/:id", asyncHandler(deleteExpense));
router.patch ("/:id/items/:itemId/verify", asyncHandler(verifyExpenseItem));

export default router;