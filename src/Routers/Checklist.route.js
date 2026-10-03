import express from "express";
import multer from "multer";
import { authenticate } from "../../src/Middleware/auth.middleware.js";

import {
  getChecklists,
  getChecklistByMasterId,
  updateChecklist,
  saveNormAnswers,
  uploadNormDocument,
  uploadChecklistDocument,
  deleteChecklistDocument,
  submitForReview,
  verifyChecklist,
} from "../Controller/Checklist.controller.js";

const router = express.Router();

// multer — memory storage; the upload utility (storeUploadedFile) decides
// whether to push to Cloudinary or save to disk from the buffer.
const upload = multer({ storage: multer.memoryStorage() });

// All routes require a valid session.
router.use(authenticate);

// ── GET /api/v1/checklists
// List all active ChecklistMaster items merged with their management data.
// Query params: search, status, category, concernedPerson,
//               validationFrom, validationTo, workflowStatus
router.get("/", getChecklists);

// ── GET /api/v1/checklists/:masterId
// Single row by ChecklistMaster id.
router.get("/:masterId", getChecklistByMasterId);

// ── PUT /api/v1/checklists/:masterId
// Upsert operational fields (dates, concerned person, email, phone).
// Does NOT touch normAnswers, documents, or workflow state.
router.put("/:masterId", updateChecklist);

// ── PUT /api/v1/checklists/:masterId/norms
// Save all norm answers at once (called by Save Draft).
// Body: { normAnswers: [...] }
router.put("/:masterId/norms", saveNormAnswers);

// ── POST /api/v1/checklists/:masterId/norm-document
// Upload a document for a specific norm.
// Multipart: field "document" = file, field "normId" = norm _id string.
router.post("/:masterId/norm-document", upload.single("document"), uploadNormDocument);

// ── POST /api/v1/checklists/:masterId/document
// Upload (or replace) the primary document for a checklist item.
// Multipart: field "document" = file.
router.post("/:masterId/document", upload.single("document"), uploadChecklistDocument);

// ── DELETE /api/v1/checklists/:masterId/document
// Remove the primary document without affecting any other field.
router.delete("/:masterId/document", deleteChecklistDocument);

// ── POST /api/v1/checklists/:masterId/submit
// Maker submits for review.
// Body: { makerName: string }
// Sets workflowStatus → "under_review", records makerStamp with auto timestamp.
router.post("/:masterId/submit", submitForReview);

// ── POST /api/v1/checklists/:masterId/verify
// Checker verifies.
// Body: { checkerName: string }
// Sets workflowStatus → "completed", records checkerStamp with auto timestamp.
router.post("/:masterId/verify", verifyChecklist);

export default router;