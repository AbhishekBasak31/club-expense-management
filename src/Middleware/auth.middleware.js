import jwt     from "jsonwebtoken";
import { User } from "../Model/user.model.js";
import { Session } from "../Model/session.modal.js";

// ─────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────
const deny = (res, message, status = 401) =>
  res.status(status).json({ success: false, message });

// ─────────────────────────────────────────────────────────────────
// authenticate
// Gate 1 — Verifies the access token and populates req.user.
// Access token is sent as:  Authorization: Bearer <token>
// Refresh token stays in httpOnly cookie — never read here.
// ─────────────────────────────────────────────────────────────────
export const authenticate = async (req, res, next) => {
  try {
    // Read Bearer token from header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return deny(res, "Not authenticated. Please log in.");
    }
    const token = authHeader.split(" ")[1];

    // Verify signature and expiry
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return err.name === "TokenExpiredError"
        ? deny(res, "Access token expired.")
        : deny(res, "Invalid token.");
    }

    // Verify the session is still active in the DB
    // Catches: logout, logout-all, admin-revoked sessions
    const session = await Session.findOne({
      sessionId : decoded.sessionId,
      isActive  : true,
    }).lean();

    if (!session) {
      return deny(res, "Session ended. Please log in again.");
    }

    // Verify tokenVersion — catches role changes and forced logouts
    // When a role changes or logout-all is called, tokenVersion is incremented.
    // Old tokens carry the old version and are rejected here instantly,
    // before their 10-minute natural expiry.
    // Also pulls `role` fresh from the DB on every request — role is
    // deliberately NOT trusted from the JWT payload, so an admin
    // demoting someone takes effect immediately without waiting for
    // token expiry (paired with the tokenVersion bump in
    // User.controller.js's updateUser, which forces relogin anyway).
    const user = await User.findById(decoded.userId)
      .select("tokenVersion isActive role")
      .lean();

    if (!user || !user.isActive) {
      return deny(res, "Account not found or disabled.");
    }

    if (user.tokenVersion !== decoded.tokenVersion) {
      return deny(res, "Session invalidated. Please log in again.");
    }

    // Attach everything downstream controllers and middleware need
    req.user = {
      userId         : decoded.userId,
      organizationId : decoded.organizationId,
      tier           : decoded.tier,
      roleId         : decoded.roleId,       // null for superadmin/admin
      role           : user.role,            // 'admin' | 'user' — see requireAdmin below
      tokenVersion   : decoded.tokenVersion,
      sessionId      : decoded.sessionId,
    };

    // Shorthand used across all modules
    req.orgId = decoded.organizationId;

    next();
  } catch (err) {
    console.error("[authenticate]", err.message);
    return deny(res, "Authentication failed.");
  }
};

// ─────────────────────────────────────────────────────────────────
// requireAdmin
// Gate — restricts a route to users with role === 'admin'.
// Must run after `authenticate` (needs req.user.role).
// Used to protect the admin-only User Management endpoints
// (create/list/update other users) below in User.routes.js.
// ─────────────────────────────────────────────────────────────────
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return deny(res, "This action requires admin access.", 403);
  }
  next();
};

// ─────────────────────────────────────────────────────────────────
// bootstrapOrAdmin
// Gate for POST /register specifically. Registration is only ever
// public when the database has zero users (first-time setup, so
// the very first account can be created without already having an
// admin to approve it). Once at least one user exists, this behaves
// exactly like `authenticate` + `requireAdmin` — every subsequent
// account must be created by a logged-in admin. This closes what
// was otherwise an unauthenticated "create a full-access account"
// endpoint reachable by anyone once the app has real users.
// ─────────────────────────────────────────────────────────────────
export const bootstrapOrAdmin = async (req, res, next) => {
  try {
    const count = await User.countDocuments();
    if (count === 0) return next(); // no users yet — allow open bootstrap registration

    return authenticate(req, res, () => requireAdmin(req, res, next));
  } catch (err) {
    console.error("[bootstrapOrAdmin]", err.message);
    return deny(res, "Registration check failed.", 500);
  }
};

// ─────────────────────────────────────────────────────────────────
// requireTier
// Gate 2 — Checks the authority level (superadmin / admin / user).
// Usage:
//   requireTier("superadmin")
//   requireTier("superadmin", "admin")
// ─────────────────────────────────────────────────────────────────
export const requireTier = (...allowedTiers) =>
  (req, res, next) => {
    if (!allowedTiers.includes(req.user.tier)) {
      return deny(
        res,
        `This action requires ${allowedTiers.join(" or ")} access.`,
        403
      );
    }
    next();
  };

// ─────────────────────────────────────────────────────────────────
// checkPermission
// Gate 3 — Checks a dynamic module-level permission.
// superadmin and admin bypass this — they have full access.
// For "user" tier, fetches the Role document and checks the permission.
//
// Usage:
//   checkPermission("vendor_master", "add")
//   checkPermission("expense_entry", "view")
// ─────────────────────────────────────────────────────────────────
export const checkPermission = (moduleKey, action) =>
  async (req, res, next) => {
    try {
      const { tier, roleId } = req.user;

      // superadmin and admin bypass all permission checks
      if (tier === "superadmin" || tier === "admin") return next();

      if (!roleId) {
        return deny(res, "No role assigned to your account. Contact your admin.", 403);
      }

      // Dynamically import Role to avoid circular dependency issues
      // (Role is in a different module folder)
      const { Role } = await import("../modules/role/role.model.js");

      const role = await Role.findById(roleId)
        .select("permissions isActive")
        .lean();

      if (!role || !role.isActive) {
        return deny(res, "Your role is not available. Contact your admin.", 403);
      }

      // Find this module's permission entry in the array
      const modPerm = role.permissions.find((p) => p.moduleKey === moduleKey);

      if (!modPerm || !modPerm[action]) {
        return deny(
          res,
          `You do not have ${action} permission on ${moduleKey}.`,
          403
        );
      }

      next();
    } catch (err) {
      console.error("[checkPermission]", err.message);
      return deny(res, "Permission check failed.", 500);
    }
  };