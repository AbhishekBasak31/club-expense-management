import express from "express";
import {
  createDailyBooking, getDailyBookings, getDailyBookingById,
  updateDailyBooking, deleteDailyBooking, bulkCreateDailyBookings,
} from "../Controller/DailyBooking.controller.js";
import { authenticate } from "../Middleware/auth.middleware.js";
import { asyncHandler } from "../Utils/Asynchandeler.js";

const router = express.Router();
router.use(authenticate);

router.post  ("/",      asyncHandler(createDailyBooking));
router.post  ("/bulk",  asyncHandler(bulkCreateDailyBookings)); // Excel import / multi-row add
router.get   ("/",      asyncHandler(getDailyBookings));
router.get   ("/:id",   asyncHandler(getDailyBookingById));
router.put   ("/:id",   asyncHandler(updateDailyBooking));
router.delete("/:id",   asyncHandler(deleteDailyBooking));

export default router;