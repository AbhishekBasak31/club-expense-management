import { Checklist } from "../Model/checklist.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { storeUploadedFile, deleteStoredFile } from "../Utils/upload.js";
const EXPIRING_WINDOW_DAYS = 30;
 
// Status is derived here, at request time, from dateOfValidation +
// whether a document exists — never stored (see Checklist.model.js
// comment for why). Mirrors the frontend's getStatus() exactly, so a
// list from this endpoint and the frontend's own re-derivation (if it
// ever computes status client-side too, e.g. right after an edit
// before refetching) always agree.
function withStatus(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  if (!obj.documentUrl) {
    obj.status = "pending";
    return obj;
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const validTill = new Date(obj.dateOfValidation);
  const daysLeft = Math.ceil((validTill.getTime() - today.getTime()) / 86400000);
  obj.status = daysLeft < 0 ? "expired" : daysLeft <= EXPIRING_WINDOW_DAYS ? "expiring_soon" : "valid";
  return obj;
}
 
export const createChecklist = async (req, res) => {
  const { checklistName, dateOfValidation, concernedPerson } = req.body;
  if (!checklistName?.trim()) return sendError(res, "Checklist name is required.");
  if (!dateOfValidation) return sendError(res, "Date of validation is required.");
  if (!concernedPerson?.trim()) return sendError(res, "Concerned person is required.");
 
  const checklist = await Checklist.create({
    ...req.body,
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  return sendSuccess(res, withStatus(checklist), "Checklist item created.", 201);
};
 
// Query params (all optional):
//   search           — matches checklistName, concernedPerson, email, phoneNumber
//   status            — 'valid' | 'expiring_soon' | 'expired' | 'pending'
//   concernedPerson   — exact match
//   validationFrom/To — ISO date bounds on dateOfValidation
//   active            — 'true' | 'false'; defaults to true-only (unlike
//                        Employee, which shows both by default — a
//                        deleted/deactivated checklist item should not
//                        reappear in the list the way a deactivated
//                        employee still does elsewhere in this app).
export const getChecklists = async (req, res) => {
  const { search, status, concernedPerson, validationFrom, validationTo, active } = req.query;
 
  const filter = {};
  filter.isActive = active !== undefined ? active === "true" : true;
 
  if (concernedPerson) filter.concernedPerson = concernedPerson;
 
  if (validationFrom || validationTo) {
    filter.dateOfValidation = {};
    if (validationFrom) filter.dateOfValidation.$gte = new Date(validationFrom);
    if (validationTo)   filter.dateOfValidation.$lte = new Date(validationTo);
  }
 
  if (search) {
    filter.$or = [
      { checklistName:   { $regex: search, $options: "i" } },
      { concernedPerson: { $regex: search, $options: "i" } },
      { email:           { $regex: search, $options: "i" } },
      { phoneNumber:      { $regex: search, $options: "i" } },
    ];
  }
 
  let checklists = (await Checklist.find(filter).sort({ dateOfValidation: 1 }).lean()).map(withStatus);
 
  // status is derived, so it can't be filtered in the Mongo query above
  // — applied here instead, after deriving it for every row.
  if (status) checklists = checklists.filter(c => c.status === status);
 
  return sendSuccess(res, checklists);
};
 
export const getChecklistById = async (req, res) => {
  const checklist = await Checklist.findById(req.params.id).lean();
  if (!checklist) return sendError(res, "Checklist item not found.", 404);
  return sendSuccess(res, withStatus(checklist));
};
 
export const updateChecklist = async (req, res) => {
  // documentName/documentUrl/documentPublicId are only ever set via the
  // dedicated upload endpoint below, never through a plain field edit —
  // stripped here so a generic form save can't accidentally blank out
  // (or spoof) an already-uploaded document.
  const { documentName, documentUrl, documentPublicId, ...safeBody } = req.body;
 
  const checklist = await Checklist.findByIdAndUpdate(
    req.params.id,
    { $set: { ...safeBody, updatedBy: req.user?.userId ?? null } },
    { new: true, runValidators: true }
  );
  if (!checklist) return sendError(res, "Checklist item not found.", 404);
  return sendSuccess(res, withStatus(checklist), "Checklist item updated.");
};
 
// Soft delete — see Checklist.model.js for why. Also removes the stored
// document file itself (Cloudinary or local disk), since there's no
// remaining use for it once the record is deactivated.
export const deleteChecklist = async (req, res) => {
  const checklist = await Checklist.findById(req.params.id);
  if (!checklist) return sendError(res, "Checklist item not found.", 404);
 
  if (checklist.documentUrl) {
    await deleteStoredFile({ documentUrl: checklist.documentUrl, documentPublicId: checklist.documentPublicId });
  }
 
  checklist.isActive = false;
  checklist.updatedBy = req.user?.userId ?? null;
  await checklist.save();
  return sendSuccess(res, null, "Checklist item deleted.");
};
 
// POST /:id/document — multipart upload, field name "document"
// (uploadDocument.single('document') middleware runs before this in
// the router). Replaces any previously uploaded file for this item.
export const uploadChecklistDocument = async (req, res) => {
  if (!req.file) return sendError(res, "No file uploaded. Attach a file under the 'document' field.");
 
  const checklist = await Checklist.findById(req.params.id);
  if (!checklist) return sendError(res, "Checklist item not found.", 404);
 
  // Replacing an existing document — delete the old file after the new
  // one is safely stored, not before, so a failed upload never leaves
  // the record pointing at nothing.
  const previous = checklist.documentUrl
    ? { documentUrl: checklist.documentUrl, documentPublicId: checklist.documentPublicId }
    : null;
 
  // Real origin of THIS request (e.g. https://club-expense-management.onrender.com)
  // — used only by the local-disk fallback in storeUploadedFile to build
  // an absolute URL; ignored when Cloudinary is active. Never hardcoded,
  // so this is correct in every environment (local dev, Render, behind a
  // proxy) without needing a separate "what's my own public URL" env var.
  const originUrl = `${req.protocol}://${req.get('host')}`;
  const stored = await storeUploadedFile(req.file, originUrl);
  checklist.documentName = stored.documentName;
  checklist.documentUrl = stored.documentUrl;
  checklist.documentPublicId = stored.documentPublicId;
  checklist.updatedBy = req.user?.userId ?? null;
  await checklist.save();
 
  if (previous) await deleteStoredFile(previous);
 
  return sendSuccess(res, withStatus(checklist), "Document uploaded.");
};
 
// DELETE /:id/document — removes the uploaded file without deleting
// the whole checklist item, dropping its status back to "pending".
export const deleteChecklistDocument = async (req, res) => {
  const checklist = await Checklist.findById(req.params.id);
  if (!checklist) return sendError(res, "Checklist item not found.", 404);
  if (!checklist.documentUrl) return sendError(res, "This checklist item has no document to remove.");
 
  await deleteStoredFile({ documentUrl: checklist.documentUrl, documentPublicId: checklist.documentPublicId });
  checklist.documentName = "";
  checklist.documentUrl = "";
  checklist.documentPublicId = "";
  checklist.updatedBy = req.user?.userId ?? null;
  await checklist.save();
 
  return sendSuccess(res, withStatus(checklist), "Document removed.");
};