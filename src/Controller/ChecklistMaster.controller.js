import  ChecklistMaster  from "../Model/ChecklistMaster.modal.js";
import  Checklist  from "../Model/Checklist.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { deleteStoredFile } from "../Utils/upload.js";

export const createChecklistMaster = async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return sendError(res, "Checklist name is required.");

  const existing = await ChecklistMaster.findOne({ name: name.trim(), isActive: true });
  if (existing) return sendError(res, "A checklist with this name already exists.");

  const item = await ChecklistMaster.create({
    name: name.trim(),
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  return sendSuccess(res, item, "Checklist name added.", 201);
};

export const getChecklistMasters = async (req, res) => {
  const { search, active } = req.query;
  const filter = {};
  filter.isActive = active !== undefined ? active === "true" : true;
  if (search) filter.name = { $regex: search, $options: "i" };

  const items = await ChecklistMaster.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, items);
};

export const getChecklistMasterById = async (req, res) => {
  const item = await ChecklistMaster.findById(req.params.id).lean();
  if (!item) return sendError(res, "Checklist name not found.", 404);
  return sendSuccess(res, item);
};

export const updateChecklistMaster = async (req, res) => {
  const { name } = req.body;
  if (name !== undefined && !name.trim()) return sendError(res, "Checklist name cannot be empty.");

  if (name?.trim()) {
    const dupe = await ChecklistMaster.findOne({ name: name.trim(), isActive: true, _id: { $ne: req.params.id } });
    if (dupe) return sendError(res, "A checklist with this name already exists.");
  }

  const item = await ChecklistMaster.findByIdAndUpdate(
    req.params.id,
    { $set: { ...(name?.trim() ? { name: name.trim() } : {}), updatedBy: req.user?.userId ?? null } },
    { new: true, runValidators: true }
  );
  if (!item) return sendError(res, "Checklist name not found.", 404);
  return sendSuccess(res, item, "Checklist name updated.");
};

// Deletes (deactivates) a checklist NAME — and cascades to its
// management row, per the confirmed behavior: the linked Checklist
// Management data (dates, concerned person, uploaded document) is
// deactivated and its stored document removed at the same time, rather
// than left behind as orphaned data pointing at a name that no longer
// exists. This is the only place a management row is ever deactivated
// — the Management page itself has no delete action, by design (row
// existence is fully governed by this Master list).
export const deleteChecklistMaster = async (req, res) => {
  const item = await ChecklistMaster.findById(req.params.id);
  if (!item) return sendError(res, "Checklist name not found.", 404);

  const management = await Checklist.findOne({ checklistMasterId: item._id, isActive: true });
  if (management) {
    if (management.documentUrl) {
      await deleteStoredFile({ documentUrl: management.documentUrl, documentPublicId: management.documentPublicId });
    }
    management.isActive = false;
    management.updatedBy = req.user?.userId ?? null;
    await management.save();
  }

  item.isActive = false;
  item.updatedBy = req.user?.userId ?? null;
  await item.save();

  return sendSuccess(res, null, "Checklist name deleted.");
};