import mongoose from "mongoose";
import { ExpenseEntry } from "../Model/Expense.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";
import { VIEWS, MAX_DAYS, MAX_MONTHS, isRealDate, buckets, buildVendorGrid } from "../Utils/VendorPurchaseReport.js";

// GET /api/v1/vendor-purchase-report?vendorId&view=month|year&from=YYYY-MM-DD&to=YYYY-MM-DD
//   month — one column per day from..to (at most 93);  year — one column per month from..to (at most 36)
// Only FINAL purchase entries count, dated by incurredDate (else the invoice date). Vouchers and allowances are not purchases.
export const getVendorPurchaseReport = async (req, res) => {
  const { vendorId } = req.query;
  const view = String(req.query.view || "");
  const from = String(req.query.from || ""), to = String(req.query.to || "");
  if (!vendorId || !mongoose.isValidObjectId(vendorId)) return sendError(res, "Choose a vendor.");
  if (!VIEWS.includes(view)) return sendError(res, `view must be one of: ${VIEWS.join(", ")}.`);
  if (!isRealDate(from) || !isRealDate(to)) return sendError(res, "'from' and 'to' dates (YYYY-MM-DD) are required.");
  if (from > to) return sendError(res, "'from' must not be after 'to'.");
  const n = buckets(view, from, to).length;
  if (view === "month" && n > MAX_DAYS) return sendError(res, `The monthly view shows at most ${MAX_DAYS} days.`);
  if (view === "year" && n > MAX_MONTHS) return sendError(res, `The yearly view shows at most ${MAX_MONTHS} months.`);

  const range = { $gte: new Date(`${from}T00:00:00.000Z`), $lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 3600 * 1000) };
  const rows = await ExpenseEntry.aggregate([
    { $match: { status: "final", $or: [{ incurredDate: range }, { incurredDate: null, date: range }] } },
    { $unwind: "$items" },
    { $match: { "items.vendorId": new mongoose.Types.ObjectId(vendorId), "items.isVoucher": { $ne: true }, "items.isAllowance": { $ne: true } } },
    { $project: { _id: 0, date: { $ifNull: ["$incurredDate", "$date"] }, vendorName: "$items.vendorName", description: "$items.description", uom: "$items.uomName", qty: "$items.qty", unitPrice: "$items.unitPrice", amount: "$items.netAmount" } },
  ]).allowDiskUse(true);

  const grid = buildVendorGrid({ view, from, to, lines: rows });
  return sendSuccess(res, { vendorId, vendorName: rows[0]?.vendorName || "", view, from, to, ...grid });
};