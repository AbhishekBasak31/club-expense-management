import express from "express";
import {
  createPartyAlcoholConsumption, getPartyAlcoholConsumptions, getPartyAlcoholConsumptionById,
  updatePartyAlcoholConsumption, updateConsumption, deletePartyAlcoholConsumption,
  getAvailablePartiesForConsumption,
} from "../Controller/PartyAlcoholConsumption.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const PartyAlcoholConsumptionRouter = express.Router();
PartyAlcoholConsumptionRouter.use(authenticate);

// Before "/:id" so it isn't shadowed.
PartyAlcoholConsumptionRouter.get("/available-parties", asyncHandler(getAvailablePartiesForConsumption));

PartyAlcoholConsumptionRouter.post  ("/",               asyncHandler(createPartyAlcoholConsumption));
PartyAlcoholConsumptionRouter.get   ("/",               asyncHandler(getPartyAlcoholConsumptions));
PartyAlcoholConsumptionRouter.get   ("/:id",            asyncHandler(getPartyAlcoholConsumptionById));
PartyAlcoholConsumptionRouter.put   ("/:id",            asyncHandler(updatePartyAlcoholConsumption));
PartyAlcoholConsumptionRouter.put   ("/:id/consumption", asyncHandler(updateConsumption));
PartyAlcoholConsumptionRouter.delete("/:id",            asyncHandler(deletePartyAlcoholConsumption));

export default PartyAlcoholConsumptionRouter;