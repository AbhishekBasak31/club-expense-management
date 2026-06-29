import crypto from "crypto";
import jwt     from "jsonwebtoken";
import { User } from "../Model/user.model.js";
import { Session } from "../Model/session.modal.js";
import Config from "../../src/Services/Config.js";
// ───────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────

/** SHA-256 hash a token before storing in DB */
const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

/** 7 days in milliseconds */
const REFRESH_TTL = 7 * 24 * 60 * 60 * 1000;

/** Parse a human-readable device name from user-agent string */
const parseDevice = (ua = "") => {
  if (!ua) return "Unknown device";
  if (/iphone/i.test(ua))        return "iPhone";
  if (/ipad/i.test(ua))          return "iPad";
  if (/android.*mobile/i.test(ua)) return "Android Phone";
  if (/android/i.test(ua))       return "Android Tablet";
  if (/chrome/i.test(ua) && !/edge|opr/i.test(ua)) return "Chrome";
  if (/firefox/i.test(ua))       return "Firefox";
  if (/safari/i.test(ua))        return "Safari";
  if (/edge/i.test(ua))          return "Edge";
  return "Browser";
};

/** Create session + return both tokens */
const createSession = async (user, userAgent, ip) => {
  const sessionId    = crypto.randomUUID();
  const accessToken  = user.generateAccessToken(sessionId);
  const refreshToken = user.generateRefreshToken(sessionId);

  await Session.create({
    sessionId,
    userId           : user._id,
    organizationId   : user.organizationId,
    refreshTokenHash : hashToken(refreshToken),
    deviceName       : parseDevice(userAgent),
    userAgent        : userAgent || "",
    ipAddress        : ip || "",
    lastUsed         : new Date(),
    expiresAt        : new Date(Date.now() + REFRESH_TTL),
    isActive         : true,
  });

  return { accessToken, refreshToken, sessionId };
};

// ─────────────────────────────────────────────────────────────────
// AUTH SERVICES
// ─────────────────────────────────────────────────────────────────

/**
 * Register — creates the SuperAdmin for a new organization.
 * Called once when an org signs up.
 */
export const registerService = async ({ name, email, password, organizationId }) => {
  const existing = await User.findOne({ email });
  if (existing) {
    const err = new Error("An account with this email already exists.");
    err.status = 409;
    throw err;
  }

  const passwordHash = await User.hashPassword(password);

  const user = await User.create({
    organizationId,
    name,
    email,
    passwordHash,
    tier     : "superadmin", // hardcoded — never from request body
    roleId   : null,
    isActive : true,          // superadmin is active immediately (no invite needed)
  });

  return User.sanitize(user);
};

/**
 * Login — verifies credentials, creates session, returns tokens.
 */
export const loginService = async ({ email, password, userAgent, ip }) => {
  const user = await User.findOne({ email });

  // Same generic error for both "not found" and "wrong password" — prevents email enumeration
  const credError = new Error("Invalid email or password.");
  credError.status = 401;

  if (!user) throw credError;

  if (!user.isActive) {
    const err = new Error("Your account is inactive. Contact your administrator.");
    err.status = 403;
    throw err;
  }

  const valid = await user.comparePassword(password);
  if (!valid) throw credError;

  const { accessToken, refreshToken } = await createSession(user, userAgent, ip);

  // Update last login time
  await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

  return {
    accessToken,
    refreshToken,
    user: User.sanitize(user),
  };
};

/**
 * Refresh — rotates refresh token, issues new access token.
 * Called automatically by frontend when access token expires.
 */
export const refreshService = async (incomingRefreshToken) => {
  const noSessionErr = new Error("Session expired. Please log in again.");
  noSessionErr.status = 401;

  // Verify JWT signature
  let decoded;
  try {
    decoded = jwt.verify(incomingRefreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw noSessionErr;
  }

  // Find matching active session by hashed token
  const session = await Session.findOne({
    sessionId        : decoded.sessionId,
    refreshTokenHash : hashToken(incomingRefreshToken),
    isActive         : true,
    expiresAt        : { $gt: new Date() },
  });

  if (!session) throw noSessionErr;

  // Get fresh user — picks up any role/tier/tokenVersion changes
  const user = await User.findById(decoded.userId);
  if (!user || !user.isActive) {
    const err = new Error("Account not found or disabled.");
    err.status = 401;
    throw err;
  }

  // Rotation — generate new tokens, invalidate old refresh token
  const newAccessToken  = user.generateAccessToken(decoded.sessionId);
  const newRefreshToken = user.generateRefreshToken(decoded.sessionId);

  await Session.updateOne(
    { sessionId: decoded.sessionId },
    {
      refreshTokenHash : hashToken(newRefreshToken),
      lastUsed         : new Date(),
    }
  );

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
};

/**
 * Logout — deactivates the current session only.
 */
export const logoutService = async (sessionId) => {
  await Session.updateOne({ sessionId }, { isActive: false });
};

/**
 * Logout all devices — deactivates every session and bumps tokenVersion.
 * All existing access tokens become invalid immediately (even before 10min expiry).
 */
export const logoutAllService = async (userId) => {
  await Session.updateMany({ userId }, { isActive: false });
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
};

/**
 * Logout a specific session (kill another device remotely).
 */
export const logoutSessionService = async (userId, targetSessionId) => {
  const session = await Session.findOne({ sessionId: targetSessionId });

  if (!session) {
    const err = new Error("Session not found.");
    err.status = 404;
    throw err;
  }

  // Users can only kill their own sessions
  if (session.userId.toString() !== userId.toString()) {
    const err = new Error("Forbidden.");
    err.status = 403;
    throw err;
  }

  await Session.updateOne({ sessionId: targetSessionId }, { isActive: false });
};

/**
 * Get all active sessions for a user.
 * Marks the current session so frontend can show "This device".
 */
export const getSessionsService = async (userId, currentSessionId) => {
  const sessions = await Session.find({
    userId,
    isActive  : true,
    expiresAt : { $gt: new Date() },
  })
    .select("sessionId deviceName ipAddress lastUsed createdAt")
    .sort({ lastUsed: -1 })
    .lean();

  return sessions.map((s) => ({
    ...s,
    isCurrentSession : s.sessionId === currentSessionId,
  }));
};

// ─────────────────────────────────────────────────────────────────
// INVITE SERVICES
// ─────────────────────────────────────────────────────────────────

/**
 * Invite a new user — creates inactive account, returns raw token for email.
 * SuperAdmin can invite admin or user.
 * Admin can invite user only.
 */
export const inviteUserService = async ({
  name, email, tier, roleId,
  inviterTier, inviterId, organizationId,
}) => {
  // Authority check
  if (tier === "admin" && inviterTier !== "superadmin") {
    const err = new Error("Only the owner can create admin accounts.");
    err.status = 403;
    throw err;
  }
  if (tier === "superadmin") {
    const err = new Error("Cannot create another superadmin.");
    err.status = 403;
    throw err;
  }
  if (!["superadmin", "admin"].includes(inviterTier)) {
    const err = new Error("Insufficient authority to invite users.");
    err.status = 403;
    throw err;
  }

  const existing = await User.findOne({ email });
  if (existing) {
    const err = new Error("An account with this email already exists.");
    err.status = 409;
    throw err;
  }

  // Generate raw token (goes in email link) and store its hash
  const rawToken    = crypto.randomBytes(32).toString("hex");
  const inviteToken = hashToken(rawToken);

  await User.create({
    organizationId,
    name,
    email,
    passwordHash : "INVITE_PENDING", // replaced when user accepts
    tier,
    roleId       : tier === "user" ? roleId : null,
    inviteToken,
    inviteExpiry : new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
    invitedBy    : inviterId,
    isActive     : false,
  });

  // Return rawToken — caller (controller) sends it via email
  // In dev: return it in response for Postman testing
  return { rawToken, email, name };
};

/**
 * Accept invite — user sets their password, account becomes active.
 */
export const acceptInviteService = async ({ token, password }) => {
  const hashedToken = hashToken(token);

  const user = await User.findOne({
    inviteToken  : hashedToken,
    inviteExpiry : { $gt: new Date() },
    isActive     : false,
  });

  if (!user) {
    const err = new Error("Invite link is invalid or has expired.");
    err.status = 400;
    throw err;
  }

  user.passwordHash = await User.hashPassword(password);
  user.isActive     = true;
  user.inviteToken  = null;
  user.inviteExpiry = null;
  await user.save();

  return User.sanitize(user);
};

// ─────────────────────────────────────────────────────────────────
// USER MANAGEMENT SERVICES
// ─────────────────────────────────────────────────────────────────

/** Get current user's profile */
export const getMeService = async (userId) => {
  return User.findById(userId)
    .select("-passwordHash -inviteToken -inviteExpiry -tokenVersion")
    .lean();
};

/** Update own profile (name only) */
export const updateProfileService = async (userId, { name }) => {
  return User.findByIdAndUpdate(
    userId,
    { name: name.trim() },
    { new: true, runValidators: true }
  ).select("-passwordHash -inviteToken -inviteExpiry -tokenVersion");
};

/** Change own password — logs out all other devices */
export const changePasswordService = async (userId, currentSessionId, { currentPassword, newPassword }) => {
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error("User not found."), { status: 404 });

  const valid = await user.comparePassword(currentPassword);
  if (!valid) throw Object.assign(new Error("Current password is incorrect."), { status: 401 });

  user.passwordHash = await User.hashPassword(newPassword);
  user.tokenVersion += 1;
  await user.save();

  // Deactivate all OTHER sessions (keep current one)
  await Session.updateMany(
    { userId, sessionId: { $ne: currentSessionId } },
    { isActive: false }
  );
};

/** List all users in an org (for admin/superadmin) */
export const getOrgUsersService = async (organizationId) => {
  return User.find({ organizationId })
    .select("-passwordHash -inviteToken -inviteExpiry -tokenVersion")
    .populate("roleId", "roleName roleKey")
    .sort({ createdAt: -1 })
    .lean();
};

/** Change a user's role */
export const changeUserRoleService = async ({
  targetUserId, roleId, organizationId, callerTier,
}) => {
  const target = await User.findOne({ _id: targetUserId, organizationId });
  if (!target) throw Object.assign(new Error("User not found."), { status: 404 });

  // Admin can only change user-tier accounts
  if (callerTier === "admin" && target.tier !== "user") {
    throw Object.assign(
      new Error("Admins can only change roles of user-tier accounts."),
      { status: 403 }
    );
  }

  target.roleId       = roleId;
  target.tokenVersion += 1;
  await target.save();

  // Deactivate sessions — user must re-login with new role
  await Session.updateMany({ userId: target._id }, { isActive: false });

  return User.sanitize(target);
};

/** Deactivate a user (never hard delete) */
export const deactivateUserService = async ({
  targetUserId, organizationId, callerId, callerTier,
}) => {
  const target = await User.findOne({ _id: targetUserId, organizationId });
  if (!target) throw Object.assign(new Error("User not found."), { status: 404 });

  if (target._id.toString() === callerId.toString()) {
    throw Object.assign(new Error("You cannot deactivate your own account."), { status: 400 });
  }

  if (callerTier === "admin" && target.tier !== "user") {
    throw Object.assign(
      new Error("Admins can only deactivate user-tier accounts."),
      { status: 403 }
    );
  }

  target.isActive     = false;
  target.tokenVersion += 1;
  await target.save();

  await Session.updateMany({ userId: target._id }, { isActive: false });
};