// A guided, click-through tour of the app — a spotlight box-shadow trick
// highlights the real button/element for each step (no cloned UI, so it
// never drifts out of sync with the actual app), and most steps wait for
// you to actually perform the action rather than just clicking "Next".

const STEPS = [
  {
    text: "Welcome to Continuum! Let's take a real, hands-on tour of everything each section can do — this takes a few minutes but covers the whole app. Click Physics to start.",
    target: "#mode-physics-btn",
    advance: { type: "click", selector: "#mode-physics-btn" },
  },
  {
    text: "Drag a Ball from the palette onto the grid. Every square is 1 meter — position, size, and weight are all in real units, shown in the badge in the corner.",
    target: '.palette-item[data-type="ball"]',
    advance: { type: "count", selector: ".world-object" },
  },
  {
    text: "Click the ball you just placed to open its property panel on the right.",
    target: ".world-object",
    advance: { type: "click", selector: ".world-object" },
  },
  {
    text: "Position, material, and Weight are all editable here — dragging Weight overrides the material's natural density, so you can make a \"ball\" as light as foam or as heavy as lead without changing its size.",
    target: "#prop-panel",
    advance: { type: "next" },
  },
  {
    text: "Press Play to run the simulation with real gravity, friction, and collisions.",
    target: "#play-btn",
    advance: { type: "click", selector: "#play-btn" },
  },
  {
    text: "Click the ball while it's moving — every object shows a live speed readout while Play is running. Double-click the units to change them.",
    target: "#canvas-wrap",
    advance: { type: "next" },
  },
  {
    text: "Press Stop, then click an object to see the real formulas driving it in the Physics panel — density, friction, restitution, and more, all editable there too.",
    target: "#play-btn",
    advance: { type: "click", selector: "#play-btn" },
  },
  {
    text: 'Drag a Magnet and something metal near each other, then click "Show Field" — the lines show the real (roughly inverse-4th-power) pull a magnet has on ferrous metal, strong up close and falling off fast with distance.',
    target: "#field-mode-btn",
    advance: { type: "click", selector: "#field-mode-btn" },
  },
  {
    text: '"Light Mode" does the same for a Lens, Mirror, and Light Source — real ray tracing, with reflection and refraction, not a canned animation.',
    target: "#light-mode-btn",
    advance: { type: "next" },
  },
  {
    text: "Every mode has its own Challenges — click here to see Physics' list, each one tagged with the concept it teaches.",
    target: "#challenges-btn",
    advance: { type: "click", selector: "#challenges-btn" },
  },
  {
    text: "That's Physics! Let's check out Chemistry — click the tab.",
    target: "#mode-chemistry-btn",
    advance: { type: "click", selector: "#mode-chemistry-btn" },
  },
  {
    text: "Click any element in the periodic table to inspect its real atomic structure.",
    target: ".chem-tile",
    advance: { type: "click", selector: ".chem-tile" },
  },
  {
    text: 'Now click "Add to mixing bench" to place it in a reaction slot — combine the right elements in the right ratio (or drop a metal into water) and press React to watch real, curated stoichiometry play out.',
    target: ".chem-add-btn",
    advance: { type: "click", selector: ".chem-add-btn" },
  },
  {
    text: "On to Astronomy — click the tab.",
    target: "#mode-astronomy-btn",
    advance: { type: "click", selector: "#mode-astronomy-btn" },
  },
  {
    text: "Try a speed button to fast-forward time and watch the planets move along their real Keplerian orbits, computed live from actual orbital elements for whatever date is set — including a \"find the next eclipse\" challenge.",
    target: ".astro-speed-btn",
    advance: { type: "next" },
  },
  {
    text: "History — click any tick on the timeline to read about it. History Challenges send you hunting for a specific one from just a hint.",
    target: "#mode-history-btn",
    advance: { type: "click", selector: "#mode-history-btn" },
  },
  {
    text: "Cybersecurity works the same way, but as a searchable/filterable reference instead of a timeline — try searching for a name here.",
    target: "#mode-cybersecurity-btn",
    advance: { type: "click", selector: "#mode-cybersecurity-btn" },
  },
  {
    text: "Particle Physics is a gallery of real D3 force simulations — drag anything you see, and switch demos from the sub-nav.",
    target: "#mode-particles-btn",
    advance: { type: "click", selector: "#mode-particles-btn" },
  },
  {
    text: "Mathematics — type an equation like x^2 into the y = box to graph it live, or switch to Bar Chart, Pie Chart, or Venn Diagram above.",
    target: "#mode-mathematics-btn",
    advance: { type: "click", selector: "#mode-mathematics-btn" },
  },
  {
    text: "Whiteboard is a free draw/write surface for your own sketches and notes — Undo/Redo work here too (Ctrl/Cmd+Z).",
    target: "#mode-whiteboard-btn",
    advance: { type: "click", selector: "#mode-whiteboard-btn" },
  },
  {
    text: "Economics has a real supply-and-demand market (try adding a tax or a price control) and a repeated Prisoner's Dilemma game-theory sandbox with an editable payoff matrix.",
    target: "#mode-economics-btn",
    advance: { type: "click", selector: "#mode-economics-btn" },
  },
  {
    text: "Quiz tests you on whatever mode you're currently in — look for it in the top bar.",
    target: "#quiz-btn",
    advance: { type: "next" },
  },
  {
    text: "Sign in to save up to 6 Physics worlds and 6 Mathematics items to your account, from any device.",
    target: "#account-btn",
    advance: { type: "next" },
  },
  {
    text: "This icon switches between mobile and computer layouts any time — bigger touch targets and touch-friendly gestures on mobile, without changing how anything actually works.",
    target: "#device-mode-btn",
    advance: { type: "next" },
  },
  {
    text: "That's the tour! Come back to this Tutorial button any time to replay it, and look for Quiz/Challenges in each mode to test what you've learned.",
    target: "#tutorial-btn",
    advance: { type: "next" },
  },
];

let overlayEl = null, spotEl = null, tooltipEl = null;
let stepIndex = 0;
let running = false;
let cleanupFns = [];

export function initTutorial() {
  document.getElementById("tutorial-btn")?.addEventListener("click", startTutorial);
}

function startTutorial() {
  if (running) return;
  running = true;
  buildOverlay();
  showStep(0);
}

function buildOverlay() {
  overlayEl = document.createElement("div");
  overlayEl.className = "tutorial-overlay";
  spotEl = document.createElement("div");
  spotEl.className = "tutorial-spot";
  tooltipEl = document.createElement("div");
  tooltipEl.className = "tutorial-tooltip";
  overlayEl.appendChild(spotEl);
  overlayEl.appendChild(tooltipEl);
  document.body.appendChild(overlayEl);
  window.addEventListener("resize", reposition);
}

function endTutorial() {
  running = false;
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
  window.removeEventListener("resize", reposition);
  overlayEl?.remove();
  overlayEl = null;
}

function reposition() {
  if (running) showStep(stepIndex, true);
}

function positionSpotlight(step) {
  const target = step.target ? document.querySelector(step.target) : null;
  if (target) {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    const rect = target.getBoundingClientRect();
    spotEl.style.display = "block";
    spotEl.style.left = `${rect.left - 6}px`;
    spotEl.style.top = `${rect.top - 6}px`;
    spotEl.style.width = `${rect.width + 12}px`;
    spotEl.style.height = `${rect.height + 12}px`;
    positionTooltip(rect);
  } else {
    spotEl.style.display = "none";
    positionTooltipCenter();
  }
}

function showStep(i, isReposition = false) {
  if (!isReposition) {
    for (const fn of cleanupFns) fn();
    cleanupFns = [];
  }
  stepIndex = i;
  const step = STEPS[i];
  positionSpotlight(step);
  // A step right after a mode switch (or any other DOM rebuild) can measure
  // its target mid-layout — the container exists but hasn't settled to its
  // real size/position yet, so the spotlight lands on the wrong spot or a
  // sliver of the right one. Re-measuring a couple of frames later corrects
  // that without needing to guess how long any given rebuild takes.
  requestAnimationFrame(() => requestAnimationFrame(() => { if (running && stepIndex === i) positionSpotlight(step); }));

  tooltipEl.innerHTML = "";
  const progress = document.createElement("div");
  progress.className = "tutorial-progress";
  progress.textContent = `Step ${i + 1} of ${STEPS.length}`;
  tooltipEl.appendChild(progress);
  const text = document.createElement("div");
  text.className = "tutorial-text";
  text.textContent = step.text;
  tooltipEl.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "tutorial-actions";
  const skipBtn = document.createElement("button");
  skipBtn.textContent = i === STEPS.length - 1 ? "Close" : "Skip tour";
  skipBtn.addEventListener("click", endTutorial);
  actions.appendChild(skipBtn);
  if (step.advance.type === "next") {
    const nextBtn = document.createElement("button");
    nextBtn.className = "primary";
    nextBtn.textContent = i === STEPS.length - 1 ? "Done" : "Next";
    nextBtn.addEventListener("click", () => (i === STEPS.length - 1 ? endTutorial() : showStep(i + 1)));
    actions.appendChild(nextBtn);
  } else {
    const waiting = document.createElement("div");
    waiting.className = "tutorial-waiting";
    waiting.textContent = "Waiting for you to try that…";
    actions.appendChild(waiting);
  }
  tooltipEl.appendChild(actions);

  if (!isReposition && step.advance.type !== "next") wireAdvance(step, i);
}

function positionTooltip(rect) {
  const margin = 14;
  const boxHeight = 170, boxWidth = 320;
  let top = rect.bottom + margin;
  if (top + boxHeight > window.innerHeight) top = Math.max(margin, rect.top - boxHeight - margin);
  const left = Math.min(Math.max(margin, rect.left), window.innerWidth - boxWidth - margin);
  tooltipEl.style.transform = "none";
  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
}

function positionTooltipCenter() {
  tooltipEl.style.top = "40%";
  tooltipEl.style.left = "50%";
  tooltipEl.style.transform = "translate(-50%, -50%)";
}

// Click steps use a capture-phase document listener (so it fires no matter
// which element inside the target actually handled the click) plus a short
// delay before advancing — the app's own click handler (switching modes,
// rebuilding a panel...) runs in the bubble phase right after, so the delay
// lets that settle before the next step measures its target's position.
function wireAdvance(step, i) {
  const { type, selector } = step.advance;
  if (type === "click") {
    const handler = (e) => {
      if (!e.target.closest(selector)) return;
      document.removeEventListener("click", handler, true);
      setTimeout(() => { if (running) showStep(i + 1); }, 250);
    };
    document.addEventListener("click", handler, true);
    cleanupFns.push(() => document.removeEventListener("click", handler, true));
  } else if (type === "count") {
    const baseline = document.querySelectorAll(selector).length;
    const interval = setInterval(() => {
      if (document.querySelectorAll(selector).length > baseline) {
        clearInterval(interval);
        if (running) showStep(i + 1);
      }
    }, 300);
    cleanupFns.push(() => clearInterval(interval));
  }
}
