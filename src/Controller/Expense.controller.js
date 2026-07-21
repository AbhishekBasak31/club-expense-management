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
    if (item.isSalary && item.salaryDetails) {
      const sd = item.salaryDetails;
      const baseSalary = Number(sd.baseSalary) || 0;
      const pfPercent  = Number(sd.pfPercent) || 0;
      const hraPercent = Number(sd.hraPercent) || 0;
      const pfAmount   = (baseSalary * pfPercent) / 100;
      const hraAmount  = (baseSalary * hraPercent) / 100;

      const daAmount = sd.daType === "percent"
        ? (baseSalary * (Number(sd.daValue) || 0)) / 100
        : (Number(sd.daValue) || 0);

      const incentiveAmount = sd.incentiveType === "percent"
        ? (baseSalary * (Number(sd.incentiveValue) || 0)) / 100
        : (Number(sd.incentiveValue) || 0);

      const travelAllowanceAmount = Number(sd.travelAllowanceAmount) || 0;

      const netSalary = baseSalary + hraAmount + daAmount + travelAllowanceAmount + incentiveAmount - pfAmount;

      const resolvedSalaryDetails = {
        ...sd, baseSalary, pfPercent, pfAmount, hraPercent, hraAmount,
        daAmount, travelAllowanceAmount, incentiveAmount, netSalary,
      };

      return {
        ...item,
        qty: 1, unitPrice: netSalary, discount: 0,
        amount: netSalary, gstPercent: 0, gstAmount: 0, netAmount: netSalary,
        salaryDetails: resolvedSalaryDetails,
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
  const { date, items, notes, status, deliveryCharge, roundOff } = req.body;
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
    status: entryStatus,
    referenceNumber: await nextReference(),
    items: calculated,
    subTotal, totalGST, deliveryCharge: dc, roundOff: ro, grandTotal,
    notes: notes || "",
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
  const { from, to, expenseType, status, page = 1, limit = 50 } = req.query;
  const filter = {};

  if (from && to) {
    filter.date = { $gte: new Date(from), $lte: new Date(to) };
  }
  if (expenseType) {
    filter["items.expenseType"] = expenseType;
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
      .sort({ date: -1 })
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
  const { date, items, notes, status, deliveryCharge, roundOff } = req.body;

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
  if (notes !== undefined) entry.notes = notes;
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
  if (from && to) match.date = { $gte: new Date(from), $lte: new Date(to) };

  const result = await ExpenseEntry.aggregate([
    { $match: match },
    { $group: {
        _id: null,
        totalExpense: { $sum: "$grandTotal" },
        totalGST:     { $sum: "$totalGST" },
        entryCount:   { $sum: 1 },
    }},
  ]);

  const summary = result[0] || { totalExpense: 0, totalGST: 0, entryCount: 0 };
  delete summary._id;
  return sendSuccess(res, summary);
};

// ─────────────────────────────────────────────────────────────────
// EXPENSE REGISTER REPORT
// Flattens each item into a row with entry-level context.
// Supports date range + expenseType + category filters.
// ─────────────────────────────────────────────────────────────────
export const getExpenseRegister = async (req, res) => {
  const { from, to, expenseType, status } = req.query;
  const match = {};
  if (from && to) match.date = { $gte: new Date(from), $lte: new Date(to) };
  if (!status || status === "final") {
    match.status = "final";
  } else if (status === "draft") {
    match.status = "draft";
  } // status === 'all' → no status filter

  const pipeline = [
    { $match: match },
    { $unwind: "$items" },
  ];

  // filter by expenseType at item level
  if (expenseType) {
    pipeline.push({ $match: { "items.expenseType": expenseType } });
  }

  pipeline.push(
    { $sort: { date: -1 } },
    { $project: {
        _id: 0,
        entryId:          "$_id",
        itemId:           "$items._id",
        date:             1,
        referenceNumber:  1,
        status:           1,
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
    }},
  );

  const rows = await ExpenseEntry.aggregate(pipeline);

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

    // 2. Date Filter
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
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