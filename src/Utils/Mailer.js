import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config(); // same defensive reasoning as Utils/upload.js — guarantees
                  // env vars are populated before this file reads them,
                  // regardless of import order elsewhere in the app.

// ─────────────────────────────────────────────────────────────────
// Sends the finalized RFP to the client's email once it's approved.
// Uses SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM from
// .env. If they're not set, sendMail logs a clear warning and returns
// { sent: false } instead of throwing — the caller (PartyQuery
// controller) treats that as "couldn't actually send," NOT as
// "successfully shared," so rfpStatus is never marked 'shared' for an
// email that didn't go out. `nodemailer` is not yet in package.json —
// add it (`npm install nodemailer`) before this can send anything for
// real.
// ─────────────────────────────────────────────────────────────────

const hasSmtp =
  !!process.env.SMTP_HOST &&
  !!process.env.SMTP_USER &&
  !!process.env.SMTP_PASS;

let transporter = null;
if (hasSmtp) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
} else {
  console.warn(
    "⚠️  SMTP_HOST / SMTP_USER / SMTP_PASS not set — RFP emails cannot be sent. " +
    "Set them in .env before relying on the 'Send RFP to client' action."
  );
}

export const isMailConfigured = hasSmtp;

// Returns { sent: boolean, error?: string } — never throws, so a
// misconfigured mailer degrades to a clear in-app error message rather
// than a 500.
export async function sendRfpEmail({ to, partyName, rfpNo, html, attachmentBuffer, attachmentName }) {
  if (!transporter) {
    return { sent: false, error: "Email is not configured on this server yet (SMTP_HOST/SMTP_USER/SMTP_PASS missing)." };
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `Your event proposal${rfpNo ? ` — RFP ${rfpNo}` : ""}${partyName ? ` (${partyName})` : ""}`,
      html,
      attachments: attachmentBuffer
        ? [{ filename: attachmentName || "RFP.pdf", content: attachmentBuffer }]
        : undefined,
    });
    return { sent: true };
  } catch (err) {
    console.error("[sendRfpEmail]", err.message);
    return { sent: false, error: err.message };
  }
}