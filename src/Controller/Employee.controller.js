import { Employee } from "../Model/Employee.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// Age is derived from dateOfBirth at request time — never stored, so it's
// always correct even long after the record was created.
const withAge = (doc) => {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  if (obj.dateOfBirth) {
    const dob = new Date(obj.dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
    obj.age = age;
  } else {
    obj.age = null;
  }
  return obj;
};

export const createEmployee = async (req, res) => {
  const { empId, name } = req.body;
  if (!empId?.trim()) return sendError(res, "Employee ID is required.");
  if (!name?.trim())  return sendError(res, "Employee name is required.");

  const existing = await Employee.findOne({ empId: empId.trim() });
  if (existing) return sendError(res, `Employee ID "${empId}" is already in use.`);

  const employee = await Employee.create(req.body);
  return sendSuccess(res, withAge(employee), "Employee created.", 201);
};

export const getEmployees = async (req, res) => {
  const { search, active } = req.query;

  const filter = {};
  if (active !== undefined) filter.isActive = active === "true";
  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: "i" } },
      { empId: { $regex: search, $options: "i" } },
    ];
  }

  const employees = await Employee.find(filter).sort({ name: 1 }).lean();
  return sendSuccess(res, employees.map(withAge));
};

export const getEmployeeById = async (req, res) => {
  const employee = await Employee.findById(req.params.id).lean();
  if (!employee) return sendError(res, "Employee not found.", 404);
  return sendSuccess(res, withAge(employee));
};

export const updateEmployee = async (req, res) => {
  const { empId } = req.body;
  if (empId) {
    const existing = await Employee.findOne({ empId: empId.trim(), _id: { $ne: req.params.id } });
    if (existing) return sendError(res, `Employee ID "${empId}" is already in use.`);
  }

  const employee = await Employee.findByIdAndUpdate(
    req.params.id, { $set: req.body }, { new: true, runValidators: true }
  );
  if (!employee) return sendError(res, "Employee not found.", 404);
  return sendSuccess(res, withAge(employee), "Employee updated.");
};

export const deleteEmployee = async (req, res) => {
  const employee = await Employee.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!employee) return sendError(res, "Employee not found.", 404);
  return sendSuccess(res, null, "Employee deactivated.");
};