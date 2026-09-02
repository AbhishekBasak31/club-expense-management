import express from "express";
import { createBreakageEntry, deleteBreakageEntry, getMonthlyBreakageReport } from "../Controller/Crockery.Breakage.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const CrockeryBreakageRouter = express.Router();
CrockeryBreakageRouter.use(authenticate);

// Before "/:id" so it isn't shadowed.
CrockeryBreakageRouter.get("/monthly", asyncHandler(getMonthlyBreakageReport));

CrockeryBreakageRouter.post  ("/",    asyncHandler(createBreakageEntry));
CrockeryBreakageRouter.delete("/:id", asyncHandler(deleteBreakageEntry));

export default CrockeryBreakageRouter;