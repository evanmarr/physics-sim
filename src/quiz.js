import { ELEMENTS, CATEGORY_LABELS, elementBySymbol } from "./chemistryData.js";
import { ORGANS, SYSTEMS, BRAIN_PARTS_LOBES, BRAIN_PARTS_CROSS_SECTION } from "./anatomyData.js";
import { MATERIALS, MATERIAL_LIST, materialOf } from "./materials.js";

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(arr, n) { return shuffle(arr).slice(0, n); }
function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---- Question banks ----

function buildChemistryQuestions() {
  const questions = [];
  for (const el of shuffle(ELEMENTS).slice(0, 12)) {
    const kind = sample(["symbol", "number", "category"]);
    if (kind === "symbol") {
      const distractors = pick(ELEMENTS.filter((e) => e.symbol !== el.symbol), 3).map((e) => e.symbol);
      questions.push({
        prompt: `What is the chemical symbol for ${el.name}?`,
        options: shuffle([el.symbol, ...distractors]),
        answer: el.symbol,
        explanation: `${el.name} is element #${el.number}, symbol ${el.symbol}.`,
      });
    } else if (kind === "number") {
      const nearby = ELEMENTS.filter((e) => Math.abs(e.number - el.number) > 2 && Math.abs(e.number - el.number) < 30);
      const distractors = pick(nearby.length >= 3 ? nearby : ELEMENTS, 3).map((e) => e.number);
      questions.push({
        prompt: `${el.name} (${el.symbol}) has which atomic number?`,
        options: shuffle([el.number, ...distractors]).map(String),
        answer: String(el.number),
        explanation: `${el.name}'s atomic number is ${el.number} — its number of protons.`,
      });
    } else {
      const distractorCats = shuffle(Object.keys(CATEGORY_LABELS).filter((c) => c !== el.category)).slice(0, 3);
      questions.push({
        prompt: `What category of element is ${el.name} (${el.symbol})?`,
        options: shuffle([el.category, ...distractorCats]).map((c) => CATEGORY_LABELS[c]),
        answer: CATEGORY_LABELS[el.category],
        explanation: `${el.name} is a ${CATEGORY_LABELS[el.category].toLowerCase()}.`,
      });
    }
  }
  return { title: "Periodic Table Quiz", questions };
}

// Static concept questions, same {prompt, options, answer, explanation}
// shape as the data-driven banks below — grounded in this sim's own
// mechanics (the exact equations shown in the physics-math panel) rather
// than generic trivia.
const PHYSICS_CONCEPT_QUESTIONS = [
  {
    prompt: "In this sim, an object's mass is computed as m = ρ · A. What is A?",
    options: ["Its 2D area", "Its acceleration", "Its angle of rotation", "Its air resistance"],
    answer: "Its 2D area",
    explanation: "This is a 2D sim, so \"volume\" is just area — mass comes from density × area.",
  },
  {
    prompt: "A restitution (e) of 0 means an impact rebounds at...",
    options: ["0% of impact speed (no bounce)", "50% of impact speed", "100% of impact speed (perfectly elastic)", "Twice the impact speed"],
    answer: "0% of impact speed (no bounce)",
    explanation: "e=0 is a perfectly inelastic collision — no bounce at all. e=1 would lose no energy.",
  },
  {
    prompt: "Two objects have the same shape and size but different densities. Which needs more force to accelerate at the same rate?",
    options: ["The denser one", "The less dense one", "Neither — force needed is the same", "Density doesn't affect this"],
    answer: "The denser one",
    explanation: "F = m·a — a denser object of the same size has more mass, so it takes more force for the same acceleration.",
  },
  {
    prompt: "By Archimedes' principle, an object floats in water when...",
    options: ["Its density is less than water's", "Its density is greater than water's", "Its density equals air's", "It has high friction"],
    answer: "Its density is less than water's",
    explanation: "F_buoyancy = ρ_fluid · V_submerged · g pushes up regardless of the object's material — it floats if it's less dense than the fluid.",
  },
  {
    prompt: "A cannon's launch velocity is v = (P·cos θ, P·sin θ). What is θ?",
    options: ["The Fire Angle", "The Power", "The Rest Angle", "The gravity scale"],
    answer: "The Fire Angle",
    explanation: "P is the launch speed (Power); θ (Fire Angle) sets its direction — this is the standard projectile-velocity decomposition.",
  },
  {
    prompt: "A fan's push force falls off the further an object is from it — unlike a bomb, what's different about how a fan applies force?",
    options: ["It applies continuously, every tick, not just once", "It only pushes metal objects", "It has no maximum range", "It applies force instantly as a velocity change"],
    answer: "It applies continuously, every tick, not just once",
    explanation: "A bomb is a one-off impulse; a fan reapplies its force every single tick a body stays in range, so the push compounds over time.",
  },
  {
    prompt: "High friction (μ close to 1) between two surfaces means...",
    options: ["They grip rather than slide against each other", "They bounce off each other more", "They're both very dense", "They ignore gravity"],
    answer: "They grip rather than slide against each other",
    explanation: "μ measures resistance to sliding — near 0 glides freely, high friction resists sliding and grips.",
  },
  {
    prompt: "A magnet's force in this sim only pulls on objects made of which material?",
    options: ["Metal", "Rubber", "Glass", "Wood"],
    answer: "Metal",
    explanation: "The magnet checks each object's material and only attracts/repels metal — everything else is unaffected, just like a real magnet.",
  },
  {
    prompt: "Why does a ball bearing let a board pivot and swing freely?",
    options: ["It's a frictionless point constraint pinned at one spot", "It applies constant upward force", "It removes gravity from the board", "It doubles the board's density"],
    answer: "It's a frictionless point constraint pinned at one spot",
    explanation: "The bearing pins the board to one fixed point with no rotational resistance, so the board swings around it like a real pivot/hinge.",
  },
  {
    prompt: "What does Newton's First Law say happens to an object with no net force acting on it?",
    options: ["It keeps moving at constant velocity (or stays at rest)", "It always speeds up", "It always slows to a stop", "It falls at 9.8 units/s² regardless"],
    answer: "It keeps moving at constant velocity (or stays at rest)",
    explanation: "Inertia: without a net force, velocity doesn't change — this is why objects need friction, gravity, or a push to change speed or direction.",
  },
];

function buildPhysicsQuestions() {
  const questions = [...PHYSICS_CONCEPT_QUESTIONS];

  // Material-comparison questions, generated straight from this sim's own
  // materials.js numbers — real values, not hand-written trivia.
  const byDensity = [...MATERIAL_LIST].sort((a, b) => materialOf(a).density - materialOf(b).density);
  const lightest = byDensity[0], densest = byDensity[byDensity.length - 1];
  questions.push({
    prompt: "Of this sim's materials, which is the densest?",
    options: shuffle(pick(MATERIAL_LIST.filter((m) => m !== densest), 3).concat(densest)).map((m) => materialOf(m).label),
    answer: materialOf(densest).label,
    explanation: `${materialOf(densest).label} has a density of ${materialOf(densest).density} — the highest of this sim's materials.`,
  });
  questions.push({
    prompt: "Which material floats on water (density < 1.0)?",
    options: shuffle(pick(MATERIAL_LIST.filter((m) => m !== lightest), 3).concat(lightest)).map((m) => materialOf(m).label),
    answer: materialOf(lightest).label,
    explanation: `${materialOf(lightest).label} has a density of ${materialOf(lightest).density}, below water's 1.0 — the rest sink.`,
  });
  const byRestitution = [...MATERIAL_LIST].sort((a, b) => materialOf(b).restitution - materialOf(a).restitution);
  const bounciest = byRestitution[0];
  questions.push({
    prompt: "Which material bounces the most (highest restitution)?",
    options: shuffle(pick(MATERIAL_LIST.filter((m) => m !== bounciest), 3).concat(bounciest)).map((m) => materialOf(m).label),
    answer: materialOf(bounciest).label,
    explanation: `${materialOf(bounciest).label} has restitution ${materialOf(bounciest).restitution} — the bounciest material here.`,
  });

  return { title: "Physics Quiz", questions: pick(questions, 12) };
}

// Bounding box of a shape, so small organs (trachea, spinal cord) get
// zoomed in and large ones (intestines) get a wider view — a fixed viewBox
// for every organ made the small ones nearly invisible.
function boundsOf(s) {
  if (s.tag === "g") {
    const boxes = s.shapes.map(boundsOf);
    return {
      minX: Math.min(...boxes.map((b) => b.minX)), minY: Math.min(...boxes.map((b) => b.minY)),
      maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)),
    };
  }
  if (s.tag === "circle") return { minX: s.cx - s.r, minY: s.cy - s.r, maxX: s.cx + s.r, maxY: s.cy + s.r };
  if (s.tag === "ellipse") return { minX: s.cx - s.rx, minY: s.cy - s.ry, maxX: s.cx + s.rx, maxY: s.cy + s.ry };
  if (s.tag === "rect") return { minX: s.x, minY: s.y, maxX: s.x + s.width, maxY: s.y + s.height };
  if (s.tag === "path") {
    // our paths only use M/C/L/Z with plain numeric coordinates (no arc
    // flags), so every number in the string is part of an x,y pair.
    const nums = (s.d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  return { minX: 0, minY: 0, maxX: 300, maxY: 680 };
}

function svgSnippet(shape, size = 140) {
  const b = boundsOf(shape);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const pad = Math.max(w, h) * 0.35 + 8;
  const vbX = b.minX - pad, vbY = b.minY - pad, vbW = w + pad * 2, vbH = h + pad * 2;
  const shapeMarkup = shapeToSvg(shape);
  return `<svg viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${size}" height="${size}" class="quiz-organ-svg">${shapeMarkup}</svg>`;
}

function shapeToSvg(s) {
  const fill = "#e2483f";
  if (s.tag === "g") return s.shapes.map((sh) => shapeToSvg({ ...sh })).join("");
  if (s.tag === "circle") return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fill}"/>`;
  if (s.tag === "ellipse") return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${fill}"/>`;
  if (s.tag === "rect") return `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="${s.rx || 0}" fill="${fill}"/>`;
  if (s.tag === "path") return `<path d="${s.d}" fill="${s.strokeOnly ? "none" : fill}" stroke="${s.strokeOnly ? fill : "none"}" stroke-width="${s.strokeWidth || 4}"/>`;
  return "";
}

function buildAnatomyQuestions() {
  const questions = [];

  const bodyOrgans = ORGANS.filter((o) => o.system === "muscular" || o.system === "skeletal" || o.system === "cardiovascular" || o.system === "respiratory" || o.system === "digestive");
  for (const organ of pick(bodyOrgans, 8)) {
    const distractors = pick(ORGANS.filter((o) => o.id !== organ.id && o.name !== organ.name), 3).map((o) => o.name);
    questions.push({
      prompt: "What body part is highlighted here?",
      visual: svgSnippet(organ.shape),
      options: shuffle([organ.name, ...distractors]),
      answer: organ.name,
      explanation: `${organ.name} — part of the ${SYSTEMS.find((s) => s.id === organ.system)?.label} system. ${organ.function}`,
    });
  }

  const brainParts = [...BRAIN_PARTS_LOBES];
  for (const part of pick(brainParts, 6)) {
    const distractors = pick(brainParts.filter((p) => p.id !== part.id), 3).map((p) => p.name);
    questions.push({
      prompt: "Which part of the brain is this?",
      visual: svgSnippet(part.shape, 160),
      options: shuffle([part.name, ...distractors]),
      answer: part.name,
      explanation: `${part.name}: ${part.function}`,
    });
  }

  return { title: "Anatomy Quiz", questions: shuffle(questions) };
}

// ---- Runner ----

let state = null;

function bankFor(mode) {
  if (mode === "chemistry") return buildChemistryQuestions();
  if (mode === "anatomy") return buildAnatomyQuestions();
  if (mode === "physics") return buildPhysicsQuestions();
  return null;
}

export function openQuiz(mode) {
  const bank = bankFor(mode);
  if (!bank || !bank.questions.length) return;
  state = { ...bank, mode, index: 0, score: 0, answered: false };
  document.getElementById("quiz-modal").classList.remove("hidden");
  renderQuiz();
}


function closeQuiz() {
  document.getElementById("quiz-modal").classList.add("hidden");
}

function renderQuiz() {
  const box = document.getElementById("quiz-modal-box");
  if (state.index >= state.questions.length) {
    box.innerHTML = `
      <h2>${state.title} — Done!</h2>
      <div class="quiz-score">Score: ${state.score} / ${state.questions.length}</div>
      <button class="primary" id="quiz-retry">Try Again</button>
      <button id="quiz-close">Close</button>
    `;
    box.querySelector("#quiz-retry").addEventListener("click", () => openQuiz(state.mode));
    box.querySelector("#quiz-close").addEventListener("click", closeQuiz);
    return;
  }

  const q = state.questions[state.index];
  state.answered = false;
  box.innerHTML = `
    <div class="quiz-header">
      <h2>${state.title}</h2>
      <span class="quiz-progress">${state.index + 1} / ${state.questions.length} · Score ${state.score}</span>
    </div>
    ${q.visual ? `<div class="quiz-visual">${q.visual}</div>` : ""}
    <div class="quiz-prompt">${q.prompt}</div>
    <div class="quiz-options"></div>
    <div class="quiz-explanation hidden"></div>
    <div class="quiz-actions">
      <button id="quiz-next" class="primary hidden">Next</button>
      <button id="quiz-close-btn">Close</button>
    </div>
  `;

  const optionsEl = box.querySelector(".quiz-options");
  q.options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = opt;
    btn.addEventListener("click", () => selectAnswer(opt, btn, box));
    optionsEl.appendChild(btn);
  });

  box.querySelector("#quiz-next").addEventListener("click", () => { state.index++; renderQuiz(); });
  box.querySelector("#quiz-close-btn").addEventListener("click", closeQuiz);
}

function selectAnswer(opt, btn, box) {
  if (state.answered) return;
  state.answered = true;
  const q = state.questions[state.index];
  const correct = opt === q.answer;
  if (correct) state.score++;

  box.querySelectorAll(".quiz-option").forEach((b) => {
    b.disabled = true;
    if (b.textContent === q.answer) b.classList.add("correct");
    else if (b === btn) b.classList.add("incorrect");
  });

  const expl = box.querySelector(".quiz-explanation");
  expl.textContent = (correct ? "✓ Correct. " : "✗ Not quite. ") + q.explanation;
  expl.classList.remove("hidden");
  expl.classList.toggle("quiz-correct", correct);
  expl.classList.toggle("quiz-incorrect", !correct);

  box.querySelector("#quiz-next").classList.remove("hidden");
}
