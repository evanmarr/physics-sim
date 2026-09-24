// Pure validation/sanitization for the feedback form. No I/O — imported by
// server/server.js and tests/feedbackValidate.test.js. Everything is
// whitelisted or clamped; unknown fields are dropped.

export const FEEDBACK_CATEGORIES = ["bug", "idea", "content", "confusing", "praise", "other"];
export const FEEDBACK_SECTIONS = ["home", "physics", "chemistry", "astronomy", "history", "cybersecurity", "particles", "mathematics", "whiteboard", "economics", "zoology", "sound", "sustainability", "war", "classroom", "account", "other"];
export const FEEDBACK_SEVERITIES = ["minor", "annoying", "blocking"];
export const FEEDBACK_STATUSES = ["new", "triaged", "resolved", "wontfix"];
export const FEEDBACK_LIMITS = { message: 4000, minMessage: 10, steps: 2000, expected: 2000, email: 254 };

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const THEMES = ["light", "dark"];

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Strips control chars (keeps \n and \t), trims, clamps.
export function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
}

export function cleanEmail(v) {
  const e = cleanText(v, FEEDBACK_LIMITS.email).toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

function short(v, max) { return cleanText(typeof v === "string" ? v : "", max).replace(/\n/g, " "); }
function num(v, min, max) { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : null; }

// Only these diagnostic keys are ever stored, each type-checked and clamped.
export function sanitizeDiagnostics(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out = {};
  const page = short(d.page, 200); if (page) out.page = page;
  const section = FEEDBACK_SECTIONS.includes(d.section) ? d.section : null; if (section) out.section = section;
  const version = short(d.appVersion, 60); if (version) out.appVersion = version;
  const ua = short(d.userAgent, 300); if (ua) out.userAgent = ua;
  const w = num(d.viewportWidth, 1, 20000), h = num(d.viewportHeight, 1, 20000);
  if (w && h) { out.viewportWidth = w; out.viewportHeight = h; }
  if (THEMES.includes(d.theme)) out.theme = d.theme;
  const dm = short(d.deviceMode, 40); if (dm) out.deviceMode = dm;
  const plan = short(d.plan, 40); if (plan) out.plan = plan;
  const ts = short(d.timestamp, 40); if (ts && !Number.isNaN(Date.parse(ts))) out.timestamp = ts;
  return Object.keys(out).length ? out : null;
}

// Returns { ok: true, value } or { ok: false, error, honeypot? }.
export function validateFeedback(body) {
  const b = body && typeof body === "object" ? body : {};
  if (typeof b.website === "string" && b.website.trim()) return { ok: false, error: "Couldn't send feedback.", honeypot: true };
  const message = cleanText(b.message, FEEDBACK_LIMITS.message);
  if (!message) return { ok: false, error: "Please tell us what happened or what your idea is." };
  if (message.length < FEEDBACK_LIMITS.minMessage) return { ok: false, error: `Please write at least ${FEEDBACK_LIMITS.minMessage} characters so we can act on it.` };
  const category = FEEDBACK_CATEGORIES.includes(b.category) ? b.category : "other";
  const section = FEEDBACK_SECTIONS.includes(b.section) ? b.section : "other";
  const isBug = category === "bug";
  const contactEmail = cleanEmail(b.contactEmail);
  if (b.contactEmail && String(b.contactEmail).trim() && !contactEmail) return { ok: false, error: "That contact email doesn't look right." };
  return {
    ok: true,
    value: {
      category, section, message,
      rating: num(b.rating, 1, 5),
      severity: isBug && FEEDBACK_SEVERITIES.includes(b.severity) ? b.severity : null,
      steps: isBug ? cleanText(b.steps, FEEDBACK_LIMITS.steps) || null : null,
      expected: isBug ? cleanText(b.expected, FEEDBACK_LIMITS.expected) || null : null,
      contactEmail,
      replyOk: !!contactEmail && b.replyOk === true,
      diagnostics: b.diagnostics ? sanitizeDiagnostics(b.diagnostics) : null,
    },
  };
}

// Human-readable HTML body for the notification email (every value escaped).
export function feedbackEmailHtml(f, id, fromEmail) {
  const row = (k, v) => (v ? `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;vertical-align:top;">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>` : "");
  const block = (k, v) => (v ? `<p style="margin:12px 0 2px;color:#6b7280;">${escapeHtml(k)}</p><p style="margin:0;white-space:pre-wrap;">${escapeHtml(v)}</p>` : "");
  const diag = f.diagnostics ? Object.entries(f.diagnostics).map(([k, v]) => row(k, v)).join("") : "";
  return `<table style="font-size:14px;">${row("Reference", id)}${row("Category", f.category)}${row("Section", f.section)}${row("Rating", f.rating ? `${f.rating}/5` : "")}${row("Severity", f.severity)}${row("From", fromEmail || "(anonymous)")}${row("Contact", f.contactEmail)}${row("OK to reply", f.contactEmail ? (f.replyOk ? "yes" : "no") : "")}</table>`
    + block("Message", f.message) + block("Steps to reproduce", f.steps) + block("Expected", f.expected)
    + (diag ? `<p style="margin:12px 0 2px;color:#6b7280;">Diagnostics</p><table style="font-size:12px;">${diag}</table>` : "");
}
