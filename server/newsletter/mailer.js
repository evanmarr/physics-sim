// The actual "send an email" step. Real sending uses Gmail SMTP via
// nodemailer, gated behind two env vars (GMAIL_USER / GMAIL_APP_PASSWORD) —
// see README.md for how to create the account's App Password and set these
// on Vercel. Without both vars set, this silently falls back to the old
// stub behavior so local dev without credentials still works.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTBOX_DIR = path.join(__dirname, "..", "outbox");
// Vercel sets this on every deployment (and only there) — the standard way
// to detect "am I running as a Vercel function" from inside the function.
const isVercel = !!process.env.VERCEL;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

// Built lazily (not at module load) so a missing/invalid credential only
// breaks the actual send attempt, not every other route this file's import
// chain touches.
let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

export async function sendEmail({ to, subject, html }) {
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    await getTransporter().sendMail({
      from: `Kinetic <${GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    return { sent: true };
  }

  if (isVercel) {
    // Unlike the local-dev stub below, this isn't a safe fallback — there's
    // no developer watching a console or an outbox folder on a live
    // deployment. This used to return {sent: false} here and every caller
    // (signup/login/resend-code, sendBanNotice) ignored that return value
    // entirely, so a production deploy missing these two env vars looked
    // completely normal to every signal we had — the API still answered
    // {pending: true}, the client still showed "check your email", and
    // nothing anywhere logged more than a console.log buried in function
    // logs no one was looking at. Throwing here instead means the actual
    // request fails loudly (a real 500, caught by the route below) instead
    // of every verification code silently vanishing forever.
    console.error(`[mailer] GMAIL_USER/GMAIL_APP_PASSWORD not set on Vercel — refusing to silently no-op sending "${subject}" to ${to}`);
    throw new Error("Email is not configured on this deployment (GMAIL_USER/GMAIL_APP_PASSWORD missing).");
  }
  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const safeName = to.replace(/[^a-z0-9.@-]/gi, "_");
  const file = path.join(OUTBOX_DIR, `${Date.now()}-${safeName}.html`);
  await fs.writeFile(file, html);
  console.log(`[mailer stub] GMAIL_USER/GMAIL_APP_PASSWORD not set — wrote preview to ${path.relative(process.cwd(), file)}`);
  return { sent: false, previewFile: file };
}
