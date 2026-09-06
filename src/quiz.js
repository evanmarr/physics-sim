import { ELEMENTS, CATEGORY_LABELS, elementBySymbol, phaseAt, ROOM_TEMP_K, REACTION_TABLE } from "./chemistryData.js";
import { MATERIALS, MATERIAL_LIST, materialOf } from "./materials.js";
import { PLANETS, DWARF_PLANETS, MOONS, orbitalPeriodDays } from "./astronomyData.js";
import { HISTORY_CATEGORIES } from "./historyData.js";
import { CYBER_CATEGORIES, CYBER_ENTRIES } from "./cybersecurityData.js";

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
  for (const el of shuffle(ELEMENTS).slice(0, 10)) {
    const kind = sample(["symbol", "number", "category", "phase"]);
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
    } else if (kind === "phase") {
      const phase = phaseAt(el, ROOM_TEMP_K);
      const allPhases = ["solid", "liquid", "gas"];
      questions.push({
        prompt: `What phase is ${el.name} (${el.symbol}) in at room temperature (298 K)?`,
        options: shuffle(allPhases),
        answer: phase,
        explanation: `${el.name} is a ${phase} at room temperature.`,
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

  // Reaction-recall questions, pulled straight from this app's own curated
  // reaction table — same facts the Chemistry mode's mixing bench uses.
  const reactionKeys = shuffle(Object.keys(REACTION_TABLE)).slice(0, 4);
  for (const key of reactionKeys) {
    const recipe = REACTION_TABLE[key];
    const symbols = key.split("-");
    const distractors = pick(
      Object.values(REACTION_TABLE).filter((r) => r.formula !== recipe.formula),
      3
    ).map((r) => r.formula);
    questions.push({
      prompt: `What do ${symbols.map((s) => elementBySymbol(s)?.name || s).join(" and ")} (${symbols.join(" + ")}) combine to form?`,
      options: shuffle([recipe.formula, ...distractors]),
      answer: recipe.formula,
      explanation: `${symbols.join(" + ")} → ${recipe.formula} (${recipe.name}). ${recipe.note}`,
    });
  }

  return { title: "Periodic Table Quiz", questions: shuffle(questions) };
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
  {
    prompt: "Newton's Third Law says every force has an equal and opposite reaction. When a heavy ball and a light ball collide, which one feels the bigger force?",
    options: ["Both feel exactly the same force", "The heavy ball", "The light ball", "Neither — momentum isn't force"],
    answer: "Both feel exactly the same force",
    explanation: "The force is always equal and opposite on both objects — what differs is the acceleration each one gets from it, since the lighter ball has less mass to push around (F = m·a).",
  },
  {
    prompt: "In this sim, a rope is built as a chain of small rigid segments. Why does each segment need an explicit length:0 on its connecting constraint?",
    options: [
      "Matter.js doesn't rotate a constraint's auto-computed rest length by the body's angle at creation time",
      "Rope segments have no mass",
      "It makes the rope invisible",
      "It disables gravity on the rope",
    ],
    answer: "Matter.js doesn't rotate a constraint's auto-computed rest length by the body's angle at creation time",
    explanation: "For a pre-rotated segment, the auto-computed rest length silently bakes in the wrong value — setting it explicitly to 0 sidesteps that bug entirely.",
  },
  {
    prompt: "Why do a ball bearing and the board it pivots need to be on a shared no-collide group?",
    options: [
      "The bearing sits physically embedded inside the board — without it, solid-body collision fights the pin constraint every step",
      "So the board changes color",
      "To make the bearing invisible",
      "It's purely a performance optimization, not a correctness fix",
    ],
    answer: "The bearing sits physically embedded inside the board — without it, solid-body collision fights the pin constraint every step",
    explanation: "Two overlapping solid bodies get pushed apart by collision resolution every tick — fighting a rigid pin constraint that's trying to hold them together looks like violent jitter.",
  },
  {
    prompt: "What is momentum, in terms of an object's mass (m) and velocity (v)?",
    options: ["p = m·v", "p = m + v", "p = m/v", "p = v²/m"],
    answer: "p = m·v",
    explanation: "Momentum is mass times velocity — a heavy, slow object and a light, fast one can carry the same momentum.",
  },
  {
    prompt: "Two identical balls collide with restitution e = 1 (perfectly elastic). What happens to their total kinetic energy?",
    options: ["It's conserved — none is lost", "All of it converts to heat", "Half of it is lost", "It doubles"],
    answer: "It's conserved — none is lost",
    explanation: "e = 1 means a perfectly elastic collision: kinetic energy in equals kinetic energy out. Any e below 1 loses some energy to heat/sound/deformation.",
  },
  {
    prompt: "A spring pad in this sim sets an object's velocity instantly on contact. What's different about that compared to a fan's force?",
    options: [
      "It's a one-time velocity change, not a continuous force applied over time",
      "It only works on metal objects",
      "It ignores the object it hits",
      "It's identical to a fan, just renamed",
    ],
    answer: "It's a one-time velocity change, not a continuous force applied over time",
    explanation: "An idealized spring in this sim always launches at the same fixed speed the instant it's touched, unlike a fan's force which keeps accelerating a body the whole time it's in range.",
  },
  {
    prompt: "If you double an object's mass but keep the same net force applied, what happens to its acceleration?",
    options: ["It's cut in half", "It doubles", "It stays the same", "It quadruples"],
    answer: "It's cut in half",
    explanation: "a = F/m — with F fixed, doubling the mass halves the acceleration.",
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

// Data-driven from this sim's own real orbital-element table (the same
// numbers that place every planet), plus a few concept questions grounded
// in how the mode actually works.
function buildAstronomyQuestions() {
  const questions = [];

  const byDistance = [...PLANETS].sort((a, b) => a.elements[0] - b.elements[0]);
  const closest = byDistance[0], farthest = byDistance[byDistance.length - 1];
  questions.push({
    prompt: "Which planet orbits closest to the Sun?",
    options: shuffle(pick(PLANETS.filter((p) => p !== closest), 3).map((p) => p.name).concat(closest.name)),
    answer: closest.name,
    explanation: `${closest.name} orbits at just ${closest.elements[0].toFixed(2)} AU from the Sun — the innermost planet.`,
  });
  questions.push({
    prompt: "Which planet orbits farthest from the Sun?",
    options: shuffle(pick(PLANETS.filter((p) => p !== farthest), 3).map((p) => p.name).concat(farthest.name)),
    answer: farthest.name,
    explanation: `${farthest.name} orbits at about ${farthest.elements[0].toFixed(1)} AU — the outermost of the 8 planets.`,
  });

  const byRadius = [...PLANETS].sort((a, b) => a.radiusKm - b.radiusKm);
  const smallest = byRadius[0], largest = byRadius[byRadius.length - 1];
  questions.push({
    prompt: "Which is the largest planet in the solar system?",
    options: shuffle(pick(PLANETS.filter((p) => p !== largest), 3).map((p) => p.name).concat(largest.name)),
    answer: largest.name,
    explanation: `${largest.name} has a radius of about ${largest.radiusKm.toLocaleString()} km — more than 11x Earth's.`,
  });
  questions.push({
    prompt: "Which is the smallest planet in the solar system?",
    options: shuffle(pick(PLANETS.filter((p) => p !== smallest), 3).map((p) => p.name).concat(smallest.name)),
    answer: smallest.name,
    explanation: `${smallest.name} has a radius of about ${smallest.radiusKm.toLocaleString()} km.`,
  });

  const retrograde = PLANETS.filter((p) => p.rotationHours < 0);
  if (retrograde.length) {
    const target = sample(retrograde);
    questions.push({
      prompt: "Which planet spins backwards (retrograde rotation) compared to most others?",
      options: shuffle(pick(PLANETS.filter((p) => !retrograde.includes(p)), 3).map((p) => p.name).concat(target.name)),
      answer: target.name,
      explanation: `${target.name} rotates in the opposite direction to its orbit — this sim marks that with a negative rotation period.`,
    });
  }

  const p1 = sample(PLANETS);
  const years = orbitalPeriodDays(p1) / 365.25;
  const fmtYears = (y) => (y < 2 ? y.toFixed(2) : String(Math.round(y)));
  const wrongYears = [years * 0.5, years * 2, years * 3.3].map(fmtYears);
  questions.push({
    prompt: `About how many Earth years does ${p1.name} take to orbit the Sun once?`,
    options: shuffle([fmtYears(years), ...wrongYears]),
    answer: fmtYears(years),
    explanation: `${p1.name} takes about ${fmtYears(years)} Earth years per orbit — from Kepler's third law (period² ∝ distance³).`,
  });

  const moon1 = sample(MOONS);
  const otherHosts = [...new Set(MOONS.map((m) => m.host))].filter((h) => h !== moon1.host);
  questions.push({
    prompt: `Which planet does the moon ${moon1.name} orbit?`,
    options: shuffle(pick(otherHosts, Math.min(3, otherHosts.length)).concat(moon1.host)),
    answer: moon1.host,
    explanation: `${moon1.name} is one of ${moon1.host}'s major moons.`,
  });

  const retroMoon = MOONS.find((m) => m.periodDays < 0);
  if (retroMoon) {
    questions.push({
      prompt: "Which large moon orbits its planet backwards — a sign it was captured rather than formed in place?",
      options: shuffle(pick(MOONS.filter((m) => m !== retroMoon), 3).map((m) => m.name).concat(retroMoon.name)),
      answer: retroMoon.name,
      explanation: `${retroMoon.name} orbits ${retroMoon.host} backwards relative to the planet's own spin and its other moons — strong evidence it's a captured object, not one that formed alongside ${retroMoon.host}.`,
    });
  }

  const dp = sample(DWARF_PLANETS);
  questions.push({
    prompt: `${dp.name} is classified as a...`,
    options: shuffle(["Dwarf planet", "Major planet", "Moon", "Asteroid"]),
    answer: "Dwarf planet",
    explanation: `${dp.name} is one of this sim's dwarf planets — round enough for its own gravity to pull it into a sphere, but it hasn't cleared its orbital neighborhood the way a major planet has.`,
  });

  questions.push({
    prompt: "This sim positions every planet using...",
    options: ["Real orbital elements and Kepler's equation, for the exact date shown", "A looping pre-recorded animation", "Random placement each time it loads", "A single fixed reference image"],
    answer: "Real orbital elements and Kepler's equation, for the exact date shown",
    explanation: "Positions are computed live from each planet's real orbital elements — scrubbing the date instantly recomputes where everything actually was or will be, not a canned animation.",
  });
  questions.push({
    prompt: "Why are planet sizes and moon distances shown exaggerated instead of true-to-scale?",
    options: ["At true scale, the inner planets and moons would be invisible specks", "To make the simulation run faster", "The real sizes aren't precisely known", "It's a rendering limit of the browser"],
    answer: "At true scale, the inner planets and moons would be invisible specks",
    explanation: "Real solar-system distances and sizes span such an enormous range that true-to-scale rendering would make almost everything too small to see or click on.",
  });

  return { title: "Astronomy Quiz", questions: pick(questions, 10) };
}

function firstPerson(people) {
  return people.split(",")[0].split(" and ")[0].trim();
}

// Pulled straight from the History mode's own timeline entries.
function buildHistoryQuestions() {
  const questions = [];
  const pool = HISTORY_CATEGORIES.flatMap((cat) => cat.entries.map((e) => ({ ...e, category: cat.label })));
  const plainYear = pool.filter((e) => /^\d{3,4}$/.test(e.year));

  for (const entry of shuffle(plainYear).slice(0, 6)) {
    const year = parseInt(entry.year, 10);
    const distractors = shuffle([
      year - Math.floor(Math.random() * 40 + 10),
      year + Math.floor(Math.random() * 40 + 10),
      year + Math.floor(Math.random() * 90 + 50),
    ]).map(String);
    questions.push({
      prompt: `In what year did this happen — "${entry.title}" (${entry.category})?`,
      options: shuffle([entry.year, ...distractors]),
      answer: entry.year,
      explanation: `${entry.year}: ${entry.title}. ${entry.summary}`,
    });
  }

  for (const entry of shuffle(pool).slice(0, 4)) {
    const correctPerson = firstPerson(entry.people);
    const distractors = pick(pool.filter((e) => firstPerson(e.people) !== correctPerson), 3).map((e) => firstPerson(e.people));
    questions.push({
      prompt: `Who is credited with this, in ${entry.year}: "${entry.title}"?`,
      options: shuffle([correctPerson, ...distractors]),
      answer: correctPerson,
      explanation: `${entry.people} — ${entry.summary}`,
    });
  }

  return { title: "History Quiz", questions: shuffle(questions) };
}

// Pulled straight from Cybersecurity mode's own searchable entry list.
function buildCybersecurityQuestions() {
  const questions = [];
  const categoryLabel = (key) => CYBER_CATEGORIES.find((c) => c.key === key)?.label ?? key;

  for (const entry of shuffle(CYBER_ENTRIES).slice(0, 6)) {
    const otherLabels = CYBER_CATEGORIES.filter((c) => c.key !== entry.category).map((c) => c.label);
    questions.push({
      prompt: `What kind of entry is "${entry.name}" (${entry.year})?`,
      options: shuffle([categoryLabel(entry.category), ...otherLabels]),
      answer: categoryLabel(entry.category),
      explanation: `${entry.name} — ${entry.summary}`,
    });
  }

  for (const entry of shuffle(CYBER_ENTRIES).slice(0, 6)) {
    const distractors = pick(CYBER_ENTRIES.filter((e) => e.id !== entry.id), 3).map((e) => e.name);
    questions.push({
      prompt: entry.summary,
      options: shuffle([entry.name, ...distractors]),
      answer: entry.name,
      explanation: `${entry.name} (${entry.year}) — ${entry.detail}`,
    });
  }

  return { title: "Cybersecurity Quiz", questions: pick(questions, 10) };
}

// ---- Runner ----

let state = null;

function bankFor(mode) {
  if (mode === "chemistry") return buildChemistryQuestions();
  if (mode === "physics") return buildPhysicsQuestions();
  if (mode === "astronomy") return buildAstronomyQuestions();
  if (mode === "history") return buildHistoryQuestions();
  if (mode === "cybersecurity") return buildCybersecurityQuestions();
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

// Clicking the dimmed backdrop (not the question box itself) closes the
// quiz too, same as pressing Close — wired once at load, since the modal
// element itself is static markup that never gets rebuilt.
document.getElementById("quiz-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "quiz-modal") closeQuiz();
});

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
