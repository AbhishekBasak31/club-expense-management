import express from "express";
import {
  createAlcoholPurchaseRequirement, getAlcoholPurchaseRequirements, getAlcoholPurchaseRequirementById,
  updateAlcoholPurchaseRequirement, deleteAlcoholPurchaseRequirement,
} from "../Controller/AlcoholpurchaseReq.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const AlcoholPurchaseRequirementRouter = express.Router();
AlcoholPurchaseRequirementRouter.use(authenticate);

AlcoholPurchaseRequirementRouter.post  ("/",    asyncHandler(createAlcoholPurchaseRequirement));
AlcoholPurchaseRequirementRouter.get   ("/",    asyncHandler(getAlcoholPurchaseRequirements));
AlcoholPurchaseRequirementRouter.get   ("/:id", asyncHandler(getAlcoholPurchaseRequirementById));
AlcoholPurchaseRequirementRouter.put   ("/:id", asyncHandler(updateAlcoholPurchaseRequirement));
AlcoholPurchaseRequirementRouter.delete("/:id", asyncHandler(deleteAlcoholPurchaseRequirement));

export default AlcoholPurchaseRequirementRouter;