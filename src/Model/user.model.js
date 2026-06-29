import mongoose from "mongoose";
import bcrypt    from "bcrypt";
import jwt       from "jsonwebtoken";

// ─────────────────────────────────────────────────────────────────
// USER MODEL — single user, full access.
// No tier, no role, no permissions. Just login credentials.
// (Multi-user RBAC can be added later without breaking this.)
// ─────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema(
  {
    name         : { type: String, required: true, trim: true },
    email        : { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash : { type: String, required: true },

    // Increment to invalidate all tokens (password change / logout-all)
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
    { expiresIn: "10m" }
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
    isActive  : user.isActive,
    lastLogin : user.lastLogin,
  };
};

export const User = mongoose.model("User", UserSchema);
export default User;