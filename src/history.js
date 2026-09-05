import { HISTORY_CATEGORIES } from "./historyData.js";
import { HISTORY_CHALLENGES } from "./historyChallenges.js";

// Two views: a category picker (reusing the existing unused .home-card grid
// style) and a per-category timeline (list + detail panel, matching the
// list/info layout already used by astronomy's anatomy-style panels).
export class HistoryMode {
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx || {}; // { state, showToast } — state.completedChallenges is shared with every other mode's challenges
    this.categoryKey = null;
    this.selectedIndex = null;
    this.activeChallengeId = null; // set while a "find this event" challenge is in progress
    this._build();
  }

  mount() { this._renderView(); }
  unmount() {}

  _build() {
    this.root.innerHTML = "";
    this.root.className = "history-root";
    this.challengeModal = buildChallengeModal(this.ctx, (challenge) => {
      this.categoryKey = challenge.categoryKey;
      this.selectedIndex = null;
      this.activeChallengeId = challenge.id;
      this._renderView();
    });
    this.root.appendChild(this.challengeModal.el);
    this._renderView();
  }

  _renderView() {
    // The challenge modal is a persistent sibling, not part of the
    // picker/timeline swap below — re-appended each render since
    // innerHTML="" below would otherwise silently detach it.
    this.root.innerHTML = "";
    this.root.appendChild(this.challengeModal.el);
    if (!this.categoryKey) this._renderCategoryPicker();
    else this._renderTimeline();
  }

  _renderCategoryPicker() {
    const wrap = div("history-picker");

    const titleRow = div("history-picker-title-row");
    const title = document.createElement("h1");
    title.className = "history-picker-title";
    title.textContent = "History";
    titleRow.appendChild(title);
    const challengesBtn = document.createElement("button");
    challengesBtn.className = "primary";
    challengesBtn.textContent = "History Challenges";
    challengesBtn.addEventListener("click", () => this.challengeModal.open());
    titleRow.appendChild(challengesBtn);
    wrap.appendChild(titleRow);

    const sub = document.createElement("p");
    sub.className = "history-picker-sub";
    sub.textContent = "Pick a subject to browse its timeline of key moments.";
    wrap.appendChild(sub);

    const grid = div("home-cards history-cards");
    for (const cat of HISTORY_CATEGORIES) {
      const card = document.createElement("button");
      card.className = "home-card";
      card.innerHTML = `
        <div class="home-card-title">${cat.label}</div>
        <div class="home-card-blurb">${cat.blurb}</div>
      `;
      card.addEventListener("click", () => {
        this.categoryKey = cat.key;
        this.selectedIndex = 0;
        this._renderView();
      });
      grid.appendChild(card);
    }
    wrap.appendChild(grid);

    this.root.appendChild(wrap);
  }

  _renderTimeline() {
    const cat = HISTORY_CATEGORIES.find((c) => c.key === this.categoryKey);

    const header = div("history-timeline-header");
    const back = document.createElement("button");
    back.textContent = "← All subjects";
    back.addEventListener("click", () => {
      this.categoryKey = null;
      this.selectedIndex = null;
      this._renderView();
    });
    header.appendChild(back);
    const heading = document.createElement("div");
    heading.className = "chem-panel-title";
    heading.textContent = cat.label;
    header.appendChild(heading);

    const activeChallenge = this.activeChallengeId ? HISTORY_CHALLENGES.find((c) => c.id === this.activeChallengeId) : null;
    if (activeChallenge && activeChallenge.categoryKey === this.categoryKey) {
      const banner = div("history-challenge-banner");
      banner.textContent = `🎯 ${activeChallenge.hint}`;
      header.appendChild(banner);
    }

    // Ticks are spaced evenly in chronological order rather than scaled
    // exactly to each entry's year — the entries span everything from
    // "c. 1450 BCE" to "2020", and true proportional scaling would crush
    // the modern end into a sliver. Even spacing keeps every tick equally
    // legible while the data itself (already authored chronologically)
    // still reads left-to-right as a real timeline.
    const timelineRow = div("history-timeline-row");
    const scroll = div("history-timeline-scroll");
    const track = div("history-timeline-track");
    const tickSpacing = 130;
    // A tick is 116px wide and centered on its `left` (translateX(-50%)),
    // so it needs at least half that — 58px — of clearance on either side
    // or its own box (and with it, part of the mark/year/title) gets
    // clipped by the scroll container's edge. The old 30px margin was
    // narrower than that half-width, cutting off the first and last ticks.
    const edgeMargin = 65;
    const trackWidth = Math.max(700, (cat.entries.length - 1) * tickSpacing + edgeMargin * 2);
    track.style.width = `${trackWidth}px`;
    track.appendChild(div("history-timeline-axis"));

    // Wheel-scroll and click-drag both work on the strip (wired below), but
    // neither depends on gesture support the way a plain click doesn't — an
    // explicit, always-reliable way to move through a long timeline that
    // needs no mouse wheel, trackpad gesture, or drag at all.
    const prevBtn = document.createElement("button");
    prevBtn.className = "history-timeline-nav";
    prevBtn.textContent = "◀";
    prevBtn.setAttribute("aria-label", "Scroll earlier");
    // Instant, not smooth — smooth-scroll rides the browser's own rAF loop,
    // which (like any rAF-driven animation) can stall for a while if the
    // tab isn't in the foreground; an instant jump has no such dependency.
    prevBtn.addEventListener("click", () => { scroll.scrollBy({ left: -tickSpacing * 3 }); });
    const nextBtn = document.createElement("button");
    nextBtn.className = "history-timeline-nav";
    nextBtn.textContent = "▶";
    nextBtn.setAttribute("aria-label", "Scroll later");
    nextBtn.addEventListener("click", () => { scroll.scrollBy({ left: tickSpacing * 3 }); });

    cat.entries.forEach((entry, i) => {
      const tick = document.createElement("button");
      tick.className = "history-tick" + (i === this.selectedIndex ? " active" : "");
      tick.style.left = `${edgeMargin + i * tickSpacing}px`;
      tick.innerHTML = `
        <span class="history-tick-mark"></span>
        <span class="history-tick-year">${entry.year}</span>
        <span class="history-tick-title">${entry.title}</span>
      `;
      tick.addEventListener("click", () => {
        this.selectedIndex = i;
        this._checkChallenge(entry);
        this._renderView();
      });
      track.appendChild(tick);
    });
    scroll.appendChild(track);
    wireHorizontalScroll(scroll);
    timelineRow.appendChild(prevBtn);
    timelineRow.appendChild(scroll);
    timelineRow.appendChild(nextBtn);

    const infoPanel = div("chem-panel history-info-panel");
    const entry = cat.entries[this.selectedIndex] ?? cat.entries[0];
    if (entry) {
      infoPanel.innerHTML = `
        <div class="history-info-year">${entry.year}</div>
        <div class="chem-panel-title history-info-title">${entry.title}</div>
        <div class="history-info-people">${entry.people}</div>
        <div class="history-info-summary">${entry.summary}</div>
        <div class="history-info-detail">${entry.detail}</div>
      `;
    }

    this.root.appendChild(header);
    this.root.appendChild(timelineRow);
    this.root.appendChild(infoPanel);

    // Bring the selected tick into view if it's actually off-screen (e.g.
    // opening a fresh category) — "nearest", not "center": re-centering on
    // every single click, even one on an already-visible tick, was forcing
    // a jarring scroll after every click, throwing off exactly where the
    // next tick the reader wanted to click ended up.
    const activeTick = track.querySelector(".history-tick.active");
    activeTick?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }

  _checkChallenge(entry) {
    if (!this.activeChallengeId) return;
    const challenge = HISTORY_CHALLENGES.find((c) => c.id === this.activeChallengeId);
    if (!challenge || challenge.categoryKey !== this.categoryKey || challenge.title !== entry.title) return;
    this.activeChallengeId = null;
    if (this.ctx.state) this.ctx.state.completedChallenges.add(challenge.id);
    this.ctx.showToast?.(`Challenge complete: found "${entry.title}"!`);
  }
}

function div(className) {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

// `onGo(challenge)` jumps the caller to that challenge's category with no
// entry preselected — finding the actual tick is the challenge itself.
function buildChallengeModal(ctx, onGo) {
  const el = div("modal hidden");
  const box = div("modal-box");
  box.innerHTML = `<h2>History Challenges</h2><div class="history-challenge-list"></div>`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => el.classList.add("hidden"));
  box.appendChild(closeBtn);
  el.appendChild(box);
  const list = box.querySelector(".history-challenge-list");

  function render() {
    list.innerHTML = "";
    const completed = ctx.state?.completedChallenges;
    for (const challenge of HISTORY_CHALLENGES) {
      const done = completed?.has(challenge.id);
      const cat = HISTORY_CATEGORIES.find((c) => c.key === challenge.categoryKey);
      const row = div("shop-item");
      row.innerHTML = `
        <div class="info">
          <div class="name">${cat?.label ?? challenge.categoryKey}${done ? " ✓" : ""}</div>
          <div class="desc">${challenge.hint}</div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.className = "primary";
      btn.textContent = done ? "Find again" : "Take me there";
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

// A plain `overflow-x: auto` strip only scrolls from a horizontal gesture
// (shift+wheel, a trackpad's sideways swipe, or dragging the scrollbar
// itself) — an ordinary vertical mouse-wheel scroll does nothing on it,
// which reads as "this doesn't work" for most mice. This adds the two
// gestures people actually reach for on a horizontal strip: plain wheel
// scrolling, and click-and-drag panning.
function wireHorizontalScroll(el) {
  el.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already a horizontal gesture — let it through natively
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  let dragging = false, startX = 0, startScroll = 0, moved = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".history-tick")) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 3) moved = true;
    el.scrollLeft = startScroll - dx;
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    // Swallow the click that follows a real drag so it doesn't also select
    // whatever tick the pointer happened to land on.
    if (moved) {
      const swallow = (ev) => { ev.stopPropagation(); el.removeEventListener("click", swallow, true); };
      el.addEventListener("click", swallow, true);
    }
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  el.style.cursor = "grab";
  el.addEventListener("pointerdown", () => { el.style.cursor = "grabbing"; });
  el.addEventListener("pointerup", () => { el.style.cursor = "grab"; });
}
