// Two small, genuinely interactive security simulators — not more reference
// text, but things you actually do: type a password and watch a real
// crack-time estimate change, or hunt for the actual red flags in a
// realistic phishing email. Rendered inside Cybersecurity mode's own
// "Simulators" tab (see cybersecurity.js).

function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

export function renderCyberSimulators(container) {
  container.innerHTML = "";
  container.appendChild(buildPasswordSimulator());
  container.appendChild(buildPhishingSimulator());
}

// ---------- Password strength / crack-time estimator ----------

function buildPasswordSimulator() {
  const card = div("cyber-sim-card");
  const h = document.createElement("h2");
  h.className = "cyber-sim-title";
  h.textContent = "Password strength";
  card.appendChild(h);

  const p = document.createElement("p");
  p.className = "cyber-sim-desc";
  p.textContent = "Crack time is estimated the way an attacker actually thinks about it: how many distinct characters could each position be (the charset), raised to the power of how many positions there are (the length) — not whether it \"looks random\" to a person. A guessed word out of the dictionary is weak no matter how long it is; four random words can beat a short jumble of symbols.";
  card.appendChild(p);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cyber-sim-input";
  input.placeholder = "Type a password to test…";
  input.autocomplete = "off";
  input.spellcheck = false;
  card.appendChild(input);

  const meterTrack = div("cyber-sim-meter-track");
  const meterFill = div("cyber-sim-meter-fill");
  meterTrack.appendChild(meterFill);
  card.appendChild(meterTrack);

  const stats = div("cyber-sim-stats");
  card.appendChild(stats);

  const GUESSES_PER_SEC = 1e10; // a realistic offline fast-hash cracking rig, not an online login form's rate limit

  function estimate(pw) {
    if (!pw) return null;
    let charset = 0;
    if (/[a-z]/.test(pw)) charset += 26;
    if (/[A-Z]/.test(pw)) charset += 26;
    if (/[0-9]/.test(pw)) charset += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) charset += 33;
    const bits = pw.length * Math.log2(Math.max(charset, 1));
    const combinations = Math.pow(2, bits);
    const seconds = combinations / GUESSES_PER_SEC / 2; // /2: average case is half the full keyspace
    return { bits, seconds, charset };
  }

  function humanTime(seconds) {
    if (seconds < 1) return "instantly";
    const units = [
      ["century", 60 * 60 * 24 * 365 * 100],
      ["year", 60 * 60 * 24 * 365],
      ["day", 60 * 60 * 24],
      ["hour", 60 * 60],
      ["minute", 60],
      ["second", 1],
    ];
    for (const [name, size] of units) {
      if (seconds >= size) {
        const n = seconds / size;
        const shown = n > 1e6 ? n.toExponential(1) : Math.round(n).toLocaleString();
        const plural = name === "century" ? "centuries" : `${name}s`;
        return `${shown} ${n >= 2 ? plural : name}`;
      }
    }
    return "instantly";
  }

  function update() {
    const result = estimate(input.value);
    if (!result) {
      meterFill.style.width = "0%";
      meterFill.style.background = "var(--border)";
      stats.innerHTML = `<div class="cyber-sim-hint">Nothing typed yet — try something you'd actually use, then try adding a symbol or two.</div>`;
      return;
    }
    const { bits, seconds } = result;
    const pct = Math.min(100, (bits / 100) * 100);
    let color = "#f87171", label = "Very weak";
    if (bits >= 80) { color = "#34d399"; label = "Very strong"; }
    else if (bits >= 60) { color = "#4ade80"; label = "Strong"; }
    else if (bits >= 40) { color = "#facc15"; label = "Fair"; }
    else if (bits >= 25) { color = "#fb923c"; label = "Weak"; }
    meterFill.style.width = `${pct}%`;
    meterFill.style.background = color;
    stats.innerHTML = `
      <div><strong style="color:${color}">${label}</strong> — ${Math.round(bits)} bits of entropy</div>
      <div class="cyber-sim-hint">Estimated crack time at ${GUESSES_PER_SEC.toLocaleString()} guesses/sec (a realistic offline attack rig): <strong>${humanTime(seconds)}</strong></div>
    `;
  }

  input.addEventListener("input", update);
  update();
  return card;
}

// ---------- Phishing email spotter ----------

const EMAILS = [
  {
    from: "IT-Support@paypa1-secure.com",
    subject: "Urgent: Your account will be suspended in 24 hours",
    clues: [
      { text: "paypa1-secure.com", reason: "Not the real domain — a \"1\" standing in for an \"l\", plus an extra word tacked on. Always check the actual domain, not just that it \"looks like\" a brand." },
      { text: "Urgent: Your account will be suspended in 24 hours", reason: "Manufactured urgency is a classic pressure tactic — it's designed to make you act before you think to verify anything." },
      { text: "click here immediately to verify your identity", reason: "A vague \"click here\" link, rather than telling you to log in directly through the site you already know, is a red flag." },
      { text: "Failure to respond will result in permanent account closure.", reason: "A threat with a deadline is meant to short-circuit careful thinking — real companies rarely threaten permanent loss over email." },
    ],
    body: (mark) => `Dear Customer,<br><br>We have detected unusual activity on your account. ${mark("Urgent: Your account will be suspended in 24 hours")} unless you verify your information.<br><br>Please ${mark("click here immediately to verify your identity")}.<br><br>${mark("Failure to respond will result in permanent account closure.")}<br><br>Thank you,<br>Account Security Team`,
  },
  {
    from: "payroll@yourcompany-hr-portal.net",
    subject: "Updated direct deposit form needed",
    clues: [
      { text: "yourcompany-hr-portal.net", reason: "A generic, unofficial-looking domain pretending to be your employer's HR system — real payroll mail comes from your actual company domain." },
      { text: "Dear Employee", reason: "A generic greeting instead of your real name is common in mass-sent phishing, since the sender doesn't actually have your employee record." },
      { text: "download and complete the attached form with your bank login credentials", reason: "No legitimate payroll system ever asks you to email your bank login credentials in a form — that's not how direct deposit changes work." },
      { text: "This request expires today", reason: "Another artificial deadline, meant to get you moving before you'd stop to call HR and check." },
    ],
    body: (mark) => `${mark("Dear Employee")},<br><br>Our records show your direct deposit information needs updating. Please ${mark("download and complete the attached form with your bank login credentials")}.<br><br>${mark("This request expires today")} — please submit as soon as possible.<br><br>HR Payroll Team`,
  },
];

function buildPhishingSimulator() {
  const card = div("cyber-sim-card");
  const h = document.createElement("h2");
  h.className = "cyber-sim-title";
  h.textContent = "Spot the phishing email";
  card.appendChild(h);

  const p = document.createElement("p");
  p.className = "cyber-sim-desc";
  p.textContent = "Click on anything in the email below you think is a red flag. Real phishing almost always combines several of these tricks at once — a fake-but-close domain, manufactured urgency, a vague link, an unusual request, and an artificial deadline.";
  card.appendChild(p);

  const scoreEl = div("cyber-sim-hint");
  card.appendChild(scoreEl);

  const emailBox = div("phish-email");
  card.appendChild(emailBox);

  const newBtn = document.createElement("button");
  newBtn.className = "cyber-sim-btn";
  newBtn.textContent = "Try another email";
  card.appendChild(newBtn);

  let email, found;

  function mark(text, escapedIndex) {
    return `<span class="phish-clue" data-idx="${escapedIndex}">${text}</span>`;
  }

  function load() {
    email = EMAILS[Math.floor(Math.random() * EMAILS.length)];
    found = new Set();
    render();
  }

  // clues[0] is always the sender-domain clue (see EMAILS above) — it lives
  // in the From line, not the body, so it's marked up separately here but
  // still counts toward the same found-them-all score as the body clues.
  function render() {
    scoreEl.textContent = `Found ${found.size} of ${email.clues.length} red flags`;
    const domainClue = email.clues[0];
    const fromHtml = email.from.replace(domainClue.text, mark(domainClue.text, 0));
    let idx = 1;
    const bodyHtml = email.body((text) => mark(text, idx++));
    emailBox.innerHTML = `
      <div class="phish-field"><strong>From:</strong> ${fromHtml}</div>
      <div class="phish-field"><strong>Subject:</strong> ${email.subject}</div>
      <div class="phish-body">${bodyHtml}</div>
    `;
    emailBox.querySelectorAll(".phish-clue").forEach((el) => {
      const i = Number(el.dataset.idx);
      if (found.has(i)) el.classList.add("found");
      el.addEventListener("click", () => {
        if (found.has(i)) return;
        found.add(i);
        el.classList.add("found");
        el.title = email.clues[i].reason;
        scoreEl.textContent = `Found ${found.size} of ${email.clues.length} red flags`;
        if (found.size === email.clues.length) {
          scoreEl.textContent += " — nice catch, that's all of them!";
        }
      });
    });
  }

  newBtn.addEventListener("click", load);
  load();
  return card;
}
