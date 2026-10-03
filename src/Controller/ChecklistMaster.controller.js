import Checklist from "../Model/checklist.modal.js";
import ChecklistMaster from "../Model/ChecklistMaster.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { deleteStoredFile } from "../Utils/upload.js";

// ── Create — now accepts norms[] and createdByName ────────────────────────────
// Body: { name, category, createdByName, norms: [{ text, answerType, order? }] }
export const createChecklistMaster = async (req, res) => {
  const { name, category, createdByName, norms } = req.body;
  if (!name?.trim()) return sendError(res, "Checklist name is required.");

  const existing = await ChecklistMaster.findOne({ name: name.trim(), isActive: true });
  if (existing) return sendError(res, "A checklist with this name already exists.");

  // Validate norms array if provided.
  const normsData = [];
  if (Array.isArray(norms)) {
    for (const [i, n] of norms.entries()) {
      if (!n.text?.trim())                               return sendError(res, `Norm #${i + 1}: text is required.`);
      if (!["yes_no", "document"].includes(n.answerType)) return sendError(res, `Norm #${i + 1}: answerType must be "yes_no" or "document".`);
      normsData.push({ text: n.text.trim(), answerType: n.answerType, order: n.order ?? i });
    }
  }

  const item = await ChecklistMaster.create({
    name         : name.trim(),
    category     : category?.trim() || "",
    norms        : normsData,
    createdByName: createdByName?.trim() || "",
    updatedByName: createdByName?.trim() || "",
    createdBy    : req.user?.userId ?? null,
    updatedBy    : req.user?.userId ?? null,
  });
  return sendSuccess(res, item, "Checklist name added.", 201);
};

// ── List (unchanged filter logic, createdByName now in response naturally) ────
export const getChecklistMasters = async (req, res) => {
  const { search, active, category } = req.query;
  const filter = {};
  filter.isActive = active !== undefined ? active === "true" : true;
  if (search)   filter.name     = { $regex: search, $options: "i" };
  if (category) filter.category = category;

  const items = await ChecklistMaster.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, items);
};

export const getChecklistMasterById = async (req, res) => {
  const item = await ChecklistMaster.findById(req.params.id).lean();
  if (!item) return sendError(res, "Checklist name not found.", 404);
  return sendSuccess(res, item);
};

// ── Update — accepts norms[] and updatedByName ────────────────────────────────
export const updateChecklistMaster = async (req, res) => {
  const { name, category, updatedByName, norms } = req.body;
  if (name !== undefined && !name.trim()) return sendError(res, "Checklist name cannot be empty.");

  if (name?.trim()) {
    const dupe = await ChecklistMaster.findOne({ name: name.trim(), isActive: true, _id: { $ne: req.params.id } });
    if (dupe) return sendError(res, "A checklist with this name already exists.");
  }

  const setFields = {
    ...(name?.trim()          ? { name: name.trim() }           : {}),
    ...(category !== undefined ? { category: category.trim() }  : {}),
    ...(updatedByName          ? { updatedByName: updatedByName.trim() } : {}),
    updatedBy: req.user?.userId ?? null,
  };

  // Norms are fully replaced when provided (positional re-order is handled
  // by the frontend sending the full array in display order).
  if (Array.isArray(norms)) {
    const normsData = [];
    for (const [i, n] of norms.entries()) {
      if (!n.text?.trim())                               return sendError(res, `Norm #${i + 1}: text is required.`);
      if (!["yes_no", "document"].includes(n.answerType)) return sendError(res, `Norm #${i + 1}: answerType must be "yes_no" or "document".`);
      normsData.push({ text: n.text.trim(), answerType: n.answerType, order: n.order ?? i });
    }
    setFields.norms = normsData;
  }

  const item = await ChecklistMaster.findByIdAndUpdate(
    req.params.id,
    { $set: setFields },
    { new: true, runValidators: true }
  );
  if (!item) return sendError(res, "Checklist name not found.", 404);
  return sendSuccess(res, item, "Checklist name updated.");
};

// ── Delete — cascade unchanged ────────────────────────────────────────────────
export const deleteChecklistMaster = async (req, res) => {
  const item = await ChecklistMaster.findById(req.params.id);
  if (!item) return sendError(res, "Checklist name not found.", 404);

  const management = await Checklist.findOne({ checklistMasterId: item._id, isActive: true });
  if (management) {
    // Delete primary document
    if (management.documentUrl) {
      await deleteStoredFile({ documentUrl: management.documentUrl, documentPublicId: management.documentPublicId });
    }
    // Delete any per-norm documents
    for (const ans of management.normAnswers || []) {
      if (ans.documentUrl) {
        await deleteStoredFile({ documentUrl: ans.documentUrl, documentPublicId: ans.documentPublicId });
      }
    }
    management.isActive  = false;
    management.updatedBy = req.user?.userId ?? null;
    await management.save();
  }

  item.isActive  = false;
  item.updatedBy = req.user?.userId ?? null;
  await item.save();

  return sendSuccess(res, null, "Checklist name deleted.");
};