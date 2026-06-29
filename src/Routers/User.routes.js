import express from "express";
import {
  register, login, refresh,
  logout, logoutAll, logoutSession,
  getSessions, getMe, updateProfile, changePassword,
} from "../Controller/User.controller.js";
import { authenticate } from "../Middleware/auth.middleware.js";

const router = express.Router();

// ── PUBLIC — no token required ───────────────────────────────────
router.post("/register", register);  // create the single full-access user
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

export default router;