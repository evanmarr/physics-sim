// A short, preference-based (never knowledge-based) quiz shown once after
// sign-in — purely to personalize things like which Home page sections get
// emphasized later, never used to gate or grade anything. Skippable at any
// point, and reopenable afterward from the account menu to change answers.
import { getUser, onAuthChange, savePreferences } from "./auth.js";

const QUESTIONS = [
  {
    key: "role",
    prompt: "What brings you to Kinetic?",
    multi: false,
    options: ["Just curious", "Student", "Teacher", "Hobbyist / tinkerer"],
  },
  {
    key: "subjects",
    prompt: "Which subjects are you most excited to explore? (pick any)",
    multi: true,
    options: ["Physics", "Chemistry", "Astronomy", "History", "Cybersecurity", "Mathematics", "Economics", "Zoology", "Genetics", "Sound", "Sustainability", "War"],
  },
  {
    key: "learningStyle",
    prompt: "How do you like to learn something new?",
    multi: false,
    options: ["Jump in and experiment", "Read the explanation first", "A mix of both"],
  },
  {
    key: "background",
    prompt: "How much science background do you have?",
    multi: false,
    options: ["New to this", "Some background", "Very experienced"],
  },
];

let modal, box, step, answers;

export function initOnboarding() {
  modal = document.getElementById("onboarding-modal");
  box = document.getElementById("onboarding-modal-box");
  const menuBtn = document.getElementById("preferences-btn");

  menuBtn.addEventListener("click", () => open());

  let offeredThisLoad = false;
  onAuthChange((user) => {
    menuBtn.classList.toggle("hidden", !user);
    // preferences is undefined while signed out, null once signed in but
    // never having gone through this (or skipped it) — {} (or any real
    // answers) means it's done and shouldn't pop up again on its own.
    // offeredThisLoad stops a second auth-change tick (e.g. after saving
    // some other account setting) from reopening it in the same visit.
    if (user && user.preferences == null && !offeredThisLoad) { offeredThisLoad = true; open(); }
  });
}

function open() {
  const user = getUser();
  answers = { ...(user?.preferences || {}) };
  step = 0;
  render();
  modal.classList.remove("hidden");
}

function render() {
  const q = QUESTIONS[step];
  const selected = new Set(q.multi ? (answers[q.key] || []) : [answers[q.key]].filter(Boolean));
  box.innerHTML = `
    <div class="onboarding-progress">${QUESTIONS.map((_, i) => `<span class="onboarding-dot${i === step ? " active" : ""}${i < step ? " done" : ""}"></span>`).join("")}</div>
    <h2>${q.prompt}</h2>
    <div class="onboarding-options">
      ${q.options.map((opt) => `<button class="onboarding-option${selected.has(opt) ? " selected" : ""}" data-opt="${opt.replace(/"/g, "&quot;")}">${opt}</button>`).join("")}
    </div>
    <div class="onboarding-actions">
      <button id="onboarding-skip">Skip</button>
      <div class="onboarding-actions-right">
        ${step > 0 ? '<button id="onboarding-back">Back</button>' : ""}
        <button id="onboarding-next" class="primary">${step === QUESTIONS.length - 1 ? "Finish" : "Next"}</button>
      </div>
    </div>
  `;

  box.querySelectorAll(".onboarding-option").forEach((btn) => btn.addEventListener("click", () => {
    const opt = btn.dataset.opt;
    if (q.multi) {
      const list = new Set(answers[q.key] || []);
      if (list.has(opt)) list.delete(opt); else list.add(opt);
      answers[q.key] = [...list];
    } else {
      answers[q.key] = opt;
    }
    render();
  }));
  box.querySelector("#onboarding-skip").addEventListener("click", () => finish({}));
  box.querySelector("#onboarding-back")?.addEventListener("click", () => { step--; render(); });
  box.querySelector("#onboarding-next").addEventListener("click", () => {
    if (step < QUESTIONS.length - 1) { step++; render(); }
    else finish(answers);
  });
}

async function finish(finalAnswers) {
  modal.classList.add("hidden");
  await savePreferences(finalAnswers);
}
