import { PLStatement } from "../Model/Pl.model.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ─────────────────────────────────────────────────────────────────
// HELPERS — server-side totals (never trust client-computed sums)
// ─────────────────────────────────────────────────────────────────
const groupTotal = (g) => (g.items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
const sideTotal  = (groups = []) => groups.reduce((s, g) => s + groupTotal(g), 0);

// Strips any client-sent totals and re-derives them, so the response
// always reflects the real sum of item amounts.
const withTotals = (stmt) => {
  const plain = stmt.toObject ? stmt.toObject() : stmt;
  const expenses = (plain.expenses || []).map((g) => ({ ...g, total: groupTotal(g) }));
  const revenues = (plain.revenues || []).map((g) => ({ ...g, total: groupTotal(g) }));
  const totalExpenses = sideTotal(expenses);
  const totalRevenue  = sideTotal(revenues);
  return {
    ...plain,
    expenses,
    revenues,
    totalExpenses,
    totalRevenue,
    netPL: totalRevenue - totalExpenses,
  };
};

// Validates + sanitizes an incoming group array — strips anything
// that isn't label/expandable/items, coerces amount to a number,
// and drops empty labels.
const sanitizeGroups = (groups = [], sideName) => {
  if (!Array.isArray(groups)) {
    throw Object.assign(new Error(`${sideName} must be an array of groups.`), { status: 400 });
  }
  return groups.map((g) => {
    if (!g.label?.trim()) {
      throw Object.assign(new Error(`Every ${sideName} group needs a label.`), { status: 400 });
    }
    const items = Array.isArray(g.items) ? g.items : [];
    return {
      label: g.label.trim(),
      expandable: g.expandable !== false,
      items: items.map((it) => {
        if (!it.label?.trim()) {
          throw Object.assign(new Error(`Every ${sideName} item needs a label.`), { status: 400 });
        }
        return { label: it.label.trim(), amount: Number(it.amount) || 0 };
      }),
    };
  });
};

// ─────────────────────────────────────────────────────────────────
// CREATE — one statement per month (month is unique)
// ─────────────────────────────────────────────────────────────────
export const createPLStatement = async (req, res) => {
  const { month, expenses, revenues, notes } = req.body;

  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return sendError(res, "A valid month (YYYY-MM) is required.");
  }

  const existing = await PLStatement.findOne({ month }).lean();
  if (existing) {
    return sendError(res, `A P&L statement for ${month} already exists.`, 409);
  }

  const stmt = await PLStatement.create({
    month,
    expenses: sanitizeGroups(expenses, "expense"),
    revenues: sanitizeGroups(revenues, "revenue"),
    notes: notes || "",
    createdBy: req.user.userId,
    updatedBy: req.user.userId,
  });

  return sendSuccess(res, withTotals(stmt), "P&L statement created.", 201);
};

// ─────────────────────────────────────────────────────────────────
// LIST — all periods, newest month first (used for the Period tabs)
// ─────────────────────────────────────────────────────────────────
export const getPLStatements = async (req, res) => {
  const stmts = await PLStatement.find().sort({ month: -1 });
  return sendSuccess(res, stmts.map(withTotals));
};

// ─────────────────────────────────────────────────────────────────
// GET ONE — by id
// ─────────────────────────────────────────────────────────────────
export const getPLStatementById = async (req, res) => {
  const stmt = await PLStatement.findById(req.params.id);
  if (!stmt) return sendError(res, "P&L statement not found.", 404);
  return sendSuccess(res, withTotals(stmt));
};

// ─────────────────────────────────────────────────────────────────
// GET BY MONTH — convenience lookup, e.g. /api/v1/pl-statements/by-month/2026-07
// ─────────────────────────────────────────────────────────────────
export const getPLStatementByMonth = async (req, res) => {
  const stmt = await PLStatement.findOne({ month: req.params.month });
  if (!stmt) return sendError(res, `No P&L statement found for ${req.params.month}.`, 404);
  return sendSuccess(res, withTotals(stmt));
};

// ─────────────────────────────────────────────────────────────────
// UPDATE — full replace of expenses/revenues (used by the "Edit"
// modal which sends the whole statement back)
// ─────────────────────────────────────────────────────────────────
export const updatePLStatement = async (req, res) => {
  const { month, expenses, revenues, notes } = req.body;

  const stmt = await PLStatement.findById(req.params.id);
  if (!stmt) return sendError(res, "P&L statement not found.", 404);

  if (month && month !== stmt.month) {
    const clash = await PLStatement.findOne({ month, _id: { $ne: stmt._id } }).lean();
    if (clash) return sendError(res, `A P&L statement for ${month} already exists.`, 409);
    stmt.month = month;
  }

  if (expenses !== undefined) stmt.expenses = sanitizeGroups(expenses, "expense");
  if (revenues !== undefined) stmt.revenues = sanitizeGroups(revenues, "revenue");
  if (notes !== undefined) stmt.notes = notes;
  stmt.updatedBy = req.user.userId;

  await stmt.save();
  return sendSuccess(res, withTotals(stmt), "P&L statement updated.");
};

// ─────────────────────────────────────────────────────────────────
// PATCH ROW — inline edit/delete for a single group or sub-item,
// mirrors the frontend's per-row hover edit/delete (no full-form
// reopen). action drives what changes:
//   editGroupLabel   { groupId, label }
//   editItemLabel    { groupId, itemId, label }
//   editItemAmount   { groupId, itemId, amount }
//   editSingleAmount { groupId, amount }   (non-expandable single-entry groups)
//   deleteGroup      { groupId }
//   deleteItem       { groupId, itemId }
// ─────────────────────────────────────────────────────────────────
export const patchPLRow = async (req, res) => {
  const { side, action, groupId, itemId, label, amount } = req.body;

  if (!["expense", "revenue"].includes(side)) {
    return sendError(res, "side must be 'expense' or 'revenue'.");
  }
  if (!groupId) return sendError(res, "groupId is required.");

  const stmt = await PLStatement.findById(req.params.id);
  if (!stmt) return sendError(res, "P&L statement not found.", 404);

  const key = side === "expense" ? "expenses" : "revenues";
  const group = stmt[key].id(groupId);
  if (!group) return sendError(res, "Group not found.", 404);

  switch (action) {
    case "editGroupLabel":
      if (!label?.trim()) return sendError(res, "label is required.");
      group.label = label.trim();
      break;

    case "editSingleAmount":
      if (group.items.length !== 1) {
        return sendError(res, "editSingleAmount only applies to single-entry groups.");
      }
      group.items[0].amount = Number(amount) || 0;
      break;

    case "editItemLabel": {
      const item = group.items.id(itemId);
      if (!item) return sendError(res, "Item not found.", 404);
      if (!label?.trim()) return sendError(res, "label is required.");
      item.label = label.trim();
      break;
    }

    case "editItemAmount": {
      const item = group.items.id(itemId);
      if (!item) return sendError(res, "Item not found.", 404);
      item.amount = Number(amount) || 0;
      break;
    }

    case "deleteGroup":
      group.deleteOne();
      break;

    case "deleteItem": {
      const item = group.items.id(itemId);
      if (!item) return sendError(res, "Item not found.", 404);
      item.deleteOne();
      break;
    }

    default:
      return sendError(res, `Unknown action: ${action}`);
  }

  stmt.updatedBy = req.user.userId;
  await stmt.save();
  return sendSuccess(res, withTotals(stmt), "P&L row updated.");
};

// ─────────────────────────────────────────────────────────────────
// DELETE — removes the whole statement (period)
// ─────────────────────────────────────────────────────────────────
export const deletePLStatement = async (req, res) => {
  const stmt = await PLStatement.findByIdAndDelete(req.params.id);
  if (!stmt) return sendError(res, "P&L statement not found.", 404);
  return sendSuccess(res, null, "P&L statement deleted.");
};

// ─────────────────────────────────────────────────────────────────
// SUMMARY — KPI totals across all periods or a date range of months,
// e.g. for a dashboard trend widget. ?from=2026-01&to=2026-12
// ─────────────────────────────────────────────────────────────────
export const getPLSummary = async (req, res) => {
  const { from, to } = req.query;
  const filter = {};
  if (from && to) filter.month = { $gte: from, $lte: to };

  const stmts = await PLStatement.find(filter).sort({ month: 1 }).lean();

  const rows = stmts.map((s) => {
    const totalRevenue  = sideTotal(s.revenues);
    const totalExpenses = sideTotal(s.expenses);
    return {
      month: s.month,
      totalRevenue,
      totalExpenses,
      netPL: totalRevenue - totalExpenses,
    };
  });

  const grand = rows.reduce(
    (acc, r) => ({
      totalRevenue:  acc.totalRevenue + r.totalRevenue,
      totalExpenses: acc.totalExpenses + r.totalExpenses,
      netPL:         acc.netPL + r.netPL,
    }),
    { totalRevenue: 0, totalExpenses: 0, netPL: 0 }
  );

  return sendSuccess(res, { rows, grand });
};