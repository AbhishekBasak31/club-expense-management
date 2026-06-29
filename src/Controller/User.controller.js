import crypto from "crypto";
import jwt     from "jsonwebtoken";
import { User }    from "../Model/user.model.js";
import { Session } from "../Model/session.modal.js";
import { sendSuccess, sendError } from "../Utils/Apirespondse.js";

// ── helpers ──────────────────────────────────────────────────────
const hashToken = (t) => crypto.createHash("sha256").update(t).digest("hex");
const REFRESH_TTL = 7 * 24 * 60 * 60 * 1000;

const parseDevice = (ua = "") => {
  if (/iphone/i.test(ua)) return "iPhone";
  if (/android/i.test(ua)) return "Android";
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) return "Chrome";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  if (/edge/i.test(ua)) return "Edge";
  return "Browser";
};

const cookieOpts = () => ({
  httpOnly : true,
  secure   : process.env.NODE_ENV === "production",
  sameSite : process.env.NODE_ENV === "production" ? "none" : "lax",
  path     : "/",
  maxAge   : REFRESH_TTL,
});

const createSession = async (user, req) => {
  const sessionId    = crypto.randomUUID();
  const accessToken  = user.generateAccessToken(sessionId);
  const refreshToken = user.generateRefreshToken(sessionId);

  await Session.create({
    sessionId,
    userId           : user._id,
    refreshTokenHash : hashToken(refreshToken),
    deviceName       : parseDevice(req.headers["user-agent"]),
    userAgent        : req.headers["user-agent"] || "",
    ipAddress        : req.ip || "",
    expiresAt        : new Date(Date.now() + REFRESH_TTL),
  });

  return { accessToken, refreshToken };
};

// ─────────────────────────────────────────────────────────────────
// POST /register — create the single full-access user
// ─────────────────────────────────────────────────────────────────
export const register = async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return sendError(res, "Name, email and password are required.");
  if (password.length < 8)
    return sendError(res, "Password must be at least 8 characters.");

  const existing = await User.findOne({ email });
  if (existing) return sendError(res, "An account with this email already exists.", 409);

  const passwordHash = await User.hashPassword(password);
  const user = await User.create({ name, email, passwordHash, isActive: true });

  return sendSuccess(res, { user: User.sanitize(user) }, "Account created.", 201);
};

// ─────────────────────────────────────────────────────────────────
// POST /login
// ─────────────────────────────────────────────────────────────────
export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return sendError(res, "Email and password are required.");

  const user = await User.findOne({ email });
  if (!user || !user.isActive) return sendError(res, "Invalid email or password.", 401);

  const valid = await user.comparePassword(password);
  if (!valid) return sendError(res, "Invalid email or password.", 401);

  const { accessToken, refreshToken } = await createSession(user, req);
  await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

  res.cookie("refreshToken", refreshToken, cookieOpts());
  return sendSuccess(res, { accessToken, user: User.sanitize(user) }, "Login successful.");
};

// ─────────────────────────────────────────────────────────────────
// POST /refresh
// ─────────────────────────────────────────────────────────────────
export const refresh = async (req, res) => {
  const incoming = req.cookies.refreshToken;
  if (!incoming) return sendError(res, "No refresh token. Please log in.", 401);

  let decoded;
  try {
    decoded = jwt.verify(incoming, process.env.JWT_REFRESH_SECRET);
  } catch {
    return sendError(res, "Session expired. Please log in.", 401);
  }

  const session = await Session.findOne({
    sessionId        : decoded.sessionId,
    refreshTokenHash : hashToken(incoming),
    isActive         : true,
    expiresAt        : { $gt: new Date() },
  });
  if (!session) return sendError(res, "Session expired. Please log in.", 401);

  const user = await User.findById(decoded.userId);
  if (!user || !user.isActive) return sendError(res, "Account disabled.", 401);

  const newAccessToken  = user.generateAccessToken(decoded.sessionId);
  const newRefreshToken = user.generateRefreshToken(decoded.sessionId);

  await Session.updateOne(
    { sessionId: decoded.sessionId },
    { refreshTokenHash: hashToken(newRefreshToken), lastUsed: new Date() }
  );

  res.cookie("refreshToken", newRefreshToken, cookieOpts());
  return sendSuccess(res, { accessToken: newAccessToken }, "Token refreshed.");
};

// ─────────────────────────────────────────────────────────────────
// DELETE /logout — this device
// ─────────────────────────────────────────────────────────────────
export const logout = async (req, res) => {
  await Session.updateOne({ sessionId: req.user.sessionId }, { isActive: false });
  res.clearCookie("refreshToken", cookieOpts());
  return sendSuccess(res, null, "Logged out.");
};

// ─────────────────────────────────────────────────────────────────
// DELETE /logout-all — all devices
// ─────────────────────────────────────────────────────────────────
export const logoutAll = async (req, res) => {
  await Session.updateMany({ userId: req.user.userId }, { isActive: false });
  await User.updateOne({ _id: req.user.userId }, { $inc: { tokenVersion: 1 } });
  res.clearCookie("refreshToken", cookieOpts());
  return sendSuccess(res, null, "Logged out from all devices.");
};

// ─────────────────────────────────────────────────────────────────
// DELETE /sessions/:sessionId — kill a specific device
// ─────────────────────────────────────────────────────────────────
export const logoutSession = async (req, res) => {
  const session = await Session.findOne({ sessionId: req.params.sessionId });
  if (!session) return sendError(res, "Session not found.", 404);
  if (session.userId.toString() !== req.user.userId.toString())
    return sendError(res, "Forbidden.", 403);
  await Session.updateOne({ sessionId: req.params.sessionId }, { isActive: false });
  return sendSuccess(res, null, "Device logged out.");
};

// ─────────────────────────────────────────────────────────────────
// GET /sessions — list active devices
// ─────────────────────────────────────────────────────────────────
export const getSessions = async (req, res) => {
  const sessions = await Session.find({
    userId: req.user.userId, isActive: true, expiresAt: { $gt: new Date() },
  }).select("sessionId deviceName ipAddress lastUsed createdAt").sort({ lastUsed: -1 }).lean();

  const data = sessions.map((s) => ({ ...s, isCurrentSession: s.sessionId === req.user.sessionId }));
  return sendSuccess(res, data);
};

// ─────────────────────────────────────────────────────────────────
// GET /me
// ─────────────────────────────────────────────────────────────────
export const getMe = async (req, res) => {
  const user = await User.findById(req.user.userId).select("-passwordHash -tokenVersion").lean();
  if (!user) return sendError(res, "User not found.", 404);
  return sendSuccess(res, user);
};

// ─────────────────────────────────────────────────────────────────
// PATCH /me/profile
// ─────────────────────────────────────────────────────────────────
export const updateProfile = async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return sendError(res, "Name is required.");
  const user = await User.findByIdAndUpdate(
    req.user.userId, { name: name.trim() }, { new: true }
  ).select("-passwordHash -tokenVersion");
  return sendSuccess(res, user, "Profile updated.");
};

// ─────────────────────────────────────────────────────────────────
// PATCH /me/password
// ─────────────────────────────────────────────────────────────────
export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return sendError(res, "Current and new password are required.");
  if (newPassword.length < 8)
    return sendError(res, "Password must be at least 8 characters.");

  const user = await User.findById(req.user.userId);
  if (!user) return sendError(res, "User not found.", 404);

  const valid = await user.comparePassword(currentPassword);
  if (!valid) return sendError(res, "Current password is incorrect.", 401);

  user.passwordHash = await User.hashPassword(newPassword);
  user.tokenVersion += 1;
  await user.save();

  await Session.updateMany(
    { userId: user._id, sessionId: { $ne: req.user.sessionId } },
    { isActive: false }
  );

  return sendSuccess(res, null, "Password changed.");
};