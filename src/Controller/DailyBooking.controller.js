import { DailyBooking } from "../Model/DailyBooking.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// finalAmount = billedAmount - discount, floored at 0 — computed here,
// never trusted from req.body, on every create/update/bulk-create path.
// ─────────────────────────────────────────────────────────────────
const computeFinal = (billedAmount, discount) => Math.max(Number(billedAmount || 0) - Number(discount || 0), 0);

const REQUIRED_FIELDS_MSG = "Date, Guest Name, Pax, Time and Table Number are required.";
const validateRow = (body) => {
  if (!body?.date) return "Date is required.";
  if (!body?.guestName?.toString().trim()) return "Guest Name is required.";
  if (body?.pax == null || Number(body.pax) < 0) return "A valid Pax (headcount) is required.";
  if (!body?.time) return "Time is required.";
  if (body?.tableNumber == null || Number(body.tableNumber) < 0) return "A valid Table Number is required.";
  return null;
};

// ─────────────────────────────────────────────────────────────────
// POST /daily-bookings
// ─────────────────────────────────────────────────────────────────
export const createDailyBooking = async (req, res) => {
  const err = validateRow(req.body);
  if (err) return sendError(res, err);

  const { finalAmount, isActive, createdBy, updatedBy, ...body } = req.body;
  const doc = await DailyBooking.create({
    ...body,
    pax: Number(body.pax),
    tableNumber: Number(body.tableNumber),
    billedAmount: Number(body.billedAmount || 0),
    discount: Number(body.discount || 0),
    finalAmount: computeFinal(body.billedAmount, body.discount),
    createdBy: req.user?.userId ?? null,
    updatedBy: req.user?.userId ?? null,
  });
  return sendSuccess(res, doc, "Booking added.", 201);
};

// Query params: search (guest name / number / ref / steward / table),
// date (exact day), from/to (range) — all optional.
export const getDailyBookings = async (req, res) => {
  const { search, date, from, to } = req.query;
  const filter = { isActive: true };

  if (date) {
    const d = new Date(date);
    filter.date = { $gte: new Date(d.setHours(0, 0, 0, 0)), $lte: new Date(d.setHours(23, 59, 59, 999)) };
  } else if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(new Date(from).setHours(0, 0, 0, 0));
    if (to) filter.date.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
  }

  if (search) {
    const q = search.trim();
    const asNumber = Number(q);
    filter.$or = [
      { guestName: { $regex: q, $options: "i" } },
      { number: { $regex: q, $options: "i" } },
      { ref: { $regex: q, $options: "i" } },
      { stewardName: { $regex: q, $options: "i" } },
      { remark: { $regex: q, $options: "i" } },
      ...(isNaN(asNumber) ? [] : [{ tableNumber: asNumber }, { pax: asNumber }]),
    ];
  }

  const docs = await DailyBooking.find(filter).sort({ date: -1, time: -1, createdAt: -1 }).lean();
  return sendSuccess(res, docs);
};

export const getDailyBookingById = async (req, res) => {
  const doc = await DailyBooking.findOne({ _id: req.params.id, isActive: true }).lean();
  if (!doc) return sendError(res, "Booking not found.", 404);
  return sendSuccess(res, doc);
};

// PUT /daily-bookings/:id
export const updateDailyBooking = async (req, res) => {
  const existing = await DailyBooking.findOne({ _id: req.params.id, isActive: true });
  if (!existing) return sendError(res, "Booking not found.", 404);

  const err = validateRow({ ...existing.toObject(), ...req.body });
  if (err) return sendError(res, err);

  const { finalAmount, isActive, createdBy, ...safeBody } = req.body;
  const billedAmount = safeBody.billedAmount != null ? Number(safeBody.billedAmount) : existing.billedAmount;
  const discount = safeBody.discount != null ? Number(safeBody.discount) : existing.discount;

  const doc = await DailyBooking.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        ...safeBody,
        ...(safeBody.pax != null ? { pax: Number(safeBody.pax) } : {}),
        ...(safeBody.tableNumber != null ? { tableNumber: Number(safeBody.tableNumber) } : {}),
        billedAmount, discount,
        finalAmount: computeFinal(billedAmount, discount),
        updatedBy: req.user?.userId ?? null,
      },
    },
    { new: true, runValidators: true }
  );
  return sendSuccess(res, doc, "Booking updated.");
};

// DELETE /daily-bookings/:id — soft delete, same pattern as every other
// master in this codebase (isActive: false, never a hard Mongo delete).
export const deleteDailyBooking = async (req, res) => {
  const doc = await DailyBooking.findOneAndUpdate(
    { _id: req.params.id, isActive: true },
    { $set: { isActive: false, updatedBy: req.user?.userId ?? null } },
    { new: true }
  );
  if (!doc) return sendError(res, "Booking not found.", 404);
  return sendSuccess(res, null, "Booking deleted.");
};

// POST /daily-bookings/bulk  { rows: [...] } — used by the Excel import /
// multi-row add on the listing page. Each row is validated and created
// independently; a bad row never blocks the good ones — mirrors the
// per-row success/failure reporting already used for bulk product import.
export const bulkCreateDailyBookings = async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) return sendError(res, "No rows to import.");

  const created = [];
  const failed = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const err = validateRow(row);
    if (err) { failed.push({ index: i, error: err }); continue; }
    try {
      const doc = await DailyBooking.create({
        date: row.date, guestName: row.guestName, number: row.number || "",
        pax: Number(row.pax), time: row.time, tableNumber: Number(row.tableNumber),
        billedAmount: Number(row.billedAmount || 0), discount: Number(row.discount || 0),
        finalAmount: computeFinal(row.billedAmount, row.discount),
        ref: row.ref || "", stewardName: row.stewardName || "", remark: row.remark || "",
        createdBy: req.user?.userId ?? null,
        updatedBy: req.user?.userId ?? null,
      });
      created.push(doc);
    } catch (e) {
      failed.push({ index: i, error: e.message || "Could not save this row." });
    }
  }

  return sendSuccess(res, { created, failed }, `${created.length} booking(s) added${failed.length ? `, ${failed.length} failed` : ""}.`, 201);
};