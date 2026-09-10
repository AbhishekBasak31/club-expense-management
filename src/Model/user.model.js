import mongoose from "mongoose";
import bcrypt    from "bcrypt";
import jwt       from "jsonwebtoken";

// ─────────────────────────────────────────────────────────────────
// USER MODEL
// Flat, single-collection user store — no organizations, no tiers.
// `role` is the only access-level distinction: 'admin' can manage
// other users via /users routes (admin-only), 'user' cannot.
// (Finer-grained per-module permissions can be added later without
// breaking this — role stays the top-level gate.)
// ─────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema(
  {
    name         : { type: String, required: true, trim: true },
    email        : { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash : { type: String, required: true },

    // 'admin' can create/list/edit other users (see User.routes.js
    // /users endpoints, gated by requireAdmin). 'user' is a normal
    // login with full app access but no user-management rights.
    role         : { type: String, enum: ["admin", "user"], default: "user" },

    // Increment to invalidate all tokens (password change / logout-all /
    // role or active-status change by an admin)
    tokenVersion : { type: Number, default: 0 },

    isActive     : { type: Boolean, default: true },
    lastLogin    : { type: Date, default: null },
  },
  { timestamps: true }
);

// ── Methods ──────────────────────────────────────────────────────
UserSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

UserSchema.methods.generateAccessToken = function (sessionId) {
  return jwt.sign(
    { userId: this._id, tokenVersion: this.tokenVersion, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: "10h" }  // ← already 10 hours
  );
};

UserSchema.methods.generateRefreshToken = function (sessionId) {
  return jwt.sign(
    { userId: this._id, sessionId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );
};

// ── Statics ──────────────────────────────────────────────────────
UserSchema.statics.hashPassword = async function (plain) {
  const rounds = Number(process.env.SALT_ROUNDS) || 12;
  return bcrypt.hash(plain, rounds);
};

UserSchema.statics.sanitize = function (user) {
  return {
    id        : user._id,
    name      : user.name,
    email     : user.email,
    role      : user.role,
    isActive  : user.isActive,
    lastLogin : user.lastLogin,
  };
};

export const User = mongoose.model("User", UserSchema);
export default User;