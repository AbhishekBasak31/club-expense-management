import express from "express";
import {
  getChecklists, getChecklistByMasterId, updateChecklist,
  uploadChecklistDocument, deleteChecklistDocument,
} from "../Controller/Checklist.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";
import { uploadDocument } from "../../src/Utils/upload.js";

const ChecklistRouter = express.Router();
ChecklistRouter.use(authenticate); // all checklist routes require login

// Row existence is fully governed by ChecklistMaster now (see
// ChecklistMaster.routes.js) — there is deliberately no POST (create)
// or DELETE (remove row) here. GET returns one merged row per active
// master item; PUT upserts that item's management fields by masterId.
ChecklistRouter.get   ("/",           asyncHandler(getChecklists));
ChecklistRouter.get   ("/:masterId",  asyncHandler(getChecklistByMasterId));
ChecklistRouter.put   ("/:masterId",  asyncHandler(updateChecklist));

// Document upload is a separate endpoint (not part of the plain PUT
// above) because it's multipart/form-data, not JSON — keeping it apart
// means the regular update route stays a simple JSON body the whole
// way through, matching every other module in this app.
ChecklistRouter.post  ("/:masterId/document", uploadDocument.single("document"), asyncHandler(uploadChecklistDocument));
ChecklistRouter.delete("/:masterId/document", asyncHandler(deleteChecklistDocument));

export default ChecklistRouter;