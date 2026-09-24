// Kinetic AI Tutor — the chat UI shell only. NO real AI provider is
// connected anywhere in this codebase (see server/aiConfig.js and the
// server's /api/ai-chat route) — every message sent here gets back the
// same honest, static error, because that's the truth of what this
// feature can do today. This exists so the real chat mechanics (message
// history, sending, a disabled-while-waiting input) are already built and
// tested for whenever a real provider is wired in — swapping the server
// route's canned reply for a real call is the only change that day.
//
// A Plus feature (like Custom Items and Parameter Sweep), reachable from
// the global top bar rather than nested inside any one subject mode —
// "AI Tutor, aware of your current simulation" only makes sense as
// something available everywhere, not just from Physics.
import { getUser, openSavesPanel } from "./auth.js";

const FALLBACK_REPLY = "Sorry, I encountered a problem. Please try again later, or contact kinetic.sims@gmail.com";
let modal, box, messages = [];

export function initAITutorUI() {
  modal = document.getElementById("ai-tutor-modal");
  box = document.getElementById("ai-tutor-modal-box");
  document.getElementById("ai-tutor-btn").addEventListener("click", openAITutor);
}

export function openAITutor() {
  const user = getUser();
  if (!user) { document.getElementById("account-btn").click(); return; }
  if (!user.entitlements?.isPlus) {
    box.classList.add("ai-tutor-box-compact");
    box.innerHTML = `
      <div class="ai-tutor-mark">AI</div>
      <h2>Kinetic AI Tutor <span class="plus-badge">PLUS</span></h2>
      <p class="panel-empty">Hint → Bigger Hint → Explain It, aware of whatever you're building — a Kinetic Plus feature.</p>
      <button id="ait-see-plans" class="primary">See Plans</button>
      <button id="ait-close">Close</button>
    `;
    modal.classList.remove("hidden");
    box.querySelector("#ait-close").addEventListener("click", () => modal.classList.add("hidden"));
    box.querySelector("#ait-see-plans").addEventListener("click", () => { modal.classList.add("hidden"); document.getElementById("plans-btn").click(); });
    return;
  }
  modal.classList.remove("hidden");
  render();
}

function render() {
  box.classList.remove("ai-tutor-box-compact");
  box.innerHTML = `
    <div class="ai-tutor-header">
      <div class="ai-tutor-header-title">
        <div class="ai-tutor-mark">AI</div>
        <div>
          <h2>Kinetic AI Tutor</h2>
          <p class="ai-tutor-subtitle">Hint → Bigger Hint → Explain It — aware of your current simulation and challenge, once it's live.</p>
        </div>
      </div>
      <button id="ait-close-x" class="ai-tutor-close-x" title="Close" aria-label="Close">×</button>
    </div>
    <p class="ai-tutor-disclaimer"><strong>Not connected yet</strong> — every message below gets a real, honest error, not a fabricated answer.</p>
    <div id="ait-history" class="ai-tutor-history"></div>
    <div class="ai-tutor-composer">
      <textarea id="ait-input" class="ai-tutor-input" rows="1" placeholder="Ask the AI Tutor something…"></textarea>
      <button id="ait-saved" title="My Saved Chats">My Saved Chats</button>
      <button id="ait-send" class="primary">Send</button>
    </div>
  `;
  box.querySelector("#ait-close-x").addEventListener("click", () => modal.classList.add("hidden"));
  box.querySelector("#ait-saved").addEventListener("click", () => openSavedChats());
  const input = box.querySelector("#ait-input");
  const sendBtn = box.querySelector("#ait-send");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input, sendBtn); }
  });
  sendBtn.addEventListener("click", () => send(input, sendBtn));
  renderHistory();
}

// Saving a chat is what lets it be shared with a teacher/classmate (see
// the Dashboard) — same generic "Save current" + list panel every other
// mode's My Saved ___ uses, just with the current messages array as data.
//
// Hides the AI Tutor modal first: both it and #saves-modal are plain
// `.modal`s at the same z-index, and #ai-tutor-modal sits later in
// index.html, so opening Saves on top of a still-visible AI Tutor modal
// rendered the Saves panel BEHIND it — visible only after closing AI
// Tutor first. Matches the "See Plans" button just above, which hides
// this modal before opening Plans for the same reason.
function openSavedChats() {
  modal.classList.add("hidden");
  openSavesPanel({
    kind: "ai-chats",
    title: "My Saved Chats",
    itemNoun: "chat",
    serialize: () => messages,
    apply: (data) => applySharedAiChat(data),
  });
}

// Loading a chat a teacher/student shared, or one of your own saved ones —
// replaces the current conversation with the shared/saved one.
export function applySharedAiChat(data) {
  messages = Array.isArray(data) ? data : [];
  renderHistory();
}

function renderHistory() {
  const historyEl = box.querySelector("#ait-history");
  if (!historyEl) return;
  historyEl.innerHTML = messages.length
    ? messages.map((m) => `
        <div class="ai-tutor-msg-row ai-tutor-msg-row-${m.role}">
          <div class="ai-tutor-msg ai-tutor-msg-${m.role}">${escapeHtml(m.text)}</div>
        </div>
      `).join("")
    : `<div class="ai-tutor-empty"><div class="ai-tutor-empty-mark">AI</div><p>No messages yet — ask anything about what you're building.</p></div>`;
  historyEl.scrollTop = historyEl.scrollHeight;
}

async function send(input, sendBtn) {
  const text = input.value.trim();
  if (!text) return;
  messages.push({ role: "user", text });
  input.value = "";
  input.disabled = true;
  sendBtn.disabled = true;
  renderHistory();

  let reply = FALLBACK_REPLY;
  try {
    const res = await fetch("/api/ai-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.reply) reply = data.reply;
  } catch {
    // Network failure: still show the same honest reply, never a
    // fabricated success.
  }
  messages.push({ role: "assistant", text: reply });
  input.disabled = false;
  sendBtn.disabled = false;
  renderHistory();
  input.focus();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
