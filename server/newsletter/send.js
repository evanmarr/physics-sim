// Assembles and "sends" the monthly newsletter. Run standalone (not
// through server.js) so sending doesn't depend on the web server being up
// at the exact right minute — see the cron/launchd setup in README.md.
//
// Content rotates through content.json one entry per send; news.txt and
// ads.txt are read fresh each run, so editing them before the 1st is all
// that's needed for that month's issue.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unsubscribeToken } from "../unsubscribe.js";
import { renderNewsletterHtml } from "./template.js";
import { sendEmail } from "./mailer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data.json");
const CONTENT_FILE = path.join(__dirname, "content.json");
const NEWS_FILE = path.join(__dirname, "news.txt");
const ADS_FILE = path.join(__dirname, "ads.txt");
const SITE_URL = process.env.SITE_URL || "http://localhost:5173";
const NEWS_PLACEHOLDER_MARKER = "Replace this with this month's science news";

async function readDb() {
  let raw;
  try {
    raw = await fs.readFile(DATA_FILE, "utf8");
  } catch {
    throw new Error(`Couldn't read ${DATA_FILE} — run \`node server/server.js\` at least once first (it creates this file).`);
  }
  const db = JSON.parse(raw);
  if (!db.unsubscribeSecret) {
    throw new Error("data.json has no unsubscribeSecret yet — start server.js once (even briefly) before running this.");
  }
  return db;
}

// Re-reads the file right before writing so a concurrently-running
// server.js (a user signing up mid-send, say) isn't clobbered — only the
// two fields this script owns are merged in, everything else is whatever
// is on disk at that moment.
async function updateNewsletterState(patch) {
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const db = JSON.parse(raw);
  db.newsletter = { ...db.newsletter, ...patch };
  const tmp = DATA_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(db, null, 2));
  await fs.rename(tmp, DATA_FILE);
}

async function readOptionalText(file) {
  try { return await fs.readFile(file, "utf8"); }
  catch { return ""; }
}

// --preview renders exactly one issue to server/outbox/ without touching
// the mailing list, the content rotation, or lastSentAt — safe to run as
// many times as you want while you're still writing news.txt/ads.txt.
const isPreview = process.argv.includes("--preview");
const previewEmail = process.argv.find((a) => a.includes("@")) || "preview@example.com";

async function main() {
  const db = await readDb();
  const recipients = isPreview ? [previewEmail] : db.mailingList || [];
  if (recipients.length === 0) {
    console.log("Mailing list is empty — nothing to send.");
    return;
  }

  const content = JSON.parse(await fs.readFile(CONTENT_FILE, "utf8"));
  if (!content.length) throw new Error("content.json has no entries — add at least one scientist/equation/fact set.");
  const index = (db.newsletter?.nextContentIndex || 0) % content.length;
  const issue = content[index];

  const news = await readOptionalText(NEWS_FILE);
  if (news.includes(NEWS_PLACEHOLDER_MARKER)) {
    console.warn("Heads up: news.txt still has the default placeholder text — edit it with this month's actual news before a real send.");
  }
  const ads = await readOptionalText(ADS_FILE);

  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const subject = `Continuum — ${monthLabel} newsletter${isPreview ? " (preview)" : ""}`;

  let sent = 0, failed = 0;
  for (const email of recipients) {
    const token = unsubscribeToken(email, db.unsubscribeSecret);
    const unsubscribeUrl = `${SITE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
    const html = renderNewsletterHtml({ monthLabel, scientist: issue.scientist, equation: issue.equation, fact: issue.fact, news, ads, unsubscribeUrl });
    try {
      await sendEmail({ to: email, subject, html });
      sent++;
    } catch (e) {
      failed++;
      console.error(`Failed to send to ${email}:`, e.message);
    }
  }

  if (isPreview) {
    console.log(`Preview written using content entry #${index} (${issue.scientist.name}) — mailing list and rotation untouched.`);
    return;
  }
  await updateNewsletterState({ nextContentIndex: (index + 1) % content.length, lastSentAt: now.toISOString() });
  console.log(`Newsletter run complete: ${sent} sent, ${failed} failed, content entry #${index} (${issue.scientist.name}).`);
}

main().catch((err) => {
  console.error("Newsletter send failed:", err.message);
  process.exit(1);
});
