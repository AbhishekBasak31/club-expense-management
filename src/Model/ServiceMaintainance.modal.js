import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────
// ServiceMaintenance — one document per service arrangement: an AMC
// (Annual Maintenance Contract) for AC units, a recurring pest control
// arrangement, a one-time repair, a fire-safety inspection, etc. Not a
// single fixed category list — serviceType covers the common cases,
// with "Other" as an escape hatch rather than forcing every real-world
// service into one of a handful of buckets.
//
// Individual service VISITS (the pest control technician actually
// showing up this month, the AC AMC's quarterly checkup) are embedded
// as a sub-array rather than a separate collection. For this kind of
// data — a handful to a few dozen visits per contract per year — an
// embedded array stays well within MongoDB's document-size limits even
// over several years, and keeps "log this visit" and "when's the next
// one due" naturally together without a second collection/controller
// to keep in sync. If a single contract's visit history ever grows
// into the hundreds (unlikely for this use case), that's the point to
// split visits into their own collection — not a concern at this
// scale.
//
// Status (Active / Due Soon / Overdue / Expired) is NEVER stored —
// always computed fresh from today's date vs. nextDueDate/
// contractEndDate at request time (see ServiceMaintenance.controller.js),
// so it can never drift out of sync with the calendar the way a stored
// status field eventually would.
// ─────────────────────────────────────────────────────────────────

const ServiceVisitSchema = new mongoose.Schema(
  {
    visitDate: { type: Date, required: true },
    performedBy: { type: String, trim: true, default: "" }, // technician / team name
    workDone: { type: String, trim: true, default: "" },
    cost: { type: Number, default: 0, min: 0 }, // this visit's cost, if billed per-visit rather than one contract value
    // What THIS visit sets the contract's next due date to — typically
    // computed from frequency on the frontend before submitting, but
    // stored as an explicit date (not just "add N months") so an
    // irregular schedule (e.g. the vendor reschedules a visit) is
    // always representable without fighting the frequency field.
    nextServiceDate: { type: Date, default: null },
    documentUrl: { type: String, trim: true, default: "" }, // service report / visit invoice
    remarks: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

const ServiceMaintenanceSchema = new mongoose.Schema(
  {
    serviceType: {
      type: String,
      enum: ["AMC", "Pest Control", "Repair", "Inspection", "One-time", "Other"],
      required: true,
    },
    title: { type: String, required: true, trim: true }, // e.g. "AC Maintenance — Split Units", "Pest Control — Kitchen & Bar"

    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor", default: null },
    vendorName: { type: String, trim: true, default: "" }, // denormalized for fast display without populate

    areaCovered: { type: String, trim: true, default: "" }, // free text — "All AC units", "Kitchen & Bar", "Elevator"

    frequency: {
      type: String,
      enum: ["Monthly", "Quarterly", "Half-Yearly", "Annual", "One-time", "Custom"],
      default: "Annual",
    },

    // Contract-level dates — contractEndDate stays null for a one-time
    // service/repair that isn't a recurring contract at all.
    contractStartDate: { type: Date, default: null },
    contractEndDate: { type: Date, default: null },
    contractValue: { type: Number, default: 0, min: 0 }, // total contract value, if billed as one lump sum rather than per-visit

    // How many days before nextDueDate this shows as "Due Soon" rather
    // than plain "Active" — configurable per contract since a fire-
    // safety inspection probably wants more lead time than a monthly
    // pest control visit.
    reminderDays: { type: Number, default: 15, min: 0 },

    // nextDueDate is set directly when the contract is created (the
    // first service is due), then automatically advances to whatever
    // nextServiceDate was given on the most recently logged visit —
    // see addServiceVisit in the controller. lastServicedDate is purely
    // derived from the visits array (the most recent visitDate), never
    // set directly.
    nextDueDate: { type: Date, default: null },

    documentUrl: { type: String, trim: true, default: "" }, // the contract document itself
    documentPublicId: { type: String, trim: true, default: "" }, // Cloudinary public_id, for delete/replace — "" when stored on local disk or not yet uploaded
    remarks: { type: String, trim: true, default: "" },

    visits: { type: [ServiceVisitSchema], default: [] },

    isActive: { type: Boolean, default: true }, // soft-delete flag — NOT the same as contract status (Active/Expired/etc), which is always computed
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ServiceMaintenanceSchema.index({ serviceType: 1 });
ServiceMaintenanceSchema.index({ nextDueDate: 1 });
ServiceMaintenanceSchema.index({ isActive: 1 });

export const ServiceMaintenance = mongoose.model("ServiceMaintenance", ServiceMaintenanceSchema);
export default ServiceMaintenance;