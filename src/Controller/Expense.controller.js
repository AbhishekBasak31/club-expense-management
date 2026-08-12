import { ExpenseEntry } from "../Model/Expense.modal.js";
import { Product } from "../Model/product.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// HELPER — recalculate all amounts server-side (never trust client)
// ─────────────────────────────────────────────────────────────────
const calculateItems = (items = [], deliveryCharge = 0, roundOff = 0) => {
  const calculated = items.map((item) => {
    // ── Employee salary items compute their net salary from the
    // salaryDetails sub-fields, then that net salary becomes the item's
    // unitPrice/amount so it flows through GST/totals like any other
    // expense line (salary itself has qty=1, no GST). ──
    if (item.isAllowance && item.allowanceDetails) {
      const ad = item.allowanceDetails;
      const amount     = Number(ad.amount) || 0;
      const gstPercent = Number(ad.gstPercent) || 0;
      const gstAmount  = (amount * gstPercent) / 100;
      const netAmount  = amount + gstAmount;

      const resolvedAllowanceDetails = { ...ad, amount, gstPercent, gstAmount, netAmount };

      return {
        ...item,
        qty: 1, unitPrice: amount, discount: 0,
        amount, gstPercent, gstAmount, netAmount,
        allowanceDetails: resolvedAllowanceDetails,
      };
    }

    const qty        = Number(item.qty) || 1;
    const unitPrice   = Number(item.unitPrice) || 0;
    const gstPercent  = Number(item.gstPercent) || 0;

    const gross     = qty * unitPrice;
    // Discount is applied BEFORE GST — never let it exceed the gross amount.
    const discount  = Math.min(Number(item.discount) || 0, gross);
    const amount    = Math.max(0, gross - discount);
    const gstAmount = (amount * gstPercent) / 100;
    const netAmount = amount + gstAmount;

    return { ...item, qty, unitPrice, gstPercent, discount, amount, gstAmount, netAmount };
  });

  const subTotal       = calculated.reduce((s, i) => s + i.amount, 0);
  const totalGST        = calculated.reduce((s, i) => s + i.gstAmount, 0);
  const deliveryChargeN = Number(deliveryCharge) || 0; // flat amount, no GST applied
  const roundOffN       = Number(roundOff) || 0;       // +/- adjustment, applied last
  const grandTotal      = subTotal + totalGST + deliveryChargeN + roundOffN;

  return { calculated, subTotal, totalGST, deliveryCharge: deliveryChargeN, roundOff: roundOffN, grandTotal };
};

// Generate next reference number: EXP-00001, EXP-00002...
const nextReference = async () => {
  const count = await ExpenseEntry.countDocuments();
  return `EXP-${String(count + 1).padStart(5, "0")}`;
};

// ─────────────────────────────────────────────────────────────────
// HELPER — sync each item's price onto any matching Product's
// currentPrice. Match is by name only (case-insensitive), since expense
// items store description as free text rather than a linked productId.
// "Last save wins" — no date comparison, whatever was most recently
// saved simply overwrites currentPrice/lastPriceDate.
// Deliberately best-effort: a failure here must never block or fail the
// expense save itself, so every error is caught and swallowed.
// ─────────────────────────────────────────────────────────────────
const syncProductCurrentPrice = async (items = []) => {
  await Promise.all(
    items.map(async (item) => {
      const description = (item.description || "").trim();
      const unitPrice = Number(item.unitPrice);
      if (!description || !Number.isFinite(unitPrice)) return;
      try {
        await Product.updateMany(
          { name: { $regex: `^${description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } },
          { $set: { currentPrice: unitPrice, lastPriceDate: new Date() } }
        );
      } catch {
        // best-effort — never let a price-sync failure fail the expense save
      }
    })
  );
};

// ─────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────
export const createExpense = async (req, res) => {
  const { date, incurredDate, items, notes, status, deliveryCharge, roundOff, addedBy } = req.body;
  const entryStatus = status === "draft" ? "draft" : "final";

  if (!date) return sendError(res, "Date is required.");
  if (!Array.isArray(items) || items.length === 0)
    return sendError(res, "At least one expense item is required.");

  if (entryStatus === "draft") {
    // Drafts: only require each item to have some description text.
    if (!items.some((item) => (item.description || "").trim()))
      return sendError(res, "At least one item needs a description.");
  } else {
    // Final entries: full validation, same as before.
    for (const item of items) {
      if (!item.expenseType || !item.description || item.unitPrice == null)
        return sendError(res, "Each item needs expenseType, description and unitPrice.");
    }
  }

  const { calculated, subTotal, totalGST, deliveryCharge: dc, roundOff: ro, grandTotal } =
    calculateItems(items, deliveryCharge, roundOff);

  const entry = await ExpenseEntry.create({
    date,
    // Incurred Date falls back to the Invoice Date (date) when not
    // explicitly provided — they're usually the same day.
    incurredDate: incurredDate || date,
    status: entryStatus,
    referenceNumber: await nextReference(),
    items: calculated,
    subTotal, totalGST, deliveryCharge: dc, roundOff: ro, grandTotal,
    notes: notes || "",
    addedBy: addedBy || "",
    createdBy: req.user.userId,
  });

  // Draft entries are incomplete by definition — skip product price sync
  // until the entry is finalized, so a half-filled draft can't overwrite
  // a product's currentPrice with a placeholder/zero value.
  if (entryStatus === "final") {
    await syncProductCurrentPrice(calculated);
  }

  return sendSuccess(res, entry, entryStatus === "draft" ? "Draft saved." : "Expense entry created.", 201);
};

// ─────────────────────────────────────────────────────────────────
// LIST — with date range + expenseType filter + pagination
// ─────────────────────────────────────────────────────────────────
export const getExpenses = async (req, res) => {
  const { from, to, incurredFrom, incurredTo, expenseType, status, voucher, page = 1, limit = 50 } = req.query;
  const filter = {};

  if (from && to) {
    filter.date = { $gte: new Date(from), $lte: new Date(to) };
  }
  // Incurred Date range — separate from the Invoice Date range above and
  // combinable with it (both apply as an AND if both are set). Lets you
  // find, e.g., everything actually incurred in July regardless of what
  // date the bill/voucher itself was dated.
  if (incurredFrom && incurredTo) {
    filter.incurredDate = { $gte: new Date(incurredFrom), $lte: new Date(incurredTo) };
  }
  if (expenseType) {
    filter["items.expenseType"] = expenseType;
  }
  // Filters at the SERVER, not just client-side, which page's entries
  // this is for — the Purchase and Expense entry pages were previously
  // fetching the same mixed, unfiltered 50-per-page results and each
  // filtering down to their relevant subset in the browser, which meant
  // a page could come back with very few (or zero) entries actually
  // relevant to whichever list was asking, even though there was plenty
  // more data one scroll away. voucher=true → only entries with at least
  // one voucher item (the Expense entry page); voucher=false → only
  // entries with no voucher items (the Purchase entry page).
  if (voucher === "true") {
    filter.items = { $elemMatch: { isVoucher: true } };
  } else if (voucher === "false") {
    filter.items = { $not: { $elemMatch: { isVoucher: true } } };
  }
  // Default: only 'final' entries, so drafts don't silently appear in the
  // normal list. Pass status=draft to fetch drafts, or status=all for both.
  if (!status || status === "final") {
    filter.status = "final";
  } else if (status === "draft") {
    filter.status = "draft";
  } // status === 'all' → no status filter

  const pageNum  = Number(page);
  const limitNum = Number(limit);

  const [data, total] = await Promise.all([
    ExpenseEntry.find(filter)
      // _id as a secondary sort key matters here: MongoDB's skip/limit
      // pagination is only guaranteed stable across separate page
      // requests when the sort order is fully deterministic. Sorting by
      // date alone isn't — many entries share the exact same date value
      // (any two entries made on the same calendar day have an
      // IDENTICAL date, since it's always stored as that day's midnight),
      // so without a tiebreaker, the relative order among those can shift
      // between the page-1 and page-2 queries, silently skipping some
      // and/or duplicating others right at the page boundary.
      .sort({ date: -1, _id: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean(),
    ExpenseEntry.countDocuments(filter),
  ]);

  return sendSuccess(res, {
    data, total, page: pageNum, totalPages: Math.ceil(total / limitNum),
  });
};

// ─────────────────────────────────────────────────────────────────
// GET ONE
// ─────────────────────────────────────────────────────────────────
export const getExpenseById = async (req, res) => {
  const entry = await ExpenseEntry.findById(req.params.id).lean();
  if (!entry) return sendError(res, "Expense entry not found.", 404);
  return sendSuccess(res, entry);
};

// ─────────────────────────────────────────────────────────────────
// UPDATE — recalculates totals
// ─────────────────────────────────────────────────────────────────
export const updateExpense = async (req, res) => {
  const { date, incurredDate, items, notes, status, deliveryCharge, roundOff, addedBy } = req.body;

  const entry = await ExpenseEntry.findById(req.params.id);
  if (!entry) return sendError(res, "Expense entry not found.", 404);

  const resultingStatus = status === "draft" || status === "final" ? status : entry.status;
  const nextDeliveryCharge = deliveryCharge !== undefined ? deliveryCharge : entry.deliveryCharge;
  const nextRoundOff       = roundOff !== undefined ? roundOff : entry.roundOff;

  if (items) {
    if (resultingStatus === "final") {
      for (const item of items) {
        if (!item.expenseType || !item.description || item.unitPrice == null)
          return sendError(res, "Each item needs expenseType, description and unitPrice.");
      }
    } else if (!items.some((item) => (item.description || "").trim())) {
      return sendError(res, "At least one item needs a description.");
    }

    const { calculated, subTotal, totalGST, deliveryCharge: dc, roundOff: ro, grandTotal } =
      calculateItems(items, nextDeliveryCharge, nextRoundOff);
    entry.items = calculated;
    entry.subTotal = subTotal;
    entry.totalGST = totalGST;
    entry.deliveryCharge = dc;
    entry.roundOff = ro;
    entry.grandTotal = grandTotal;
  } else if (deliveryCharge !== undefined || roundOff !== undefined) {
    // Delivery charge / round off changed without touching items — still
    // needs to recalculate grandTotal from the existing item totals.
    const { deliveryCharge: dc, roundOff: ro, grandTotal } =
      calculateItems(entry.items, nextDeliveryCharge, nextRoundOff);
    entry.deliveryCharge = dc;
    entry.roundOff = ro;
    entry.grandTotal = grandTotal;
  }
  if (date) entry.date = date;
  if (incurredDate !== undefined) entry.incurredDate = incurredDate || date || entry.date;
  if (notes !== undefined) entry.notes = notes;
  if (addedBy !== undefined) entry.addedBy = addedBy;
  entry.status = resultingStatus;

  await entry.save();

  // Only sync product prices once the entry is (or becomes) final — a
  // draft's prices may still be placeholders.
  if (items && resultingStatus === "final") {
    await syncProductCurrentPrice(entry.items);
  }

  return sendSuccess(res, entry, resultingStatus === "draft" ? "Draft updated." : "Expense entry updated.");
};

// ─────────────────────────────────────────────────────────────────
// VERIFY — sets verificationStatus on one item within an entry.
// verifiedBy is NOT taken from the request body — until RBAC exists,
// every verification is attributed to "Admin" server-side, so a client
// can never spoof who verified something.
// ─────────────────────────────────────────────────────────────────
export const verifyExpenseItem = async (req, res) => {
  const { id, itemId } = req.params;
  const { status } = req.body; // "verified" | "rejected" | "pending"

  if (!["pending", "verified", "rejected"].includes(status)) {
    return sendError(res, "Invalid verification status.");
  }

  const entry = await ExpenseEntry.findById(id);
  if (!entry) return sendError(res, "Expense entry not found.", 404);

  const item = entry.items.id(itemId);
  if (!item) return sendError(res, "Expense item not found.", 404);

  item.verificationStatus = status;
  item.verifiedBy = status === "pending" ? "" : "Admin"; // TODO: real user once RBAC lands
  item.verifiedAt = status === "pending" ? null : new Date();

  await entry.save();
  return sendSuccess(res, entry, "Verification status updated.");
};

// ─────────────────────────────────────────────────────────────────
// DELETE (hard delete — expense entries can be removed)
// ─────────────────────────────────────────────────────────────────
export const deleteExpense = async (req, res) => {
  const entry = await ExpenseEntry.findByIdAndDelete(req.params.id);
  if (!entry) return sendError(res, "Expense entry not found.", 404);
  return sendSuccess(res, null, "Expense entry deleted.");
};

// ─────────────────────────────────────────────────────────────────
// SUMMARY — KPI totals for dashboard
// ─────────────────────────────────────────────────────────────────
export const getExpenseSummary = async (req, res) => {
  const { from, to } = req.query;
  const match = {};
  // Filters by incurredDate, not date (Invoice Date) — same reasoning as
  // getMonthlyExpenseSummary/getExpenseRegister below: this is a "which
  // period does this belong to" report, so it groups by when the
  // expense actually happened, not the date on the bill.
  if (from && to) match.incurredDate = { $gte: new Date(from), $lte: new Date(to) };

  const result = await ExpenseEntry.aggregate([
    { $match: match },
    { $group: {
        _id: null,
        totalExpense: { $sum: "$grandTotal" },
        totalGST:     { $sum: "$totalGST" },
        entryCount:   { $sum: 1 },
    }},
  ]).allowDiskUse(true);

  const summary = result[0] || { totalExpense: 0, totalGST: 0, entryCount: 0 };
  delete summary._id;
  return sendSuccess(res, summary);
};

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/expenses/totals?from=&to=&voucher=true|false
// Dedicated, pagination-INDEPENDENT totals for the stat cards on the
// Purchase entry and Expense entry pages. These used to be computed on
// the frontend by summing whatever was currently loaded into the
// paginated `entries` array — which meant the total only reflected
// however much had been scrolled into view at that moment, not the
// real total, and would show a different number on every refresh
// depending on scroll/load timing. This computes the true total
// server-side in one aggregation, entirely independent of pagination.
//
// voucher=false → Purchase entries only (mirrors isVoucherEntry() being
//   false on the frontend). voucher=true → Expense/voucher entries only.
// Omit voucher for everything combined.
// ─────────────────────────────────────────────────────────────────
export const getExpenseTotals = async (req, res) => {
  const { from, to, incurredFrom, incurredTo, voucher } = req.query;
  const match = { status: "final" };
  if (from && to) match.date = { $gte: new Date(from), $lte: new Date(to) };
  // Incurred Date range — see getExpenses for the same pattern. Used by
  // the "Monthly Purchase/Expense" cards, which scope to incurred date
  // rather than invoice date (an entry incurred in July but invoiced in
  // August should count toward July's total, not August's).
  if (incurredFrom && incurredTo) match.incurredDate = { $gte: new Date(incurredFrom), $lte: new Date(incurredTo) };

  const pipeline = [
    { $match: match },
    // An entry counts as a "voucher entry" if ANY of its items are
    // voucher items — the exact same rule the frontend's isVoucherEntry()
    // already uses, just computed here instead.
    { $addFields: {
        _isVoucherEntry: {
          $anyElementTrue: {
            $map: { input: "$items", as: "i", in: { $eq: ["$$i.isVoucher", true] } },
          },
        },
    }},
  ];
  if (voucher === "true")  pipeline.push({ $match: { _isVoucherEntry: true } });
  if (voucher === "false") pipeline.push({ $match: { _isVoucherEntry: { $ne: true } } });

  pipeline.push({
    $facet: {
      // Entry-level total (grandTotal includes delivery charge/round off,
      // which item-level netAmount doesn't) — matches exactly what "Total
      // Purchases"/"Total Expenses" has always meant.
      entryTotal: [
        { $group: { _id: null, total: { $sum: "$grandTotal" }, count: { $sum: 1 } } },
      ],
      // Item-level breakdown by expense type, for the Fixed/Variable/
      // CAPEX cards.
      byType: [
        { $unwind: "$items" },
        { $group: { _id: "$items.expenseType", total: { $sum: { $ifNull: ["$items.netAmount", 0] } } } },
      ],
    },
  });

  const [result] = await ExpenseEntry.aggregate(pipeline).allowDiskUse(true);

  const entryTotal = result?.entryTotal?.[0] || { total: 0, count: 0 };
  const byType = { fixed: 0, variable: 0, capex: 0 };
  for (const row of result?.byType || []) {
    if (byType[row._id] !== undefined) byType[row._id] = row.total;
  }

  return sendSuccess(res, {
    total: entryTotal.total,
    entryCount: entryTotal.count,
    fixed: byType.fixed,
    variable: byType.variable,
    capex: byType.capex,
  });
};

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/expenses/monthly-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns [{ month: "YYYY-MM", totalExpense }, ...] — every final
// Purchase/Expense item's netAmount (GST-inclusive), grouped by
// calendar month, computed entirely in the aggregation pipeline rather
// than shipping every individual transaction row to the frontend just
// to sum them there. from/to are optional; omit both for all-time.
// ─────────────────────────────────────────────────────────────────
export const getMonthlyExpenseSummary = async (req, res) => {
  const { from, to } = req.query;
  const match = { status: "final" };
  // Filters and groups by incurredDate, not date (Invoice Date) — an
  // entry incurred in July but invoiced in August must land in July's
  // total here, since this endpoint's whole purpose is "which month
  // does this belong to" for reporting (P&L yearly/all-time figures).
  // Requires every entry to actually have incurredDate populated — see
  // migration_backfill_incurred_date.js, which backfills it for entries
  // saved before this field existed on the schema. Matching/grouping
  // directly on incurredDate (rather than falling back to date via
  // $ifNull for entries missing it) keeps this able to use the
  // {incurredDate:-1,_id:-1} index; a fallback expression can't use an
  // index at all, which is exactly the in-memory-sort failure mode
  // already fixed once for the `date` field.
  if (from && to) match.incurredDate = { $gte: new Date(from), $lte: new Date(to) };

  // Sums grandTotal PER ENTRY, not netAmount per item. grandTotal =
  // subTotal + totalGST + deliveryCharge + roundOff — delivery charge
  // and round-off are whole-entry fields with no single item to attach
  // to, so summing at item level (the old approach) silently dropped
  // them from every month's total. No $unwind needed either, since this
  // is now a straight per-entry sum.
  const rows = await ExpenseEntry.aggregate([
    { $match: match },
    { $project: { month: { $dateToString: { format: "%Y-%m", date: "$incurredDate" } }, grandTotal: 1 } },
    { $group: { _id: "$month", totalExpense: { $sum: { $ifNull: ["$grandTotal", 0] } } } },
    { $sort: { _id: 1 } },
  ]).allowDiskUse(true);

  return sendSuccess(res, rows.map((r) => ({ month: r._id, totalExpense: r.totalExpense })));
};

// ─────────────────────────────────────────────────────────────────
// EXPENSE REGISTER REPORT
// Flattens each item into a row with entry-level context.
// Supports date range + expenseType + category filters.
// ─────────────────────────────────────────────────────────────────
export const getExpenseRegister = async (req, res) => {
  const { from, to, expenseType, status } = req.query;
  const match = {};
  // Filters by incurredDate, not date (Invoice Date) — see
  // getMonthlyExpenseSummary above for why, and
  // migration_backfill_incurred_date.js for why this can match directly
  // on incurredDate without an $ifNull fallback (which would have
  // disabled the index below).
  if (from && to) match.incurredDate = { $gte: new Date(from), $lte: new Date(to) };
  if (!status || status === "final") {
    match.status = "final";
  } else if (status === "draft") {
    match.status = "draft";
  } // status === 'all' → no status filter

  const pipeline = [
    { $match: match },
    // Sorted BEFORE unwind so this can use the existing
    // `incurredDate: -1, _id: -1` index on the collection — sorting
    // after unwind forces an in-memory sort across every individual
    // line item instead of every entry, which is what was pushing this
    // over MongoDB's default 100MB-per-stage aggregation memory limit
    // once the entry count grew into the thousands. allowDiskUse below
    // is the safety net for whatever this still doesn't cover.
    { $sort: { incurredDate: -1, _id: -1 } },
    { $unwind: "$items" },
  ];

  // filter by expenseType at item level
  if (expenseType) {
    pipeline.push({ $match: { "items.expenseType": expenseType } });
  }

  pipeline.push(
    { $project: {
        _id: 0,
        entryId:          "$_id",
        itemId:           "$items._id",
        date:             1,
        incurredDate:     1,
        referenceNumber:  1,
        status:           1,
        // Entry-level, not item-level — same value repeated on every row
        // for a given entry. The frontend must add these ONCE PER UNIQUE
        // entryId, not once per row, or it'll multiply-count them for
        // any entry with more than one item.
        deliveryCharge:   1,
        roundOff:         1,
        expenseType:      "$items.expenseType",
        groupHeadName:    "$items.groupHeadName",
        groupName:        "$items.groupName",
        categoryName:     "$items.categoryName",
        subCategoryName:  "$items.subCategoryName",
        baseCategoryName: "$items.baseCategoryName",
        description:      "$items.description",
        qty:              "$items.qty",
        unitPrice:        "$items.unitPrice",
        discount:         "$items.discount",
        amount:           "$items.amount",
        gstPercent:       "$items.gstPercent",
        gstAmount:        "$items.gstAmount",
        netAmount:        "$items.netAmount",
        hsnSac:           "$items.hsnSac",
        uomId:            "$items.uomId",
        uomName:          "$items.uomName",
        vendorName:       "$items.vendorName",
        paymentMode:      "$items.paymentMode",
        billNo:           "$items.billNo",
        remarks:          "$items.remarks",
        verificationStatus: "$items.verificationStatus",
        verifiedBy:         "$items.verifiedBy",
        isVoucher:          "$items.isVoucher",
        voucherFields:      "$items.voucherFields",
    }},
  );

  const rows = await ExpenseEntry.aggregate(pipeline).allowDiskUse(true);

  // grand totals for the report footer
  const totals = rows.reduce(
    (acc, r) => ({
      amount:    acc.amount + r.amount,
      gstAmount: acc.gstAmount + r.gstAmount,
      netAmount: acc.netAmount + r.netAmount,
    }),
    { amount: 0, gstAmount: 0, netAmount: 0 }
  );

  return sendSuccess(res, { rows, totals, count: rows.length });
};

export const getExpenseReport = async (req, res) => {
  try {
    const { startDate, endDate, category, vendor, department } = req.query;
    
    // Build the query object dynamically
    let query = {};

    // 1. Bar vs Kitchen Toggle
    if (department) {
      // Assuming 'department' is how you separate Alcohol vs Normal
      query.department = department;   
    }
 
    // 2. Date Filter — filters by incurredDate, not date (Invoice Date),
    // same as every other report endpoint in this file.
    if (startDate || endDate) {
      query.incurredDate = {};
      if (startDate) query.incurredDate.$gte = new Date(startDate);
      if (endDate) query.incurredDate.$lte = new Date(endDate);
    }

    // 3. Category & Vendor Filters
    if (category) query.category = category;
    if (vendor) query.vendor = vendor;

    // Fetch and sort (maintaining category-wise order as requested)
    const expenses = await Expense.find(query).sort({ category: 1, date: -1 });

    res.status(200).json({ success: true, data: expenses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};