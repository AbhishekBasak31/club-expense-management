import express from "express";
import {
  createEmployee, getEmployees, getEmployeeById, updateEmployee, deleteEmployee,
} from "../Controller/Employee.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const EmployeeRouter = express.Router();
EmployeeRouter.use(authenticate); // all employee routes require login

EmployeeRouter.post  ("/",    asyncHandler(createEmployee));
EmployeeRouter.get   ("/",    asyncHandler(getEmployees));
EmployeeRouter.get   ("/:id", asyncHandler(getEmployeeById));
EmployeeRouter.put   ("/:id", asyncHandler(updateEmployee));
EmployeeRouter.delete("/:id", asyncHandler(deleteEmployee));

export default EmployeeRouter;