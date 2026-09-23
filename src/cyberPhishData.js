// Extra emails for the "Spot the phishing email" simulator. Same shape as the
// originals in cyberSimulators.js: { from, subject, clues[], body(mark) }.
// clues[0] is always a substring of `from`; body() calls mark() once per
// remaining clue, in order. Extra fields: legit (bool), headers (string).
// All domains are fictional (.example/.invalid or look-alikes of nothing real).
// Segments: plain string, or [text, reason] for a clickable clue.

function mk(from, subject, fromClue, parts, opts = {}) {
  const clues = [{ text: fromClue[0], reason: fromClue[1] }];
  for (const p of parts) if (Array.isArray(p)) clues.push({ text: p[0], reason: p[1] });
  return {
    from, subject, clues,
    legit: !!opts.legit,
    headers: opts.headers || "",
    body: (mark) => parts.map((p) => (Array.isArray(p) ? mark(p[0]) : p)).join(""),
  };
}
const L = true;

export const EXTRA_EMAILS = [
  // ---- credential harvest / look-alikes ----
  mk("Microsoft 365 Team <no-reply@micros0ft-365-verify.example>", "Your password expires today", ["micros0ft-365-verify.example", "A zero replaces the letter o and extra words are added. The genuine sender domain is short and exact."], [
    "Hello user,<br><br>", ["Your password expires in 2 hours", "Password-expiry countdowns are a pressure tactic. Real IT systems warn days ahead and let you change it from your normal sign-in."],
    ". To keep access to email and files, ", ["sign in at http://365-login.secure-check.invalid", "The visible link goes to an unrelated domain, not your company's real sign-in page. Hover to see the true destination before clicking."],
    ".<br><br>Access will be ", ["permanently disabled and files deleted", "Threatening data loss is meant to scare you into acting before verifying."], ".<br><br>IT Helpdesk"],
    { headers: "Reply-To: helpdesk.collect@mailbox-drop.invalid; SPF: fail; DKIM: none" }),
  mk("Accounts <billing@rnicrosoft-invoices.example>", "Invoice #88213 overdue - final notice", ["rnicrosoft-invoices.example", "\"rn\" pretending to be \"m\". At a glance rnicrosoft reads as microsoft, which is exactly the trick."], [
    "Dear Sir/Madam,<br><br>Your invoice is ", ["FINAL NOTICE: 3 days overdue", "Capitalised warnings and escalating wording are pressure tactics used in fake invoices."],
    ". Open the attached ", ["Invoice_88213.pdf.exe", "A double extension. The real file type is .exe, an executable program, not a PDF. Never open it."], " to review charges.<br><br>Regards, Accounts Dept"],
    { headers: "Received: from unknown (203.0.113.44); SPF: softfail; Attachment: application/x-msdownload" }),
  mk("PayPal Service <service@paypal.com.security-check.example>", "Unusual sign-in attempt on your account", ["paypal.com.security-check.example", "Read a domain from right to left. The real domain here is security-check.example; paypal.com is just a subdomain prefix put there to fool you."], [
    "Hi,<br><br>We noticed a sign-in from a new device. ", ["Confirm within 12 hours or your balance will be frozen", "A short deadline and a threat to your money are classic coercion."],
    "<br><br>", ["Log in to PayPal", "Link text says one thing but the destination is https://paypal.com.security-check.example/login, the attacker's site."], "<br><br>Customer Support"]),
  mk("Bank Alerts <alerts@northfield-bank-secure.example>", "Suspicious transaction: $1,249.00 declined", ["northfield-bank-secure.example", "A bank name with \"secure\" tacked on is not the bank's own domain. Banks use their one official domain."], [
    "Dear Valued Customer,<br><br>", ["A $1,249.00 charge was flagged. Reply with your full card number and PIN to cancel it", "Banks never ask for your PIN or full card number by email or phone."],
    "<br><br>Or call ", ["1-800-555-0199 immediately", "A phone number supplied by the message itself may reach the scammer. Use the number printed on your card."], ".<br><br>Fraud Prevention"]),
  mk("Google Docs <drive-shares@docs-goog1e-share.example>", "Maria Lopez shared \"Q3 Salary Review\" with you", ["docs-goog1e-share.example", "A \"1\" in place of \"l\" in a fake Google-style domain. Real shares come from the official service domain."], [
    "Maria Lopez has invited you to view a document.<br><br>", ["Open in Docs", "Button destination is a page asking you to sign in with your password, a credential-harvest trap that copies a real login screen."],
    "<br><br>", ["Sign in with your email password to view", "A shared document never needs your email password. Real shares open using your existing signed-in session."], "<br><br>You received this because someone shared a file."]),
  mk("Chris (CEO) <chris.walker@company-execs.example>", "Quick favor - are you at your desk?", ["company-execs.example", "Not your company's real domain, and the display name borrows an executive's name. Check the actual address, not the display name."], [
    "Hi,<br><br>I'm in meetings and can't take calls. ", ["I need you to buy 5 gift cards at $200 each", "Gift-card requests are a hallmark of business email compromise. Cards are untraceable, and no real executive asks staff this way."],
    " for a client gift. ", ["Keep this confidential and reply with the codes ASAP", "Secrecy and speed stop you from verifying with colleagues, which is how the fraud is caught."], "<br><br>Sent from my iPhone"],
    { headers: "Reply-To: chris.walker.ceo@mailbox-drop.invalid; From-display differs from real address" }),
  mk("Finance Director <d.owens@vendor-payments.example>", "Updated bank details for Invoice 4471", ["vendor-payments.example", "A generic payments domain unrelated to the actual vendor whose invoice is being changed."], [
    "Hello,<br><br>Our bank has changed. ", ["Please send this month's payment to the new account below", "Sudden banking-detail changes are a top BEC scheme. Always confirm by calling a known number, never one in the email."],
    "<br><br>Account: 000-0000-000 (fictional)<br><br>", ["The transfer must go out today to avoid a late fee", "Artificial deadline to prevent verification."], "<br><br>Thanks"]),
  mk("DeliverEx Tracking <notice@deliverex-parcel-info.example>", "Your package could not be delivered", ["deliverex-parcel-info.example", "An invented tracking domain, not the carrier's real site. Go to the carrier's site yourself and type in your tracking number."], [
    "Package ID 77-2291 is on hold. ", ["Pay a $1.99 redelivery fee within 24 hours", "Small fees are a hook to capture your card details. Carriers rarely collect payment by email link."],
    "<br><br>", ["Track your parcel: hxxp://parcel-fee.invalid/pay", "The link is a payment page on an unrelated domain."], "<br><br>Reply STOP to unsubscribe"]),
  mk("Tax Refund Office <refunds@tax-gov-refund.example>", "You are owed a tax refund of $842.17", ["tax-gov-refund.example", "Government agencies use their official domain and do not start contact by email about refunds."], [
    "Dear Taxpayer,<br><br>", ["You are eligible for a refund of $842.17", "Unexpected money is the bait. Tax agencies do not send unsolicited refund offers."],
    "<br><br>", ["Enter your SSN and bank details to claim", "No agency asks for your Social Security number and bank login by email link."], "<br><br>", ["Offer expires in 48 hours or a penalty applies", "Threats and deadlines again."], "<br><br>Refund Department"]),
  mk("Lottery Board <winner@intl-lotto-award.example>", "CONGRATULATIONS! You won $2,500,000", ["intl-lotto-award.example", "A random lottery domain. You cannot win a lottery you never entered."], [
    "Dear Lucky Winner,<br><br>", ["Your email was randomly selected as the grand prize winner", "Winning without entering is impossible. This is the setup for an advance-fee scam."],
    "<br><br>To release funds, ", ["pay a $150 processing fee via wire transfer", "Legitimate prizes never require you to pay a fee first."], ".<br><br>Claims Officer"]),
  mk("Account Support <verify@instagrarn-support.example>", "Your account will be deleted - verify now", ["instagrarn-support.example", "\"rn\" is impersonating \"m\" in a brand-like name. Look-alike domains are cheap to register."], [
    "Hello,<br><br>", ["Copyright violation reported: your page will be disabled in 24 hours", "Fake policy violations with a countdown are common social-media lures."],
    "<br><br>", ["Verify your account to appeal", "Link leads to a fake login page that steals your username and password."], "<br><br>", ["Send a photo of your ID to confirm ownership", "Requests for ID documents let criminals commit identity theft."], "<br><br>Support"]),
  mk("Wallet Support <security@metamaskk-wallet.example>", "Wallet compromised: restore now", ["metamaskk-wallet.example", "A doubled letter in a wallet-style name. Fake domain."], [
    "Alert,<br><br>", ["Your wallet has been flagged and will be locked", "Fear of losing funds is the lever."], "<br><br>", ["Enter your 12-word recovery phrase to validate", "Anyone with your recovery phrase can drain the wallet. No real support ever asks for it."],
    "<br><br>", ["Connect wallet to claim free airdrop", "Wallet-drainer sites trick you into signing transactions that hand over assets."], "<br><br>Team"]),
  mk("Talent Team <recruiter@careers-globalcorp-hire.example>", "Job offer: $45/hr remote data entry", ["careers-globalcorp-hire.example", "A generic hiring domain, not the company's own careers site."], [
    "Hi,<br><br>", ["No interview required - you're hired", "Real jobs interview you. Instant offers signal a scam."],
    "<br><br>We'll mail a check; ", ["deposit it and send back $800 for equipment via gift cards", "Fake check scam: the check bounces later and you lose the money you sent."],
    "<br><br>", ["Send your SSN and a copy of your passport today", "Collecting sensitive ID before any real hiring process is identity-theft bait."], "<br><br>HR"]),
  mk("Scan Center <scanner@copier-docs.example>", "Scanned document from office printer", ["copier-docs.example", "Your office printer would use your company's own domain, not an unrelated one."], [
    "You have a new scan. ", ["Open Scan_0923.html", "An HTML attachment opens a fake login form in your browser. Scans are normally PDFs."],
    "<br><br>", ["Enable macros to view content", "Being told to enable macros or editing is a standard malware trigger."], "<br><br>Sent by MFP-Scanner"]),
  mk("Parking Services <pay@city-parking-fines.example>", "Scan to pay your parking violation", ["city-parking-fines.example", "A generic fines domain, not the city's official site."], [
    "Violation #90211 outstanding.<br><br>", ["Scan the QR code below to pay now", "Quishing: QR codes hide the true URL from you and slip past email filters. Type the official site yourself."],
    "<br><br>[QR IMAGE]<br><br>", ["Fines double after 24 hours", "Doubling penalties create urgency."], "<br><br>Municipal Services"]),
  mk("Re: Contract review <sam.ortiz@partner-legal-docs.example>", "RE: RE: Contract draft - updated version", ["partner-legal-docs.example", "You know Sam from a real thread, but this address is a new look-alike domain. Attackers hijack threads and reply from a fake address."], [
    "Hi, following up on our thread from last week. ", ["Please review the updated draft here: https://share-docs.example/sign", "A link in a hijacked thread. The context feels real, but the link goes to a credential-harvest page."],
    "<br><br>", ["I need your signature today before the deal closes", "Pushing for speed inside a familiar conversation lowers your guard."], "<br><br>Sam"],
    { headers: "In-Reply-To: forged; Return-Path differs from From domain" }),
  mk("Helpdesk <helpdesk@it-support-mailbox.example>", "Mailbox full - action required", ["it-support-mailbox.example", "Not your organization's real IT domain."], [
    "Your mailbox is ", ["99% full. Emails will bounce unless you upgrade now", "A fake storage warning meant to make you click."], ".<br><br>", ["Upgrade storage: login.mail-quota.invalid", "Unrelated domain that copies a webmail login."], "<br><br>System Admin"]),
  mk("Streaming Billing <billing@streamflix-accounts.example>", "Payment failed - update card", ["streamflix-accounts.example", "A subscription-brand look-alike, not the service's own domain."], [
    "Dear member,<br><br>", ["We couldn't process your payment; your subscription ends tonight", "Threat of losing service by tonight."], "<br><br>", ["Update your card details here", "The form steals your card number, CVV, and billing address."], "<br><br>Billing"]),
  mk("Compliance <compliance@company-training-portal.example>", "Mandatory security training - login required", ["company-training-portal.example", "Not the training platform your company actually uses."], [
    "All staff must complete training. ", ["Sign in with your work password to begin", "A training site never needs your main work password from an email link."],
    "<br><br>", ["Non-compliance will be reported to management", "Fear of getting in trouble drives clicks."], "<br><br>Compliance"]),
  mk("Support <support@apple-id-locked.example>", "Your Apple ID has been locked", ["apple-id-locked.example", "Descriptive words attached to a brand name signal a fake domain."], [
    "Your ID was used to sign in on an unknown device. ", ["Unlock now or lose access permanently", "Permanent-loss threat."], "<br><br>", ["Verify your identity and payment method", "Asks for payment data on a sign-in page."], "<br><br>Support"]),

  // ---- legitimate look-suspicious emails ----
  mk("Northwind Shop <orders@shop.northwind.example>", "Your order has shipped", ["shop.northwind.example", "This is the store's own domain and matches the shop you ordered from. The domain is the anchor you can trust."], [
    "Hi Jordan,<br><br>Thanks for your order #48213 (you placed it on Tuesday). ", ["Tracking: shipped via the carrier, arriving Friday", "Specific details you recognise (order number, your name, something you bought) show a real order. You can also check the shop's site yourself."],
    "<br><br>You can view this order by signing in on our site directly, no login link needed here.<br><br>Northwind Support"],
    { legit: L, headers: "SPF: pass; DKIM: pass; DMARC: pass" }),
  mk("Account Security <no-reply@accounts.streamly.example>", "Reset your password", ["accounts.streamly.example", "The domain matches the service, and you did request this reset a minute ago."], [
    "We received a request to reset your password. ", ["This link works for 60 minutes", "Time-limited reset links are normal. It is only urgent because you triggered it."],
    "<br><br>If you did not request this, ignore the email; nothing changes. ", ["We will never ask for your password by email", "Real services say this and follow it."], "<br><br>Streamly Team"],
    { legit: L, headers: "SPF: pass; DKIM: pass; you requested this reset" }),
  mk("IT Helpdesk <helpdesk@yourcompany.example>", "Scheduled maintenance this Saturday 2-4 AM", ["yourcompany.example", "Sent from your company's real domain, with a matching internal ticket on the IT portal."], [
    "Hello all,<br><br>", ["Email will be unavailable during the maintenance window", "An advance notice with a specific window and no action needed is typical of real IT."],
    "<br><br>No action is required. ", ["Questions? Open a ticket via the IT portal you already use", "Directs you to your usual channel rather than a new link."], "<br><br>IT Team"],
    { legit: L, headers: "SPF: pass; DKIM: pass; internal sender" }),
  mk("Bank Alerts <alerts@northfield.example>", "New sign-in to your online banking", ["northfield.example", "The exact bank domain you have on your card, and the email asks for nothing."], [
    "Hi Jordan,<br><br>", ["A sign-in from a new device occurred at 9:14 AM", "It gives details you can verify without clicking anything."],
    "<br><br>If this was you, no action needed. If not, ", ["call the number on the back of your card", "It points you to a trusted number, not one embedded in the email."], "<br><br>Northfield Bank"],
    { legit: L, headers: "SPF: pass; DKIM: pass; DMARC: pass" }),
  mk("Calendar <invites@calendar.yourcompany.example>", "Invitation: Team sync Thursday 10:00", ["calendar.yourcompany.example", "A subdomain of your company's own domain, which is fine. What matters is the registered domain on the right."], [
    "Priya invited you to a meeting. ", ["Join via the video link listed in your calendar", "Meeting matches your existing calendar entry."], "<br><br>Agenda attached in the invite itself.<br><br>Calendar"],
    { legit: L, headers: "SPF: pass; DKIM: pass" }),
  mk("Parcel Notice <tracking@carrier.example>", "Delivery attempt: package left with neighbor", ["carrier.example", "The real carrier domain, and you are expecting a package. It asks you to do nothing except pick it up."], [
    "Your parcel from an order you placed was left with a neighbour at no. 12. ", ["Pick it up there; no fee is required", "Real delivery notices do not ask for payment via link."], "<br><br>Track at the carrier's site directly.<br><br>Delivery Team"],
    { legit: L, headers: "SPF: pass; DKIM: pass" }),
  mk("Payroll <payroll@yourcompany.example>", "Your October pay statement is available", ["yourcompany.example", "It is sent from your company's actual domain."], [
    "Hi,<br><br>", ["Your statement is available in the payroll portal", "It tells you to use the portal you already know, rather than a login link."],
    "<br><br>", ["No action is needed unless something looks wrong", "Nothing is urgent and nothing is asked of you."], "<br><br>Payroll"],
    { legit: L, headers: "SPF: pass; DKIM: pass" }),
];
