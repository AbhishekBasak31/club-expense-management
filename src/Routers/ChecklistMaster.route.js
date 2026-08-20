import express from "express";
import {
  createChecklistMaster, getChecklistMasters, getChecklistMasterById,
  updateChecklistMaster, deleteChecklistMaster,
} from "../Controller/ChecklistMaster.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const ChecklistMasterRouter = express.Router();
ChecklistMasterRouter.use(authenticate);

ChecklistMasterRouter.post  ("/",    asyncHandler(createChecklistMaster));
ChecklistMasterRouter.get   ("/",    asyncHandler(getChecklistMasters));
ChecklistMasterRouter.get   ("/:id", asyncHandler(getChecklistMasterById));
ChecklistMasterRouter.put   ("/:id", asyncHandler(updateChecklistMaster));
ChecklistMasterRouter.delete("/:id", asyncHandler(deleteChecklistMaster));

export default ChecklistMasterRouter;