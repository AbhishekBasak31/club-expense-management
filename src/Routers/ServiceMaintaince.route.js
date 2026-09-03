import express from "express";
import {
  createServiceMaintenance, getServiceMaintenances, getServiceMaintenanceById,
  updateServiceMaintenance, deleteServiceMaintenance,
  addServiceVisit, deleteServiceVisit, getDueSoonServices,
  uploadDocument, uploadContractDocument, deleteContractDocument,
} from "../Controller/ServiceMaintainance.controller.js";
import { authenticate } from "../../src/Middleware/auth.middleware.js";
import { asyncHandler } from "../../src/Utils/Asynchandeler.js";

const ServiceMaintenanceRouter = express.Router();
ServiceMaintenanceRouter.use(authenticate);

// Before "/:id" so it isn't shadowed.
ServiceMaintenanceRouter.get("/due-soon", asyncHandler(getDueSoonServices));

ServiceMaintenanceRouter.post  ("/",                    asyncHandler(createServiceMaintenance));
ServiceMaintenanceRouter.get   ("/",                    asyncHandler(getServiceMaintenances));
ServiceMaintenanceRouter.get   ("/:id",                 asyncHandler(getServiceMaintenanceById));
ServiceMaintenanceRouter.put   ("/:id",                 asyncHandler(updateServiceMaintenance));
ServiceMaintenanceRouter.delete("/:id",                 asyncHandler(deleteServiceMaintenance));
ServiceMaintenanceRouter.post  ("/:id/document",         uploadDocument.single("document"), asyncHandler(uploadContractDocument));
ServiceMaintenanceRouter.delete("/:id/document",         asyncHandler(deleteContractDocument));
ServiceMaintenanceRouter.post  ("/:id/visits",           asyncHandler(addServiceVisit));
ServiceMaintenanceRouter.delete("/:id/visits/:visitId",  asyncHandler(deleteServiceVisit));

export default ServiceMaintenanceRouter;