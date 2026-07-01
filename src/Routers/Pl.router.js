import express from "express";
import {
  createPLStatement, getPLStatements, getPLStatementById, getPLStatementByMonth,
  updatePLStatement, patchPLRow, deletePLStatement, getPLSummary,
} from "../Controller/Pl.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

// Fixed-path routes BEFORE /:id so they're not captured as an id param
router.get   ("/summary",         asyncHandler(getPLSummary));
router.get   ("/by-month/:month", asyncHandler(getPLStatementByMonth));

router.post  ("/",        asyncHandler(createPLStatement));
router.get   ("/",        asyncHandler(getPLStatements));
router.get   ("/:id",     asyncHandler(getPLStatementById));
router.put   ("/:id",     asyncHandler(updatePLStatement));   // full replace (Edit modal)
router.patch ("/:id/row", asyncHandler(patchPLRow));          // inline row edit/delete
router.delete("/:id",     asyncHandler(deletePLStatement));

export default router;