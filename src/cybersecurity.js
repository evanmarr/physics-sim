import { CYBER_CATEGORIES, CYBER_ENTRIES } from "./cybersecurityData.js";
import { CYBER_CHALLENGES } from "./cyberChallenges.js";

// A search-and-filter reference, not a timeline like History mode — for
// "find the one called X" or "show me only malware," free-text search plus
// category toggles is a better fit than browsing chronologically.
export class CybersecurityMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx || {}; // { state, showToast } — state.completedChallenges is shared with every other mode's challenges
    this.query = "";
    this.activeFilters = new Set(CYBER_CATEGORIES.map((c) => c.key));
    this.selectedId = null;
    this.activeChallengeId = null;
    this._build();
  }

  mount() { this._renderView(); }
  unmount() {}

  _build() {
    this.root.innerHTML = "";
    this.root.className = "cyber-root";
    this.challengeModal = buildChallengeModal(this.ctx, (challenge) => {
      this.query = "";
      this.activeFilters = new Set(CYBER_CATEGORIES.map((c) => c.key));
      this.selectedId = null;
      this.activeChallengeId = challenge.id;
      this._renderView();
    });
    this.root.appendChild(this.challengeModal.el);
    this._renderView();
  }

  _renderView() {
    this.root.innerHTML = "";
    this.root.appendChild(this.challengeModal.el);

    const header = div("cyber-header");
    const title = document.createElement("h1");
    title.className = "cyber-title";
    title.textContent = "Cybersecurity";
    header.appendChild(title);
    const challengesBtn = document.createElement("button");
    challengesBtn.className = "primary";
    challengesBtn.textContent = "Cybersecurity Challenges";
    challengesBtn.addEventListener("click", () => this.challengeModal.open());
    header.appendChild(challengesBtn);
    this.root.appendChild(header);

    const sub = document.createElement("p");
    sub.className = "cyber-sub";
    sub.textContent = "Search or filter well-documented malware, hackers, hacker groups, and breaches.";
    this.root.appendChild(sub);

    const activeChallenge = this.activeChallengeId ? CYBER_CHALLENGES.find((c) => c.id === this.activeChallengeId) : null;
    if (activeChallenge) {
      const banner = div("cyber-challenge-banner");
      banner.textContent = `🎯 ${activeChallenge.hint}`;
      this.root.appendChild(banner);
    }

    const controls = div("cyber-controls");
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Search by name or keyword…";
    searchInput.className = "cyber-search";
    searchInput.value = this.query;
    searchInput.addEventListener("input", () => {
      this.query = searchInput.value;
      this._renderResults(resultsEl);
    });
    controls.appendChild(searchInput);

    const filterRow = div("cyber-filter-row");
    for (const cat of CYBER_CATEGORIES) {
      const btn = document.createElement("button");
      btn.className = "cyber-filter" + (this.activeFilters.has(cat.key) ? " active" : "");
      btn.textContent = cat.label;
      btn.addEventListener("click", () => {
        if (this.activeFilters.has(cat.key)) this.activeFilters.delete(cat.key);
        else this.activeFilters.add(cat.key);
        btn.classList.toggle("active");
        this._renderResults(resultsEl);
      });
      filterRow.appendChild(btn);
    }
    controls.appendChild(filterRow);
    this.root.appendChild(controls);

    const body = div("cyber-body");
    const resultsEl = div("cyber-results");
    const infoEl = div("chem-panel cyber-info");
    body.appendChild(resultsEl);
    body.appendChild(infoEl);
    this.root.appendChild(body);

    this.infoEl = infoEl;
    this._renderResults(resultsEl);
    this._renderInfo(infoEl);
    searchInput.focus();
  }

  _matches(entry) {
    if (!this.activeFilters.has(entry.category)) return false;
    const q = this.query.trim().toLowerCase();
    if (!q) return true;
    return entry.name.toLowerCase().includes(q)
      || entry.summary.toLowerCase().includes(q)
      || entry.detail.toLowerCase().includes(q)
      || (entry.tags || []).some((t) => t.toLowerCase().includes(q));
  }

  _renderResults(resultsEl) {
    resultsEl.innerHTML = "";
    const matches = CYBER_ENTRIES.filter((e) => this._matches(e));
    if (!matches.length) {
      const empty = div("cyber-empty");
      empty.textContent = "No matches — try a different search, or turn on more filters above.";
      resultsEl.appendChild(empty);
      return;
    }
    for (const entry of matches) {
      const cat = CYBER_CATEGORIES.find((c) => c.key === entry.category);
      const card = document.createElement("button");
      card.className = "cyber-card" + (entry.id === this.selectedId ? " active" : "");
      card.innerHTML = `
        <div class="cyber-card-body">
          <div class="cyber-card-name">${entry.name}</div>
          <div class="cyber-card-year">${entry.year}</div>
          <div class="cyber-card-summary">${entry.summary}</div>
        </div>
      `;
      card.addEventListener("click", () => {
        this.selectedId = entry.id;
        const hadChallenge = this.activeChallengeId;
        this._checkChallenge(entry);
        // Clicking a card should only update the results list and the info
        // panel next to it — a full _renderView() rebuild recreates the
        // search input, which steals focus and scrolls the page back up to
        // it. Only rebuild everything when the challenge banner needs to
        // disappear (challenge just completed).
        if (hadChallenge && !this.activeChallengeId) {
          this._renderView();
        } else {
          this._renderResults(resultsEl);
          this._renderInfo(this.infoEl);
        }
      });
      resultsEl.appendChild(card);
    }
  }

  _renderInfo(infoEl) {
    const entry = CYBER_ENTRIES.find((e) => e.id === this.selectedId);
    if (!entry) {
      infoEl.innerHTML = `<div class="cyber-info-empty">Select an entry on the left to read more about it.</div>`;
      return;
    }
    const cat = CYBER_CATEGORIES.find((c) => c.key === entry.category);
    infoEl.innerHTML = `
      <div class="history-info-year">${cat.label} · ${entry.year}</div>
      <div class="chem-panel-title history-info-title">${entry.name}</div>
      <div class="history-info-summary">${entry.summary}</div>
      <div class="history-info-detail">${entry.detail}</div>
    `;
  }

  _checkChallenge(entry) {
    if (!this.activeChallengeId) return;
    const challenge = CYBER_CHALLENGES.find((c) => c.id === this.activeChallengeId);
    if (!challenge || challenge.entryId !== entry.id) return;
    this.activeChallengeId = null;
    if (this.ctx.state) this.ctx.state.completedChallenges.add(challenge.id);
    this.ctx.showToast?.(`Challenge complete: found "${entry.name}"!`);
  }
}

function div(className) {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

function buildChallengeModal(ctx, onGo) {
  const el = div("modal hidden");
  const box = div("modal-box");
  box.innerHTML = `<h2>Cybersecurity Challenges</h2><div class="cyber-challenge-list"></div>`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => el.classList.add("hidden"));
  box.appendChild(closeBtn);
  el.appendChild(box);
  const list = box.querySelector(".cyber-challenge-list");

  function render() {
    list.innerHTML = "";
    const completed = ctx.state?.completedChallenges;
    for (const challenge of CYBER_CHALLENGES) {
      const done = completed?.has(challenge.id);
      const row = div("shop-item");
      row.innerHTML = `
        <div class="info">
          <div class="name">${done ? "✓ Solved" : "Unsolved"}</div>
          <div class="desc">${challenge.hint}</div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.className = "primary";
      btn.textContent = done ? "Try again" : "Start";
      btn.addEventListener("click", () => {
        onGo(challenge);
        el.classList.add("hidden");
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  return {
    el,
    open() { render(); el.classList.remove("hidden"); },
  };
}
