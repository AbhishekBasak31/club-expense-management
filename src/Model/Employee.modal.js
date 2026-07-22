import mongoose from "mongoose";

const EmployeeSchema = new mongoose.Schema(
  {
    empId          : { type: String, required: true, trim: true, unique: true }, // employee ID / code, e.g. "EMP-001"
    name           : { type: String, required: true, trim: true },
    designation    : { type: String, trim: true, default: "" },
    bloodGroup     : { type: String, trim: true, default: "" }, // e.g. "O+", "AB-"

    mobileNumber   : { type: String, trim: true, default: "" },
    secondaryMobileNumber : { type: String, trim: true, default: "" }, // optional
    email          : { type: String, trim: true, lowercase: true, default: "" },
    secondaryEmail : { type: String, trim: true, lowercase: true, default: "" }, // optional

    dateOfBirth    : { type: Date, default: null },
    // Age is NOT stored — it's derived from dateOfBirth at read/display time
    // (both on the backend response and the frontend), since a stored age
    // would silently go stale the moment a birthday passes.

    // Base/reference salary for this employee — the default figure the
    // expense-entry salary form pre-fills with, but each month's actual
    // salary expense is its own record (see ExpenseItemSchema.salaryDetails)
    // and can differ from this reference value.
    salary         : { type: Number, default: 0 },

    isActive       : { type: Boolean, default: true },
  },
  { timestamps: true }
);

EmployeeSchema.index({ empId: 1 }, { unique: true });
EmployeeSchema.index({ name: 1 });
EmployeeSchema.index({ isActive: 1 });

export const Employee = mongoose.model("Employee", EmployeeSchema);
export default Employee; 