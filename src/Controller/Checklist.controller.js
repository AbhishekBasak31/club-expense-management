import Checklist from "../Model/checklist.modal.js";
import ChecklistMaster from "../Model/ChecklistMaster.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { storeUploadedFile, deleteStoredFile } from "../Utils/upload.js";

const EXPIRING_WINDOW_DAYS = 30;

// ── Status derivation (unchanged) ────────────────────────────────────────────
function deriveStatus({ dateOfValidation, documentUrl }) {
  if (!documentUrl || !dateOfValidation) return "pending";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const validTill = new Date(dateOfValidation);
  const daysLeft = Math.ceil((validTill.getTime() - today.getTime()) / 86400000);
  return daysLeft < 0 ? "expired" : daysLeft <= EXPIRING_WINDOW_DAYS ? "expiring_soon" : "valid";
}

// ── Row merger (extended with workflow fields) ────────────────────────────────
function mergeRow(master, mgmt) {
  const base = {
    _id               : String(master._id),
    checklistMasterId : String(master._id),
    checklistName     : master.name,
    category          : master.category || "",
    norms             : master.norms    || [],       // NEW: norm definitions
    dateOfEnrollment  : mgmt?.dateOfEnrollment  ?? null,
    dateOfValidation  : mgmt?.dateOfValidation  ?? null,
    concernedPerson   : mgmt?.concernedPerson   ?? "",
    email             : mgmt?.email             ?? "",
    phoneNumber       : mgmt?.phoneNumber       ?? "",
    documentName      : mgmt?.documentName      ?? "",
    documentUrl       : mgmt?.documentUrl       ?? "",
    documentPublicId  : mgmt?.documentPublicId  ?? "",
    // NEW: norm answers
    normAnswers       : mgmt?.normAnswers       ?? [],
    // NEW: workflow
    workflowStatus    : mgmt?.workflowStatus    ?? "draft",
    makerStamp        : mgmt?.makerStamp        ?? { name: "", timestamp: null, action: "" },
    checkerStamp      : mgmt?.checkerStamp      ?? { name: "", timestamp: null, verified: false },
    createdAt         : mgmt?.createdAt         ?? master.createdAt,
    updatedAt         : mgmt?.updatedAt         ?? master.updatedAt,
  };
  return { ...base, status: deriveStatus(base) };
}

// ── GET /  — list all active master items with their management data ──────────
// Query params unchanged + new: workflowStatus filter.
export const getChecklists = async (req, res) => {
  const {
    search, status, category, concernedPerson,
    validationFrom, validationTo,
    workflowStatus,   // NEW: "draft" | "under_review" | "completed"
  } = req.query;

  const masters     = await ChecklistMaster.find({ isActive: true }).sort({ name: 1 }).lean();
  const managements = await Checklist.find({ isActive: true }).lean();
  const mgmtByMId   = new Map(managements.map(m => [String(m.checklistMasterId), m]));

  let rows = masters.map(master => mergeRow(master, mgmtByMId.get(String(master._id))));

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      r.checklistName.toLowerCase().includes(q) ||
      r.concernedPerson.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.phoneNumber.toLowerCase().includes(q)
    );
  }
  if (status)          rows = rows.filter(r => r.status === status);
  if (category)        rows = rows.filter(r => r.category === category);
  if (concernedPerson) rows = rows.filter(r => r.concernedPerson === concernedPerson);
  if (workflowStatus)  rows = rows.filter(r => r.workflowStatus === workflowStatus);
  if (validationFrom)  rows = rows.filter(r => r.dateOfValidation && new Date(r.dateOfValidation) >= new Date(validationFrom));
  if (validationTo)    rows = rows.filter(r => r.dateOfValidation && new Date(r.dateOfValidation) <= new Date(validationTo));

  return sendSuccess(res, rows);
};

export const getChecklistByMasterId = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true }).lean();
  if (!master) return sendError(res, "Checklist name not found.", 404);
  const mgmt = await Checklist.findOne({ checklistMasterId: master._id, isActive: true }).lean();
  return sendSuccess(res, mergeRow(master, mgmt));
};

// ── PUT /:masterId — upsert operational fields ────────────────────────────────
// Strips document and workflow fields — those have their own endpoints.
export const updateChecklist = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true });
  if (!master) return sendError(res, "Checklist name not found.", 404);

  const {
    documentName, documentUrl, documentPublicId, checklistMasterId,
    normAnswers, workflowStatus, makerStamp, checkerStamp,
    ...safeBody
  } = req.body;

  const updated = await Checklist.findOneAndUpdate(
    { checklistMasterId: master._id },
    {
      $set      : { ...safeBody, updatedBy: req.user?.userId ?? null },
      $setOnInsert: { checklistMasterId: master._id, createdBy: req.user?.userId ?? null },
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return sendSuccess(res, mergeRow(master.toObject(), updated), "Checklist item updated.");
};

// ── PUT /:masterId/norms — save all norm answers at once ─────────────────────
// Body: { normAnswers: [{ normId, normText, answerType, yesNoValue?, ... }] }
// This does NOT change workflowStatus — that happens via /submit.
export const saveNormAnswers = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true });
  if (!master) return sendError(res, "Checklist name not found.", 404);

  const { normAnswers } = req.body;
  if (!Array.isArray(normAnswers)) return sendError(res, "normAnswers must be an array.");

  const updated = await Checklist.findOneAndUpdate(
    { checklistMasterId: master._id },
    {
      $set      : { normAnswers, updatedBy: req.user?.userId ?? null },
      $setOnInsert: { checklistMasterId: master._id, createdBy: req.user?.userId ?? null },
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return sendSuccess(res, mergeRow(master.toObject(), updated), "Norm answers saved.");
};

// ── POST /:masterId/norm-document — upload a document for a specific norm ─────
// Multipart: field "document" = the file, field "normId" = the norm's _id string.
// Frontend (Backend.ts) builds FormData with those two fields and POSTs here.
// The uploadDocument.single('document') middleware runs before this in the router.
export const uploadNormDocument = async (req, res) => {
  if (!req.file)    return sendError(res, "No file uploaded.");
  const { normId }  = req.body;
  if (!normId)      return sendError(res, "normId is required.");

  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true });
  if (!master) return sendError(res, "Checklist name not found.", 404);

  // Find the norm definition so we can snapshot normText.
  const normDef = master.norms.find(n => String(n._id) === normId);
  if (!normDef) return sendError(res, "Norm not found on this checklist.", 404);

  const existing = await Checklist.findOne({ checklistMasterId: master._id });
  const prevAnswer = existing?.normAnswers?.find(a => String(a.normId) === normId);

  const originUrl = `${req.protocol}://${req.get('host')}`;
  const stored    = await storeUploadedFile(req.file, originUrl);

  // If a previous document existed for this norm, delete it.
  if (prevAnswer?.documentUrl) {
    await deleteStoredFile({ documentUrl: prevAnswer.documentUrl, documentPublicId: prevAnswer.documentPublicId });
  }

  // Upsert the norm answer entry.
  const mgmt = await Checklist.findOneAndUpdate(
    { checklistMasterId: master._id },
    { $setOnInsert: { checklistMasterId: master._id, createdBy: req.user?.userId ?? null } },
    { new: true, upsert: true }
  );

  const idx = mgmt.normAnswers.findIndex(a => String(a.normId) === normId);
  const normAnswer = {
    normId,
    normText      : normDef.text,
    answerType    : "document",
    yesNoValue    : "",
    documentName  : stored.documentName,
    documentUrl   : stored.documentUrl,
    documentPublicId: stored.documentPublicId,
  };
  if (idx >= 0) mgmt.normAnswers[idx] = normAnswer;
  else          mgmt.normAnswers.push(normAnswer);
  mgmt.updatedBy = req.user?.userId ?? null;
  await mgmt.save();

  return sendSuccess(res, mergeRow(master.toObject(), mgmt.toObject()), "Norm document uploaded.");
};

// ── POST /:masterId/submit — maker submits for review ────────────────────────
// Body: { makerName: string }
// Sets workflowStatus → "under_review", records makerStamp with auto timestamp.
export const submitForReview = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true });
  if (!master) return sendError(res, "Checklist name not found.", 404);

  const { makerName } = req.body;
  if (!makerName?.trim()) return sendError(res, "Maker name is required.");

  const mgmt = await Checklist.findOneAndUpdate(
    { checklistMasterId: master._id },
    {
      $set: {
        workflowStatus: "under_review",
        makerStamp    : { name: makerName.trim(), timestamp: new Date(), action: "submitted" },
        // Reset checker stamp if re-submitted after a rejection (future feature)
        checkerStamp  : { name: "", timestamp: null, verified: false },
        updatedBy     : req.user?.userId ?? null,
      },
      $setOnInsert: { checklistMasterId: master._id, createdBy: req.user?.userId ?? null },
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return sendSuccess(res, mergeRow(master.toObject(), mgmt), "Submitted for review.");
};

// ── POST /:masterId/verify — checker verifies ────────────────────────────────
// Body: { checkerName: string }
// Sets workflowStatus → "completed", records checkerStamp with auto timestamp.
export const verifyChecklist = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true });
  if (!master) return sendError(res, "Checklist name not found.", 404);

  const { checkerName } = req.body;
  if (!checkerName?.trim()) return sendError(res, "Checker name is required.");

  const mgmt = await Checklist.findOne({ checklistMasterId: master._id, isActive: true });
  if (!mgmt || mgmt.workflowStatus !== "under_review") {
    return sendError(res, "Item is not currently under review.", 400);
  }

  mgmt.workflowStatus = "completed";
  mgmt.checkerStamp   = { name: checkerName.trim(), timestamp: new Date(), verified: true };
  mgmt.updatedBy      = req.user?.userId ?? null;
  await mgmt.save();

  return sendSuccess(res, mergeRow(master.toObject(), mgmt.toObject()), "Checklist verified and marked complete.");
};

// ── Primary document upload / delete (unchanged logic) ───────────────────────
export const uploadChecklistDocument = async (req, res) => {
  if (!req.file) return sendError(res, "No file uploaded. Attach a file under the 'document' field.");

  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true });
  if (!master) return sendError(res, "Checklist name not found.", 404);

  const existing = await Checklist.findOne({ checklistMasterId: master._id });
  const previous = existing?.documentUrl
    ? { documentUrl: existing.documentUrl, documentPublicId: existing.documentPublicId }
    : null;

  const originUrl = `${req.protocol}://${req.get('host')}`;
  const stored    = await storeUploadedFile(req.file, originUrl);

  const updated = await Checklist.findOneAndUpdate(
    { checklistMasterId: master._id },
    {
      $set: {
        documentName    : stored.documentName,
        documentUrl     : stored.documentUrl,
        documentPublicId: stored.documentPublicId,
        // Record maker stamp for document upload action
        makerStamp      : { name: req.body.makerName?.trim() || "", timestamp: new Date(), action: "document" },
        updatedBy       : req.user?.userId ?? null,
      },
      $setOnInsert: { checklistMasterId: master._id, createdBy: req.user?.userId ?? null },
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  if (previous) await deleteStoredFile(previous);

  return sendSuccess(res, mergeRow(master.toObject(), updated), "Document uploaded.");
};

export const deleteChecklistDocument = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true }).lean();
  if (!master) return sendError(res, "Checklist name not found.", 404);

  const mgmt = await Checklist.findOne({ checklistMasterId: master._id, isActive: true });
  if (!mgmt || !mgmt.documentUrl) return sendSuccess(res, mergeRow(master, mgmt), "No document to remove.");

  await deleteStoredFile({ documentUrl: mgmt.documentUrl, documentPublicId: mgmt.documentPublicId });
  mgmt.documentName     = "";
  mgmt.documentUrl      = "";
  mgmt.documentPublicId = "";
  mgmt.updatedBy        = req.user?.userId ?? null;
  await mgmt.save();

  return sendSuccess(res, mergeRow(master, mgmt.toObject()), "Document removed.");
};