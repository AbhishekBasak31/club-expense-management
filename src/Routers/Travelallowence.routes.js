import express from "express";
import {
  createTravelAllowance, getTravelAllowances, getTravelAllowanceById,
  updateTravelAllowance, deleteTravelAllowance,
} from "../Controller/Travelallowence.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const TravelAllowanceRouter = express.Router();
TravelAllowanceRouter.use(authenticate);

TravelAllowanceRouter.post  ("/",    asyncHandler(createTravelAllowance));
TravelAllowanceRouter.get   ("/",    asyncHandler(getTravelAllowances));
TravelAllowanceRouter.get   ("/:id", asyncHandler(getTravelAllowanceById));
TravelAllowanceRouter.put   ("/:id", asyncHandler(updateTravelAllowance));
TravelAllowanceRouter.delete("/:id", asyncHandler(deleteTravelAllowance));

export default TravelAllowanceRouter; 