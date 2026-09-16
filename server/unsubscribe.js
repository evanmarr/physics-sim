// Shared by server.js (verifying a click) and newsletter/send.js (minting
// the link) so both sides compute the exact same token from the exact same
// secret — a hand-duplicated HMAC in two files is exactly the kind of thing
// that quietly drifts and breaks unsubscribe links.
import crypto from "node:crypto";

export function unsubscribeToken(email, secret) {
  return crypto.createHmac("sha256", secret).update(email).digest("hex");
}
