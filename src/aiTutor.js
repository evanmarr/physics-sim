// Kinetic AI Tutor — the chat UI shell only. NO real AI provider is
// connected anywhere in this codebase (see server/aiConfig.js and the
// server's /api/ai-chat route) — every message sent here gets back the
// same honest, static error, because that's the truth of what this
// feature can do today. This exists so the real chat mechanics (message
// history, sending, a disabled-while-waiting input) are already built and
// tested for whenever a real provider is wired in — swapping the server
// route's canned reply for a real call is the only change that day.
import { getUser } from "./auth.js";

const FALLBACK_REPLY = "Sorry, I encountered a problem. Please try again later, or contact kinetic.sims@gmail.com";

function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

export class AITutorMode {
  constructor(root) {
    this.root = root;
    this.messages = []; // { role: "user" | "assistant", text }
    this._built = false;
  }

  mount() {
    if (!this._built) this._build();
  }

  unmount() {}

  _build() {
    this._built = true;
    this.root.className = "ai-tutor-wrap";
    this.root.innerHTML = "";

    const header = div("ai-tutor-header");
    header.innerHTML = `
      <h2>Kinetic AI Tutor</h2>
      <p class="saves-hint">Hint → Bigger Hint → Explain It — aware of your current simulation and challenge, once it's live. <strong>Not connected yet</strong>: every message below gets a real, honest error, not a fabricated answer.</p>
    `;
    this.root.appendChild(header);

    this.historyEl = div("ai-tutor-history");
    this.root.appendChild(this.historyEl);

    const composer = div("ai-tutor-composer");
    this.input = document.createElement("textarea");
    this.input.className = "ai-tutor-input";
    this.input.rows = 2;
    this.input.placeholder = "Ask the AI Tutor something…";
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this._send(); }
    });
    this.sendBtn = document.createElement("button");
    this.sendBtn.className = "primary";
    this.sendBtn.textContent = "Send";
    this.sendBtn.addEventListener("click", () => this._send());
    composer.appendChild(this.input);
    composer.appendChild(this.sendBtn);
    this.root.appendChild(composer);

    this._renderHistory();
  }

  _renderHistory() {
    this.historyEl.innerHTML = this.messages.length
      ? this.messages.map((m) => `<div class="ai-tutor-msg ai-tutor-msg-${m.role}">${escapeHtml(m.text)}</div>`).join("")
      : `<p class="panel-empty">No messages yet — ask anything about what you're building.</p>`;
    this.historyEl.scrollTop = this.historyEl.scrollHeight;
  }

  async _send() {
    const text = this.input.value.trim();
    if (!text) return;
    if (!getUser()) { document.getElementById("account-btn")?.click(); return; }
    this.messages.push({ role: "user", text });
    this.input.value = "";
    this.input.disabled = true;
    this.sendBtn.disabled = true;
    this._renderHistory();

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
    this.messages.push({ role: "assistant", text: reply });
    this.input.disabled = false;
    this.sendBtn.disabled = false;
    this._renderHistory();
    this.input.focus();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
