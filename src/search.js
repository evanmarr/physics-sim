// Global search across every sandbox — a thin, generic modal UI. The
// actual index (what's searchable: all 12 sandboxes plus every challenge
// each one defines) lives in main.js, right next to the data it's built
// from, and is handed in as a callback so this module stays free of any
// per-sandbox knowledge — it just filters and renders whatever list it's
// given, then calls that item's own `go()`.
let modal, box, getItems;
let activeIndex = 0;

export function initSearchUI(itemsProvider) {
  getItems = itemsProvider;
  modal = document.getElementById("search-modal");
  box = document.getElementById("search-modal-box");
  const btn = document.getElementById("search-btn");

  btn.addEventListener("click", open);

  // A light global shortcut (Cmd/Ctrl+K) — guarded the same way Physics's
  // own Space/F shortcuts are, so it never fires while a modal, the action
  // menu, or a text field already owns the keyboard.
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      open();
    }
  });
}

function open() {
  modal.classList.remove("hidden");
  render("");
  const input = box.querySelector(".search-input");
  input?.focus();
}

function close() {
  modal.classList.add("hidden");
}

function render(query) {
  activeIndex = 0;
  const q = query.trim().toLowerCase();
  const all = getItems();
  const results = q ? all.filter((item) => matches(item, q)).slice(0, 30) : all.slice(0, 12);

  box.innerHTML = `
    <h2>Search Kinetic</h2>
    <input type="text" class="search-input" placeholder="Search sandboxes and challenges…" value="${escapeAttr(query)}" />
    <div class="search-results">
      ${results.length ? results.map((r, i) => rowHtml(r, i === activeIndex)).join("") : `<p class="panel-empty">No matches${q ? ` for "${escapeAttr(query)}"` : ""}.</p>`}
    </div>
  `;

  const input = box.querySelector(".search-input");
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveActive(1, results); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveActive(-1, results); return; }
    if (e.key === "Enter") { e.preventDefault(); const item = results[activeIndex]; if (item) select(item); }
  });
  // Re-focus + put the caret at the end after every re-render (innerHTML
  // rebuild would otherwise reset focus and cursor position each keystroke).
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  box.querySelectorAll(".search-row").forEach((rowEl, i) => {
    rowEl.addEventListener("click", () => select(results[i]));
  });
}

function moveActive(delta, results) {
  if (!results.length) return;
  activeIndex = (activeIndex + delta + results.length) % results.length;
  box.querySelectorAll(".search-row").forEach((el, i) => el.classList.toggle("search-row-active", i === activeIndex));
}

function select(item) {
  close();
  item.go();
}

function matches(item, q) {
  return item.title.toLowerCase().includes(q) || (item.subtitle || "").toLowerCase().includes(q);
}

function rowHtml(item, active) {
  return `
    <button class="search-row${active ? " search-row-active" : ""}">
      <div class="search-row-title">${escapeAttr(item.title)}</div>
      ${item.subtitle ? `<div class="search-row-sub">${escapeAttr(item.subtitle)}</div>` : ""}
    </button>
  `;
}

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
