// The Send feedback modal. Markup lives in index.html (#feedback-modal);
// the server-side whitelist mirrors these values (server/feedbackValidate.js).

const CATEGORIES = [
  ["bug", "Bug"], ["idea", "Idea / feature request"], ["content", "Content error (something false)"],
  ["confusing", "Confusing / hard to use"], ["praise", "Praise"], ["other", "Other"],
];
const SECTIONS = [
  ["home", "Home"], ["physics", "Physics"], ["chemistry", "Chemistry"], ["astronomy", "Astronomy"], ["history", "History"],
  ["cybersecurity", "Cybersecurity"], ["particles", "Particle Physics"], ["mathematics", "Mathematics"], ["whiteboard", "Whiteboard"],
  ["economics", "Economics"], ["zoology", "Zoology"], ["sound", "Sound"], ["sustainability", "Sustainability"], ["war", "War"],
  ["classroom", "Classroom / Assignments"], ["account", "Account / Plans"], ["other", "Other"],
];
const SEVERITIES = [["minor", "Minor"], ["annoying", "Annoying"], ["blocking", "Blocks me"]];
const MIN_LEN = 10, THROTTLE_MS = 30000;
const PROMPTS = {
  bug: ["What happened?", "Tell us what went wrong."],
  idea: ["What's your idea?", "Describe the feature or change you'd like."],
  content: ["What's incorrect?", "Tell us what is false and, if you can, what the correct fact is."],
  confusing: ["What was confusing?", "Tell us what was hard to figure out."],
  praise: ["What did you like?", "Tell us what's working well."],
  other: ["What's on your mind?", "Anything you'd like to tell us."],
};

export function initFeedbackForm({ getSection, getUser, sendFeedback, getDeviceMode }) {
  const $ = (id) => document.getElementById(id);
  const modal = $("feedback-modal"), form = $("fb-form"), msg = $("fb-message");
  let category = "bug", rating = 0, severity = "", lastSent = 0, sending = false;
  try { lastSent = Number(sessionStorage.getItem("fbLastSent")) || 0; } catch { /* storage blocked */ }

  const chips = (host, list, name, onPick) => {
    host.innerHTML = list.map(([v, l]) => `<button type="button" class="fb-chip" role="radio" aria-checked="false" data-v="${v}">${l}</button>`).join("");
    host.addEventListener("click", (e) => {
      const b = e.target.closest(".fb-chip"); if (!b) return;
      onPick(name === "sev" && b.dataset.v === severity ? "" : b.dataset.v);
    });
  };
  const mark = (host, v) => host.querySelectorAll(".fb-chip").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === v)));

  chips($("fb-cats"), CATEGORIES, "cat", (v) => setCategory(v));
  chips($("fb-sev"), SEVERITIES, "sev", (v) => { severity = v; mark($("fb-sev"), v); });
  $("fb-section").innerHTML = SECTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("fb-stars").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="fb-star" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? "s" : ""}" data-n="${n}">&#9733;</button>`).join("");
  $("fb-stars").addEventListener("click", (e) => {
    const b = e.target.closest(".fb-star"); if (!b) return;
    const n = Number(b.dataset.n);
    setRating(n === rating ? 0 : n);
  });
  function setRating(n) {
    rating = n;
    $("fb-stars").querySelectorAll(".fb-star").forEach((b) => {
      const on = Number(b.dataset.n) <= n;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(Number(b.dataset.n) === n));
    });
  }
  function setCategory(v) {
    category = v; mark($("fb-cats"), v);
    const isBug = v === "bug";
    $("fb-severity-group").classList.toggle("hidden", !isBug);
    $("fb-bug-fields").classList.toggle("hidden", !isBug);
    $("fb-message-label").textContent = PROMPTS[v][0];
    msg.placeholder = PROMPTS[v][1];
  }

  function diagnostics() {
    const user = getUser();
    const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    return {
      page: location.pathname + location.hash.slice(0, 60),
      section: $("fb-section").value,
      appVersion: document.querySelector('meta[name="app-version"]')?.content || undefined,
      userAgent: navigator.userAgent,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      theme,
      deviceMode: getDeviceMode?.() || undefined,
      plan: user ? (user.entitlements?.plan || "free") : "signed out",
      timestamp: new Date().toISOString(),
    };
  }
  const renderDiag = () => {
    const d = diagnostics();
    $("fb-diag-preview").textContent = Object.entries(d).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join("\n");
  };
  const updateCount = () => { $("fb-count").textContent = `${msg.value.length} / 4000`; };
  const showError = (t) => { const e = $("fb-error"); e.textContent = t; e.classList.toggle("hidden", !t); };
  const close = () => modal.classList.add("hidden");

  function open() {
    form.reset();
    const u = getUser();
    $("fb-email").value = u?.email || "";
    $("fb-reply-ok").checked = false;
    $("fb-diag-on").checked = true;
    let s = getSection(); if (!SECTIONS.some(([v]) => v === s)) s = "other";
    $("fb-section").value = s;
    setCategory("bug"); severity = ""; mark($("fb-sev"), ""); setRating(0);
    showError(""); updateCount(); renderDiag();
    form.classList.remove("hidden"); $("fb-success").classList.add("hidden");
    $("feedback-submit").disabled = false; $("feedback-submit").textContent = "Send"; sending = false;
    modal.classList.remove("hidden"); msg.focus();
  }

  $("feedback-btn").addEventListener("click", open);
  $("feedback-cancel").addEventListener("click", close);
  $("fb-done").addEventListener("click", close);
  msg.addEventListener("input", updateCount);
  $("fb-section").addEventListener("change", renderDiag);
  $("fb-diag-on").addEventListener("change", () => { $("fb-diag-preview").parentElement.classList.toggle("fb-off", !$("fb-diag-on").checked); });
  $("fb-email").addEventListener("input", () => { if (!$("fb-email").value.trim()) $("fb-reply-ok").checked = false; });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    showError("");
    const message = msg.value.trim();
    if (message.length < MIN_LEN) { showError(`Please write at least ${MIN_LEN} characters (${message.length} so far).`); msg.focus(); return; }
    const email = $("fb-email").value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showError("That contact email doesn't look right."); $("fb-email").focus(); return; }
    if ($("fb-reply-ok").checked && !email) { showError("Add an email if you'd like a reply."); $("fb-email").focus(); return; }
    const wait = THROTTLE_MS - (Date.now() - lastSent);
    if (wait > 0) { showError(`Thanks! Please wait ${Math.ceil(wait / 1000)}s before sending another.`); return; }
    const btn = $("feedback-submit");
    sending = true; btn.disabled = true; btn.textContent = "Sending...";
    const isBug = category === "bug";
    const result = await sendFeedback({
      category, section: $("fb-section").value, message,
      rating: rating || undefined,
      severity: isBug ? severity || undefined : undefined,
      steps: isBug ? $("fb-steps").value.trim() : undefined,
      expected: isBug ? $("fb-expected").value.trim() : undefined,
      contactEmail: email || undefined, replyOk: !!email && $("fb-reply-ok").checked,
      diagnostics: $("fb-diag-on").checked ? diagnostics() : undefined,
      website: $("fb-website").value,
    });
    sending = false; btn.disabled = false; btn.textContent = "Send";
    if (result.error) { showError(result.error); return; }
    lastSent = Date.now();
    try { sessionStorage.setItem("fbLastSent", String(lastSent)); } catch { /* ignore */ }
    $("fb-ref-id").textContent = result.id || "n/a";
    form.classList.add("hidden"); $("fb-success").classList.remove("hidden");
  });
}
