import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";

// dotenv.config() is idempotent (safe to call more than once — later
// calls are no-ops for variables already set), so calling it again here
// is harmless even though Services/Config.js already calls it. It's
// done explicitly in THIS file because the CLOUDINARY_* check below
// reads process.env at module-load time: if this module happened to be
// imported (directly or via Checklist.routes.js → Server.js's import
// order) before Config.js's own dotenv.config() had run, the env vars
// simply wouldn't exist in process.env yet — and since the check below
// only ever runs once, it would stay wrong for the lifetime of the
// process even after the vars became available moments later. Calling
// dotenv.config() here guarantees process.env is populated before this
// file reads any of it, regardless of what else has or hasn't run yet.
dotenv.config();

// ─────────────────────────────────────────────────────────────────
// Shared file-upload utility. `multer` and `cloudinary` are already
// listed in package.json but were not wired up anywhere in the
// codebase before this — this is the first module to use them.
//
// Cloudinary is used when CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY /
// CLOUDINARY_API_SECRET are set in .env; otherwise this falls back to
// local disk storage under /uploads/checklists. That fallback matters
// on Render specifically: Render's filesystem is ephemeral, so a file
// saved locally is LOST on every redeploy/restart — Cloudinary (or any
// persistent object store) is the only durable option in production.
// Local disk is fine for local development without Cloudinary keys,
// but do not rely on it in the deployed environment.
// ─────────────────────────────────────────────────────────────────

const hasCloudinary =
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

if (hasCloudinary) {
  cloudinary.config({
    cloud_name : process.env.CLOUDINARY_CLOUD_NAME,
    api_key    : process.env.CLOUDINARY_API_KEY,
    api_secret : process.env.CLOUDINARY_API_SECRET,
  });
} else {
  console.warn(
    "⚠️  CLOUDINARY_* env vars not set — checklist document uploads will use local disk storage, " +
    "which does NOT persist across Render redeploys/restarts. Set CLOUDINARY_CLOUD_NAME, " +
    "CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in .env before relying on this in production."
  );
}

// multer keeps the file in memory — small compliance documents only
// (10MB cap below), so buffering in memory rather than streaming to
// disk first is simpler and fine at this size.
const storage = multer.memoryStorage();

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export const uploadDocument = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Unsupported file type. Upload a PDF, Word document, or image."));
    }
    cb(null, true);
  },
});

const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "uploads", "checklists");

function ensureLocalDir() {
  if (!fs.existsSync(LOCAL_UPLOAD_DIR)) fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true });
}

// Saves req.file (populated by uploadDocument.single('document')) to
// whichever backend is configured, and returns the fields the
// Checklist document stores. `publicId` is only non-null for
// Cloudinary — used later to delete/replace the file.
//
// `originUrl` (e.g. `${req.protocol}://${req.get('host')}`, built by the
// controller from the live request — never hardcoded here) matters only
// for the local-disk fallback below. Cloudinary's `secure_url` is
// already a fully-qualified URL pointing at Cloudinary's own domain, so
// it's unaffected either way. The local-disk branch used to return a
// bare relative path like `/uploads/checklists/xyz.jpg` — that broke in
// production because the frontend and backend are served from different
// origins (Apache-hosted SPA vs. the Render API), so a relative link
// opened from a frontend page resolved against the FRONTEND's own origin
// and base path, not the backend — landing on the SPA's router instead
// of the actual file. Prefixing with the request's real origin makes the
// browser navigate straight to the backend regardless of what path the
// frontend happens to be served under.
export async function storeUploadedFile(file, originUrl) {
  if (!file) throw new Error("No file provided.");

  if (hasCloudinary) {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "clubexpense/checklists", resource_type: "auto" },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });
    return {
      documentName     : file.originalname,
      documentUrl      : result.secure_url,
      documentPublicId : result.public_id,
    };
  }

  // Local disk fallback
  ensureLocalDir();
  const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  fs.writeFileSync(path.join(LOCAL_UPLOAD_DIR, safeName), file.buffer);
  const relativePath = `/uploads/checklists/${safeName}`;
  return {
    documentName     : file.originalname,
    documentUrl      : originUrl ? `${originUrl}${relativePath}` : relativePath, // absolute when originUrl is provided — see comment above
    documentPublicId : "",
  };
}

// Deletes a previously stored file — called when a document is
// replaced or its checklist item is hard-deleted. Safe to call with an
// empty/missing publicId or url (no-ops).
export async function deleteStoredFile({ documentUrl, documentPublicId }) {
  try {
    if (hasCloudinary && documentPublicId) {
      await cloudinary.uploader.destroy(documentPublicId, { resource_type: "auto" });
    } else if (documentUrl?.includes("/uploads/checklists/")) {
      // documentUrl may be a full absolute URL (current format, see
      // storeUploadedFile above) or a bare relative path (records saved
      // before that fix) — this handles both by pulling out just the
      // "/uploads/checklists/xyz.jpg" segment either way, rather than
      // assuming one specific shape.
      const relativePath = documentUrl.slice(documentUrl.indexOf("/uploads/checklists/"));
      const filePath = path.join(process.cwd(), relativePath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } catch (err) {
    // Deletion failures shouldn't block the request that triggered them
    // (e.g. re-uploading a replacement document) — just log it.
    console.error("[deleteStoredFile]", err.message);
  }
}

export const isCloudinaryConfigured = hasCloudinary;