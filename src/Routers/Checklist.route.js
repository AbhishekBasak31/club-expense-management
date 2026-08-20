import express from "express";
import {
  createChecklist, getChecklists, getChecklistById, updateChecklist, deleteChecklist,
  uploadChecklistDocument, deleteChecklistDocument,
} from "../Controller/Checklist.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";
import { uploadDocument } from "../../src/Utils/upload.js";

const ChecklistRouter = express.Router();
ChecklistRouter.use(authenticate); // all checklist routes require login

ChecklistRouter.post  ("/",    asyncHandler(createChecklist));
ChecklistRouter.get   ("/",    asyncHandler(getChecklists));
ChecklistRouter.get   ("/:id", asyncHandler(getChecklistById));
ChecklistRouter.put   ("/:id", asyncHandler(updateChecklist));
ChecklistRouter.delete("/:id", asyncHandler(deleteChecklist));

// Document upload is a separate endpoint (not part of the plain PUT
// above) because it's multipart/form-data, not JSON — keeping it apart
// means the regular update route stays a simple JSON body the whole
// way through, matching every other module in this app.
ChecklistRouter.post  ("/:id/document", uploadDocument.single("document"), asyncHandler(uploadChecklistDocument));
ChecklistRouter.delete("/:id/document", asyncHandler(deleteChecklistDocument));

export default ChecklistRouter;