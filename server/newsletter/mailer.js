// The actual "send an email" step — deliberately a stub for now. Real
// sending needs a provider (Gmail SMTP + an App Password, or an HTTP API
// like Resend/SendGrid/Mailgun/Postmark) and a credential only you can
// create, so nothing here talks to the network yet. Wiring up a real
// provider later means replacing the body of sendEmail() with that
// provider's actual call — everything else (content, scheduling,
// unsubscribe) already works and doesn't change.
//
// Until then, every "send" writes the exact HTML that would have been
// emailed to server/outbox/ so you can open it in a browser and see
// precisely what subscribers would receive.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTBOX_DIR = path.join(__dirname, "..", "outbox");

export async function sendEmail({ to, subject, html }) {
  await fs.mkdir(OUTBOX_DIR, { recursive: true });
  const safeName = to.replace(/[^a-z0-9.@-]/gi, "_");
  const file = path.join(OUTBOX_DIR, `${Date.now()}-${safeName}.html`);
  await fs.writeFile(file, html);
  console.log(`[mailer stub] Would send "${subject}" to ${to} — wrote preview to ${path.relative(process.cwd(), file)}`);
  return { sent: false, previewFile: file };
}
