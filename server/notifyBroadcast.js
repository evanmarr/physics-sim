// Sends an in-app Notification Center broadcast — product updates,
// "a newsletter went out" notices, and donor thank-you messages. Run
// standalone (not through server.js), the same way server/newsletter/
// send.js is: this is the "reuse the existing admin systems" integration
// point for those three notification kinds — the external admin app
// (~/physics-sim-admin) can call this exact same way (spawn it, or import
// db.js's insertBroadcastNotifications/listAllUserEmails/getMailingList
// directly), instead of a new authenticated HTTP admin API.
//
// This never sends a real email or push notification — it only writes
// rows to the notifications table for signed-in users to see next time
// they open the bell. Real email/push is explicitly out of scope for now.
//
// Usage:
//   node server/notifyBroadcast.js product-update "Title" "Body text" [broadcastId]
//   node server/notifyBroadcast.js newsletter "Title" "Body text" [broadcastId]
//   node server/notifyBroadcast.js donor-thanks donor@example.com "Title" "Body text" [broadcastId]
//
// broadcastId is this run's idempotency key (see db.js's
// notifications_oneshot_idx) — re-running the SAME broadcastId is a
// guaranteed no-op per recipient, so a retried cron run or a
// double-submitted admin form can never duplicate a notification.
// Omit it and one is generated from the kind + a day-granularity
// timestamp, which is enough to protect against an accidental
// back-to-back re-run of the same command without demanding the caller
// track ids by hand.
import * as db from "./db.js";

const KIND_FOR = { "product-update": "product_update", "newsletter": "newsletter", "donor-thanks": "donor_thanks" };

function usageAndExit() {
  console.error(
    "Usage:\n" +
    '  node server/notifyBroadcast.js product-update "Title" "Body text" [broadcastId]\n' +
    '  node server/notifyBroadcast.js newsletter "Title" "Body text" [broadcastId]\n' +
    '  node server/notifyBroadcast.js donor-thanks donor@example.com "Title" "Body text" [broadcastId]'
  );
  process.exitCode = 1;
}

async function main() {
  const [rawKind, ...rest] = process.argv.slice(2);
  const kind = KIND_FOR[rawKind];
  if (!kind) return usageAndExit();

  await db.ensureSchema();

  let recipients, title, body, broadcastId;
  if (kind === "donor_thanks") {
    const [donorEmail, t, b, id] = rest;
    if (!donorEmail || !t) return usageAndExit();
    const user = await db.getUser(donorEmail.trim().toLowerCase());
    if (!user) { console.error(`No account found for ${donorEmail} — a donor thank-you needs a real signed-in account to notify.`); process.exitCode = 1; return; }
    recipients = [user.email];
    title = t;
    body = b || "";
    broadcastId = id || `donor_thanks:${user.email}:${new Date().toISOString().slice(0, 10)}`;
  } else {
    const [t, b, id] = rest;
    if (!t) return usageAndExit();
    title = t;
    body = b || "";
    recipients = kind === "product_update" ? await db.listAllUserEmails() : await db.getMailingList();
    broadcastId = id || `${kind}:${new Date().toISOString().slice(0, 10)}`;
  }

  if (!recipients.length) {
    console.log("No recipients — nothing to send.");
    return;
  }
  const inserted = await db.insertBroadcastNotifications(recipients, { kind, title, body, broadcastId });
  const skipped = recipients.length - inserted;
  console.log(
    `"${title}" (${kind}, broadcastId=${broadcastId}): ${inserted} new notification(s) sent` +
    (skipped ? `, ${skipped} already had this broadcast (skipped, not duplicated).` : ".")
  );
}

main()
  .catch((err) => {
    console.error("Broadcast failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.closePool());
