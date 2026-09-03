import { ServiceMaintenance } from "../Model/ServiceMaintainance.modal.js";
// ⚠️ ASSUMED path/export — I don't have your real Vendor.model.js this
// session to confirm it. If the actual file/export name differs
// (e.g. lowercase "vendor.model.js", or a different export name than
// `Vendor`), this is the one line to correct.
import { Vendor } from "../Model/vendor.model.js";
// ⚠️ ASSUMED path — matches the established Utils/ folder convention
// (e.g. "../Utils/Apirespondse.js") and the shared upload.js file you
// provided. Correct this import path if upload.js actually lives
// somewhere else.
import { uploadDocument, storeUploadedFile, deleteStoredFile } from "../Utils/upload.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// A separate Cloudinary folder from Checklist's "clubexpense/checklists"
// — storeUploadedFile's `folder` parameter (added when this file
// started using it) keeps these two features' uploaded files from
// ending up mixed together in the same folder.
const SERVICE_DOC_FOLDER = "clubexpense/service-maintenance";

// Multer middleware for the contract-document upload route below —
// exported so the route file can do
// `router.post('/:id/document', uploadDocument.single('document'), asyncHandler(uploadContractDocument))`,
// the same pattern Checklist's document upload route already uses.
export { uploadDocument };

// Status is always computed fresh from today's date, never stored — see
// the model's own comment for why. Priority order matters: a contract
// that's both past its end date AND overdue on its next visit shows as
// Expired, since the contract itself ending is the more fundamental
// fact.
function computeStatus(doc) {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  if (doc.contractEndDate) {
    const end = new Date(doc.contractEndDate); end.setHours(0, 0, 0, 0);
    if (end < today) return "Expired";
  }
  if (doc.nextDueDate) {
    const due = new Date(doc.nextDueDate); due.setHours(0, 0, 0, 0);
    if (due < today) return "Overdue";
    const reminderThreshold = new Date(today);
    reminderThreshold.setDate(reminderThreshold.getDate() + (doc.reminderDays ?? 15));
    if (due <= reminderThreshold) return "Due Soon";
  }
  return "Active";
}

function toRow(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  const sortedVisits = [...(obj.visits || [])].sort((a, b) => new Date(b.visitDate) - new Date(a.visitDate));
  return {
    ...obj,
    status: computeStatus(obj),
    lastServicedDate: sortedVisits[0]?.visitDate || null, // derived, not stored — always the most recent logged visit
    visits: sortedVisits, // most recent first for display
  };
}

export const createServiceMaintenance = async (req, res) => {
  const { serviceType, title, vendorId } = req.body;
  if (!serviceType) return sendError(res, "Service type is required.");
  if (!title?.trim()) return sendError(res, "Title is required.");

  let vendorName = "";
  if (vendorId) {
    const vendor = await Vendor.findById(vendorId).lean();
    if (vendor) vendorName = vendor.name;
  }

  const doc = await ServiceMaintenance.create({
    ...req.body,
    vendorName,
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  return sendSuccess(res, toRow(doc), "Service record created.", 201);
};

// GET /  ?search=&serviceType=&status=&vendorId=
// status filtering happens AFTER computing status per row (it isn't a
// stored field to query against directly) — fine at this data volume;
// revisit with a stored/cached status if this list ever grows into the
// thousands.
export const getServiceMaintenances = async (req, res) => {
  const { search, serviceType, status, vendorId } = req.query;
  const filter = { isActive: true };
  if (serviceType) filter.serviceType = serviceType;
  if (vendorId) filter.vendorId = vendorId;
  if (search) filter.$or = [
    { title: { $regex: search, $options: "i" } },
    { areaCovered: { $regex: search, $options: "i" } },
    { vendorName: { $regex: search, $options: "i" } },
  ];

  const docs = await ServiceMaintenance.find(filter).sort({ nextDueDate: 1, createdAt: -1 }).lean();
  let rows = docs.map(toRow);
  if (status) rows = rows.filter(r => r.status === status);
  return sendSuccess(res, rows);
};

export const getServiceMaintenanceById = async (req, res) => {
  const doc = await ServiceMaintenance.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Service record not found.", 404);
  return sendSuccess(res, toRow(doc));
};

export const updateServiceMaintenance = async (req, res) => {
  const doc = await ServiceMaintenance.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Service record not found.", 404);

  const { vendorId } = req.body;
  if (vendorId && vendorId !== String(doc.vendorId || "")) {
    const vendor = await Vendor.findById(vendorId).lean();
    if (vendor) req.body.vendorName = vendor.name;
  }

  Object.assign(doc, req.body);
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, toRow(doc), "Service record updated.");
};

export const deleteServiceMaintenance = async (req, res) => {
  const doc = await ServiceMaintenance.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Service record not found.", 404);
  doc.isActive = false;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, null, "Deleted.");
};

// POST /:id/visits — log a completed service visit. Advances the
// contract's nextDueDate to whatever nextServiceDate was given (if any
// — a visit can be logged without one, e.g. a final visit on a
// contract that's ending), and lastServicedDate is simply re-derived
// from the visits array afterward, never set directly here.
export const addServiceVisit = async (req, res) => {
  const { visitDate, performedBy, workDone, cost, nextServiceDate, documentUrl, remarks } = req.body;
  if (!visitDate) return sendError(res, "Visit date is required.");

  const doc = await ServiceMaintenance.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Service record not found.", 404);

  doc.visits.push({
    visitDate,
    performedBy: performedBy?.trim() || "",
    workDone: workDone?.trim() || "",
    cost: Number(cost) || 0,
    nextServiceDate: nextServiceDate || null,
    documentUrl: documentUrl?.trim() || "",
    remarks: remarks?.trim() || "",
  });
  if (nextServiceDate) doc.nextDueDate = nextServiceDate;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, toRow(doc), "Service visit logged.", 201);
};

export const deleteServiceVisit = async (req, res) => {
  const doc = await ServiceMaintenance.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Service record not found.", 404);
  doc.visits = doc.visits.filter(v => String(v._id) !== req.params.visitId);
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, toRow(doc), "Visit removed.");
};

// GET /due-soon — everything Overdue or Due Soon, across every service
// type, sorted soonest-first. Meant for a dashboard reminders widget —
// deliberately excludes Expired (a contract that's already lapsed isn't
// "due," it needs renewal, which is a different action) and Active
// (not actionable yet).
export const getDueSoonServices = async (req, res) => {
  const docs = await ServiceMaintenance.find({ isActive: true, nextDueDate: { $ne: null } })
    .sort({ nextDueDate: 1 })
    .lean();
  const rows = docs.map(toRow).filter(r => r.status === "Overdue" || r.status === "Due Soon");
  return sendSuccess(res, rows);
};

// POST /:id/document  (multipart/form-data, field name "document")
// Uploads or replaces the CONTRACT document. If one was already
// attached, the old file is deleted first (Cloudinary or local disk,
// whichever's configured) so replacing a document doesn't leave the
// superseded file orphaned in storage.
export const uploadContractDocument = async (req, res) => {
  const doc = await ServiceMaintenance.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Service record not found.", 404);
  if (!req.file) return sendError(res, "No file uploaded.");

  if (doc.documentUrl) {
    await deleteStoredFile({ documentUrl: doc.documentUrl, documentPublicId: doc.documentPublicId });
  }

  const originUrl = `${req.protocol}://${req.get("host")}`;
  const { documentUrl, documentPublicId } = await storeUploadedFile(req.file, originUrl, SERVICE_DOC_FOLDER);

  doc.documentUrl = documentUrl;
  doc.documentPublicId = documentPublicId;
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, toRow(doc), "Contract document uploaded.");
};

// DELETE /:id/document — removes the attached contract document
// without touching any other field on the record.
export const deleteContractDocument = async (req, res) => {
  const doc = await ServiceMaintenance.findOne({ _id: req.params.id, isActive: true });
  if (!doc) return sendError(res, "Service record not found.", 404);

  if (doc.documentUrl) {
    await deleteStoredFile({ documentUrl: doc.documentUrl, documentPublicId: doc.documentPublicId });
  }
  doc.documentUrl = "";
  doc.documentPublicId = "";
  doc.updatedBy = req.user?.userId ?? null;
  await doc.save();
  return sendSuccess(res, toRow(doc), "Contract document removed.");
};