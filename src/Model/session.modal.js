import mongoose from "mongoose";

// One document per device login. Enables multi-device + per-device logout.
const SessionSchema = new mongoose.Schema(
  {
    sessionId        : { type: String, required: true, unique: true, index: true },
    userId           : { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    refreshTokenHash : { type: String, required: true },
    deviceName       : { type: String, default: "Unknown device" },
    userAgent        : { type: String, default: "" },
    ipAddress        : { type: String, default: "" },
    lastUsed         : { type: Date, default: Date.now },
    expiresAt        : { type: Date, required: true },
    isActive         : { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

// MongoDB auto-deletes expired sessions — no cron job
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
SessionSchema.index({ userId: 1, isActive: 1 });

export const Session = mongoose.model("Session", SessionSchema);
export default Session;