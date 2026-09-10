import express from "express";
import {
  register, login, refresh,
  logout, logoutAll, logoutSession,
  getSessions, getMe, updateProfile, changePassword,
  listUsers, createUser, updateUser,
} from "../Controller/User.controller.js";
import { authenticate, requireAdmin, bootstrapOrAdmin } from "../Middleware/auth.middleware.js";

const router = express.Router();

// ── PUBLIC-ONLY-UNTIL-FIRST-ADMIN-EXISTS ──────────────────────────
// register is open when the DB has zero users (first-time setup);
// once any user exists it requires a logged-in admin — see
// bootstrapOrAdmin in auth.middleware.js. Ordinary user creation
// after that point goes through POST /users below instead.
router.post("/register", bootstrapOrAdmin, register);

router.post("/login",    login);
router.post("/refresh",  refresh);

// ── PROTECTED — valid access token required ──────────────────────
router.use(authenticate);

router.delete("/logout",              logout);         // this device
router.delete("/logout-all",          logoutAll);      // all devices
router.delete("/sessions/:sessionId", logoutSession);  // a specific device

router.get  ("/sessions",     getSessions);
router.get  ("/me",           getMe);
router.patch("/me/profile",   updateProfile);
router.patch("/me/password",  changePassword);

// ── ADMIN ONLY — user management window ───────────────────────────
router.get  ("/users",      requireAdmin, listUsers);
router.post ("/users",      requireAdmin, createUser);
router.patch("/users/:id",  requireAdmin, updateUser);

export default router;