import  Checklist  from "../Model/Checklist.modal.js";
import  ChecklistMaster  from "../Model/ChecklistMaster.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { storeUploadedFile, deleteStoredFile } from "../Utils/upload.js";

const EXPIRING_WINDOW_DAYS = 30;

// Status is derived here, at request time, from dateOfValidation +
// whether a document exists — never stored (see checklist.modal.js
// comment for why). A row with no validation date yet (nothing filled
// in for this master item) is 'pending', same as one with a date but
// no uploaded document — both mean "not yet actually validated".
function deriveStatus({ dateOfValidation, documentUrl }) {
  if (!documentUrl || !dateOfValidation) return "pending";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const validTill = new Date(dateOfValidation);
  const daysLeft = Math.ceil((validTill.getTime() - today.getTime()) / 86400000);
  return daysLeft < 0 ? "expired" : daysLeft <= EXPIRING_WINDOW_DAYS ? "expiring_soon" : "valid";
}

// One row per ACTIVE ChecklistMaster item, always — even if no
// management document has ever been created for it yet (a brand-new
// checklist name shows up immediately with every field blank and
// status 'pending'). `_id` on the returned row is the MASTER item's id
// — every other endpoint here (update, document upload/delete) is
// keyed by that same masterId, not by the management document's own
// _id, so the frontend never needs to know whether a management row
// exists yet or is about to be created by this call.
function mergeRow(master, mgmt) {
  const base = {
    _id: String(master._id),
    checklistMasterId: String(master._id),
    checklistName: master.name,
    dateOfEnrollment: mgmt?.dateOfEnrollment ?? null,
    dateOfValidation: mgmt?.dateOfValidation ?? null,
    concernedPerson: mgmt?.concernedPerson ?? "",
    email: mgmt?.email ?? "",
    phoneNumber: mgmt?.phoneNumber ?? "",
    documentName: mgmt?.documentName ?? "",
    documentUrl: mgmt?.documentUrl ?? "",
    documentPublicId: mgmt?.documentPublicId ?? "",
    createdAt: mgmt?.createdAt ?? master.createdAt,
    updatedAt: mgmt?.updatedAt ?? master.updatedAt,
  };
  return { ...base, status: deriveStatus(base) };
}

// Query params (all optional):
//   search            — matches the master item's name, or concernedPerson/email/phoneNumber
//   status            — 'valid' | 'expiring_soon' | 'expired' | 'pending'
//   concernedPerson   — exact match
//   validationFrom/To — ISO date bounds on dateOfValidation
export const getChecklists = async (req, res) => {
  const { search, status, concernedPerson, validationFrom, validationTo } = req.query;

  const masters = await ChecklistMaster.find({ isActive: true }).sort({ name: 1 }).lean();
  const managements = await Checklist.find({ isActive: true }).lean();
  const mgmtByMasterId = new Map(managements.map(m => [String(m.checklistMasterId), m]));

  let rows = masters.map(master => mergeRow(master, mgmtByMasterId.get(String(master._id))));

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      r.checklistName.toLowerCase().includes(q) ||
      r.concernedPerson.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.phoneNumber.toLowerCase().includes(q)
    );
  }
  if (status) rows = rows.filter(r => r.status === status);
  if (concernedPerson) rows = rows.filter(r => r.concernedPerson === concernedPerson);
  if (validationFrom) rows = rows.filter(r => r.dateOfValidation && new Date(r.dateOfValidation) >= new Date(validationFrom));
  if (validationTo)   rows = rows.filter(r => r.dateOfValidation && new Date(r.dateOfValidation) <= new Date(validationTo));

  return sendSuccess(res, rows);
};

export const getChecklistByMasterId = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true }).lean();
  if (!master) return sendError(res, "Checklist name not found.", 404);
  const mgmt = await Checklist.findOne({ checklistMasterId: master._id, isActive: true }).lean();
  return sendSuccess(res, mergeRow(master, mgmt));
};

// PUT /:masterId — upsert. There is no separate "create" endpoint for
// management rows: the first edit to a given master item's fields is
// what brings its Checklist document into existence, via upsert. Every
// later edit updates that same document (enforced 1:1 by the unique
// index on checklistMasterId in checklist.modal.js).
export const updateChecklist = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true });
  if (!master) return sendError(res, "Checklist name not found.", 404);

  // documentName/documentUrl/documentPublicId/checklistMasterId are only
  // ever set via the dedicated upload endpoint (or this upsert's own
  // $setOnInsert below) — stripped from the body here so a plain field
  // edit can't accidentally blank out or spoof a document, or repoint
  // this row at a different master item.
  const { documentName, documentUrl, documentPublicId, checklistMasterId, ...safeBody } = req.body;

  const updated = await Checklist.findOneAndUpdate(
    { checklistMasterId: master._id },
    {
      $set: { ...safeBody, updatedBy: req.user?.userId ?? null },
      $setOnInsert: { checklistMasterId: master._id, createdBy: req.user?.userId ?? null },
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  return sendSuccess(res, mergeRow(master.toObject(), updated), "Checklist item updated.");
};

// POST /:masterId/document — multipart upload, field name "document"
// (uploadDocument.single('document') middleware runs before this in
// the router). Upserts the management row the same way updateChecklist
// does, since uploading a document is itself a valid "first edit" that
// can bring the row into existence.
export const uploadChecklistDocument = async (req, res) => {
  if (!req.file) return sendError(res, "No file uploaded. Attach a file under the 'document' field.");

  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true });
  if (!master) return sendError(res, "Checklist name not found.", 404);

  const existing = await Checklist.findOne({ checklistMasterId: master._id });
  const previous = existing?.documentUrl
    ? { documentUrl: existing.documentUrl, documentPublicId: existing.documentPublicId }
    : null;

  // Real origin of THIS request (e.g. https://club-expense-management.onrender.com)
  // — used only by the local-disk fallback in storeUploadedFile to build
  // an absolute URL; ignored when Cloudinary is active.
  const originUrl = `${req.protocol}://${req.get('host')}`;
  const stored = await storeUploadedFile(req.file, originUrl);

  const updated = await Checklist.findOneAndUpdate(
    { checklistMasterId: master._id },
    {
      $set: {
        documentName: stored.documentName,
        documentUrl: stored.documentUrl,
        documentPublicId: stored.documentPublicId,
        updatedBy: req.user?.userId ?? null,
      },
      $setOnInsert: { checklistMasterId: master._id, createdBy: req.user?.userId ?? null },
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  if (previous) await deleteStoredFile(previous);

  return sendSuccess(res, mergeRow(master.toObject(), updated), "Document uploaded.");
};

// DELETE /:masterId/document — removes the uploaded document without
// affecting any other field, reverting status to 'pending' if no
// validation date covers it. No-op (not an error) if there's nothing
// to remove — matches how deleteChecklistMaster's cascade calls this
// defensively too.
export const deleteChecklistDocument = async (req, res) => {
  const master = await ChecklistMaster.findOne({ _id: req.params.masterId, isActive: true }).lean();
  if (!master) return sendError(res, "Checklist name not found.", 404);

  const mgmt = await Checklist.findOne({ checklistMasterId: master._id, isActive: true });
  if (!mgmt || !mgmt.documentUrl) return sendSuccess(res, mergeRow(master, mgmt), "No document to remove.");

  await deleteStoredFile({ documentUrl: mgmt.documentUrl, documentPublicId: mgmt.documentPublicId });
  mgmt.documentName = "";
  mgmt.documentUrl = "";
  mgmt.documentPublicId = "";
  mgmt.updatedBy = req.user?.userId ?? null;
  await mgmt.save();

  return sendSuccess(res, mergeRow(master, mgmt.toObject()), "Document removed.");
};