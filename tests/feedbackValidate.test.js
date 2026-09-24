import { test, assert } from "./helpers.js";
import { validateFeedback, sanitizeDiagnostics, escapeHtml, cleanEmail, feedbackEmailHtml } from "../server/feedbackValidate.js";

const base = { category: "bug", section: "physics", message: "The ball falls through the floor." };

test("feedback: accepts a minimal valid body", () => {
  const r = validateFeedback(base);
  assert.equal(r.ok, true);
  assert.equal(r.value.category, "bug");
  assert.equal(r.value.rating, null);
});
test("feedback: rejects empty and too-short messages", () => {
  assert.equal(validateFeedback({ ...base, message: "   " }).ok, false);
  assert.equal(validateFeedback({ ...base, message: "short" }).ok, false);
});
test("feedback: clamps message to 4000 chars", () => {
  assert.equal(validateFeedback({ ...base, message: "a".repeat(9000) }).value.message.length, 4000);
});
test("feedback: unknown category/section fall back to other", () => {
  const v = validateFeedback({ ...base, category: "hax", section: "../etc" }).value;
  assert.equal(v.category, "other"); assert.equal(v.section, "other");
});
test("feedback: rating must be 1-5", () => {
  assert.equal(validateFeedback({ ...base, rating: 9 }).value.rating, null);
  assert.equal(validateFeedback({ ...base, rating: "4" }).value.rating, 4);
  assert.equal(validateFeedback({ ...base, rating: 0 }).value.rating, null);
});
test("feedback: bug-only fields dropped for other categories", () => {
  const v = validateFeedback({ ...base, category: "idea", severity: "minor", steps: "x", expected: "y" }).value;
  assert.equal(v.severity, null); assert.equal(v.steps, null); assert.equal(v.expected, null);
  const b = validateFeedback({ ...base, severity: "blocking", steps: "a", expected: "b" }).value;
  assert.equal(b.severity, "blocking"); assert.equal(b.steps, "a");
});
test("feedback: honeypot rejects", () => {
  assert.equal(validateFeedback({ ...base, website: "http://spam" }).honeypot, true);
});
test("feedback: contact email validation and reply_ok", () => {
  assert.equal(validateFeedback({ ...base, contactEmail: "nope" }).ok, false);
  const v = validateFeedback({ ...base, contactEmail: "A@B.com", replyOk: true }).value;
  assert.equal(v.contactEmail, "a@b.com"); assert.equal(v.replyOk, true);
  assert.equal(validateFeedback({ ...base, replyOk: true }).value.replyOk, false);
  assert.equal(cleanEmail("x@y"), null);
});
test("feedback: diagnostics whitelisted and clamped", () => {
  const d = sanitizeDiagnostics({ userAgent: "u".repeat(999), theme: "purple", secret: "x", viewportWidth: 800, viewportHeight: 600, section: "zoology", world: { a: 1 } });
  assert.equal(d.userAgent.length, 300); assert.equal(d.theme, undefined); assert.equal(d.secret, undefined);
  assert.equal(d.world, undefined); assert.equal(d.viewportWidth, 800); assert.equal(d.section, "zoology");
  assert.equal(sanitizeDiagnostics("x"), null); assert.equal(sanitizeDiagnostics({ foo: 1 }), null);
});
test("feedback: control characters stripped", () => {
  assert.equal(validateFeedback({ ...base, message: "hello\u0000 world\u0007 ok" }).value.message, "hello world ok");
});
test("feedback: email html escapes everything", () => {
  const html = feedbackEmailHtml({ category: "bug", section: "x", message: "<script>alert(1)</script>", diagnostics: { userAgent: "<b>" } }, "id1", "a@b.com");
  assert.equal(html.includes("<script>"), false); assert.equal(html.includes("&lt;script&gt;"), true);
  assert.equal(escapeHtml(`"&'`), "&quot;&amp;&#39;");
});
