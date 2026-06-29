import { z } from "zod";

// ─────────────────────────────────────────────────────────────────
// REUSABLE RULES
// ─────────────────────────────────────────────────────────────────
const password = z
  .string()
  .min(8,  "Password must be at least 8 characters")
  .max(64, "Password too long");

const email = z
  .string()
  .email("Invalid email address")
  .toLowerCase();

const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid ID format");

// ─────────────────────────────────────────────────────────────────
// AUTH SCHEMAS
// ─────────────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  name           : z.string().min(2, "Name must be at least 2 characters").trim(),
  email,
  password,
  organizationId : objectId,
  // organizationId will come from the org creation step
  // In production: create org first, then register superadmin
});

export const LoginSchema = z.object({
  email,
  password : z.string().min(1, "Password is required"),
});

export const RefreshSchema = z.object({
  // Body is empty — refresh token comes from httpOnly cookie
  // This schema is a placeholder for documentation
});

export const AcceptInviteSchema = z.object({
  token           : z.string().min(1, "Invite token is required"),
  password,
  confirmPassword : z.string(),
}).refine(
  (data) => data.password === data.confirmPassword,
  { message: "Passwords do not match", path: ["confirmPassword"] }
);

export const ChangePasswordSchema = z.object({
  currentPassword : z.string().min(1, "Current password is required"),
  newPassword     : password,
  confirmPassword : z.string(),
}).refine(
  (data) => data.newPassword === data.confirmPassword,
  { message: "New passwords do not match", path: ["confirmPassword"] }
).refine(
  (data) => data.currentPassword !== data.newPassword,
  { message: "New password must be different from current password", path: ["newPassword"] }
);

// ─────────────────────────────────────────────────────────────────
// USER MANAGEMENT SCHEMAS
// ─────────────────────────────────────────────────────────────────

export const InviteUserSchema = z.object({
  name  : z.string().min(2, "Name must be at least 2 characters").trim(),
  email,
  tier  : z.enum(["admin", "user"], {
    errorMap: () => ({ message: "Tier must be admin or user" }),
  }),
  // roleId required only when tier is 'user'
  roleId : objectId.optional(),
}).refine(
  (data) => !(data.tier === "user" && !data.roleId),
  { message: "roleId is required for user-tier accounts", path: ["roleId"] }
);

export const UpdateProfileSchema = z.object({
  name : z.string().min(2).trim(),
});

export const ChangeRoleSchema = z.object({
  roleId : objectId,
});