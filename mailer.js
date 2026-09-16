// The actual "send an email" step — deliberately a stub for now. Real
// sending needs a provider (Gmail SMTP + an App Password, or an HTTP API
// like Resend/SendGrid/Mailgun/Postmark) and a credential only you can
// create, so nothing here talks to the network yet. Wiring up a real
// provider later means replacing the body of sendEmail() with that
// provider's actual call — everything else (content, scheduling,
// unsubscribe) already works and doesn't change.
//
// Locally, every "send" writes the exact HTML that would have been emailed
// to server/outbox/ so you can open it in a browser. On Vercel that trick
// doesn't work — a deployed function's own code directory is read-only, so
// writing there throws (which was silently breaking every signup/login,
// since generating the verification code always calls this) — so instead
// this logs the content to the function's console output, viewable from
// the Vercel dashboard's Logs tab for that deployment.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTBOX_DIR = path.join(__dirname, "..", "outbox");
// Vercel sets this on every deployment (and only there) — the standard way
// to detect "am I running as a Vercel function" from inside the function.
const isVercel = !!process.env.VERCEL;

export async function sendEmail({ to, subject, html }) {
  if (isVercel) {
    console.log(`[mailer stub] Would send "${subject}" to ${to}:\n${html}`);
    return { sent: false };
  }
  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const safeName = to.replace(/[^a-z0-9.@-]/gi, "_");
  const file = path.join(OUTBOX_DIR, `${Date.now()}-${safeName}.html`);
  await fs.writeFile(file, html);
  console.log(`[mailer stub] Would send "${subject}" to ${to} — wrote preview to ${path.relative(process.cwd(), file)}`);
  return { sent: false, previewFile: file };
}
