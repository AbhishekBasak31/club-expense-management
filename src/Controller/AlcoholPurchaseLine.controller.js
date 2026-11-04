import { ExpenseEntry } from "../Model/Expense.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/alcohol-purchase-lines?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Every alcohol PURCHASE LINE in the period, one row per bill line, with its
// vendor — the data behind the page's "Brand-wise purchase report". Brand and
// vendor filtering happens on the page (so a brand can be matched loosely, e.g.
// "jager" → every Jagermeister size); this only narrows by date.
//
// ASSUMPTION (flagged, not guessed silently): an item is "alcohol" when its
// Sub-category or Group is named "Alcohol" (case/space-insensitive) — the same
// rule the P&L uses to find Alcohol inside the combined "Alcohol & Beverages"
// group. Voucher and salary/allowance items are never purchases and are excluded.
//
// Date = incurredDate (the authoritative date for reports), falling back to the
// Invoice Date for older entries that have none. Dates are matched in UTC, the
// same way the other monthly reports group them. `from` and `to` are inclusive.
//
// Total price = the line's netAmount (qty × price − discount + GST — the figure
// the P&L and the purchase ledger use). Entry-level delivery charge and round-off
// belong to the bill, not to any one brand, so they are not included.
// ─────────────────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALCOHOL_RE = /^\s*alcohol\s*$/i;

export function buildAlcoholLinesPipeline(from, to) {
  const range = {};
  if (from) range.$gte = new Date(`${from}T00:00:00.000Z`);
  if (to) range.$lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 3600 * 1000); // `to` inclusive

  const match = { status: "final" };
  if (Object.keys(range).length) {
    // incurredDate when present, otherwise the invoice date
    match.$or = [{ incurredDate: range }, { incurredDate: null, date: range }];
  }

  return [
    { $match: match },
    { $unwind: "$items" },
    { $match: {
        "items.isVoucher": { $ne: true },
        "items.isAllowance": { $ne: true },
        $or: [{ "items.subCategoryName": ALCOHOL_RE }, { "items.groupName": ALCOHOL_RE }],
    }},
    { $project: {
        _id: 0,
        entryId: "$_id",
        date: { $ifNull: ["$incurredDate", "$date"] },
        invoiceDate: "$date",
        referenceNumber: 1,
        billNo: "$items.billNo",
        alcoholName: "$items.description",
        alcoholType: "$items.baseCategoryName",
        vendorId: "$items.vendorId",
        vendorName: "$items.vendorName",
        qty: "$items.qty",
        price: "$items.unitPrice",
        totalPrice: "$items.netAmount",
    }},
    { $sort: { date: 1, referenceNumber: 1, alcoholName: 1 } },
  ];
}

export const getAlcoholPurchaseLines = async (req, res) => {
  const { from, to } = req.query;
  if (from && !DATE_RE.test(from)) return sendError(res, "'from' must be a date as YYYY-MM-DD.");
  if (to && !DATE_RE.test(to)) return sendError(res, "'to' must be a date as YYYY-MM-DD.");
  if (from && to && from > to) return sendError(res, "'from' must not be after 'to'.");

  const rows = await ExpenseEntry.aggregate(buildAlcoholLinesPipeline(from, to)).allowDiskUse(true);
  return sendSuccess(res, { rows, count: rows.length });
};