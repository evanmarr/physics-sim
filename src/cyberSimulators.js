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

// Two of these simulators run a live interval/rAF loop (the TOTP clock, the
// firewall's packet feed) that has to be stopped explicitly — a plain
// container.innerHTML = "" elsewhere would detach the DOM nodes but leave
// those loops running forever in the background. Returning one cleanup
// function lets the caller (cybersecurity.js) stop them on tab switch or
// unmount.
export function renderCyberSimulators(container) {
  container.innerHTML = "";
  const totpCard = build2FASimulator();
  const firewallCard = buildFirewallSimulator();
  container.appendChild(buildPasswordSimulator());
  container.appendChild(buildPhishingSimulator());
  container.appendChild(buildHashSimulator());
  container.appendChild(totpCard);
  container.appendChild(firewallCard);
  return () => {
    totpCard._stopTotp?.();
    firewallCard._stopFirewall?.();
  };
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

// ---------- Hashing & the avalanche effect ----------
// A genuinely real SHA-256 digest via the browser's own Web Crypto API
// (crypto.subtle) — not a toy hash written for the demo. The point being
// taught: a hash isn't a checksum you can eyeball for "close enough";
// changing one character anywhere in the input scrambles roughly half the
// output bits, which is exactly what makes a hash useful for detecting
// tampering (and useless for spotting *how much* something changed).
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexDiffPercent(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return Math.round((diff / a.length) * 100);
}

function buildHashSimulator() {
  const card = div("cyber-sim-card");
  const h = document.createElement("h2");
  h.className = "cyber-sim-title";
  h.textContent = "Hashing & the avalanche effect";
  card.appendChild(h);

  const p = document.createElement("p");
  p.className = "cyber-sim-desc";
  p.textContent = "This computes a real SHA-256 hash (the same algorithm behind Bitcoin, TLS certificates, and most password storage) using your browser's own crypto engine — nothing faked. Type something, then change just one character and watch how much of the hash changes. That's the \"avalanche effect\": a good hash makes a tiny input change unpredictable and total, so a hash is great for proving a file wasn't tampered with, but useless for telling you how it was changed.";
  card.appendChild(p);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cyber-sim-input";
  input.placeholder = "Type anything…";
  input.autocomplete = "off";
  input.spellcheck = false;
  card.appendChild(input);

  const hashOut = div("cyber-hash-out");
  card.appendChild(hashOut);

  const stats = div("cyber-sim-stats");
  card.appendChild(stats);

  let lastHash = null, lastText = null, generation = 0;

  async function update() {
    const myGeneration = ++generation;
    const text = input.value;
    if (!text) {
      hashOut.textContent = "";
      stats.innerHTML = `<div class="cyber-sim-hint">Nothing typed yet.</div>`;
      lastHash = null; lastText = null;
      return;
    }
    const hash = await sha256Hex(text);
    if (myGeneration !== generation) return; // a newer keystroke already superseded this one
    hashOut.textContent = hash;
    const diffPct = hexDiffPercent(lastHash, hash);
    if (diffPct === null) {
      stats.innerHTML = `<div class="cyber-sim-hint">256 bits of output, all-or-nothing — no partial credit for a "close" guess.</div>`;
    } else {
      stats.innerHTML = `<div class="cyber-sim-hint">Changed <strong>${diffPct}%</strong> of the hash's hex digits from one keystroke ago — for a good hash, that number hovers around 50% no matter how small the edit was.</div>`;
    }
    lastHash = hash;
    lastText = text;
  }

  input.addEventListener("input", update);
  update();
  return card;
}

// ---------- Two-factor authentication (real TOTP, RFC 6238) ----------
// This is the actual algorithm Google Authenticator/Authy/etc. run: HMAC-
// SHA1 over the current 30-second time window, then "dynamic truncation"
// down to a 6-digit code (RFC 4226). A real app encodes the shared secret
// as base32 for typing/QR-scanning into your phone — this demo skips that
// text-encoding step (it only ever needs to show the secret to itself,
// never hand it to a separate app), but the code that comes out is
// computed exactly the way a real authenticator's would be.
async function hotp(secretBytes, counter, digits = 6) {
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  // Counter is a 64-bit big-endian integer; JS numbers are safe up to 2^53,
  // far beyond any realistic counter value here, so splitting into two
  // 32-bit halves is exact.
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuf));
  const offset = sig[sig.length - 1] & 0x0f;
  const binCode = ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) | ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, "0");
}

function totpCounter(stepSeconds = 30) {
  return Math.floor(Date.now() / 1000 / stepSeconds);
}

function build2FASimulator() {
  const card = div("cyber-sim-card");
  const h = document.createElement("h2");
  h.className = "cyber-sim-title";
  h.textContent = "Two-factor authentication (real TOTP)";
  card.appendChild(h);

  const p = document.createElement("p");
  p.className = "cyber-sim-desc";
  p.textContent = "This is the actual algorithm (RFC 6238) behind an authenticator app: a secret key plus the current 30-second time window, run through HMAC-SHA1, produces a 6-digit code that changes on its own — no server round-trip needed, which is why it still works with your phone in airplane mode. A leaked password alone can't get in here, because logging in also needs whatever is generating this code right now.";
  card.appendChild(p);

  const secretRow = div("cyber-sim-stats");
  card.appendChild(secretRow);

  const codeDisplay = div("cyber-totp-code");
  card.appendChild(codeDisplay);

  const bar = div("cyber-sim-meter-track");
  const barFill = div("cyber-sim-meter-fill");
  bar.appendChild(barFill);
  card.appendChild(bar);

  const newSecretBtn = document.createElement("button");
  newSecretBtn.className = "cyber-sim-btn";
  newSecretBtn.textContent = "Issue a new secret";
  card.appendChild(newSecretBtn);

  let secret, secretHex;
  let lastCounter = -1;
  let rafId = null;

  function newSecret() {
    secret = crypto.getRandomValues(new Uint8Array(20)); // 160 bits, the standard HOTP/TOTP secret size
    secretHex = [...secret].map((b) => b.toString(16).padStart(2, "0")).join("");
    secretRow.innerHTML = `<div class="cyber-sim-hint">Secret key (normally hidden behind a QR code): <code>${secretHex}</code></div>`;
    lastCounter = -1;
  }

  async function tick() {
    const stepSeconds = 30;
    const counter = totpCounter(stepSeconds);
    const secsIntoStep = Math.floor(Date.now() / 1000) - counter * stepSeconds;
    barFill.style.width = `${(secsIntoStep / stepSeconds) * 100}%`;
    barFill.style.background = "var(--accent, #4f8cff)";
    if (counter !== lastCounter) {
      lastCounter = counter;
      codeDisplay.textContent = await hotp(secret, counter);
    }
    rafId = requestAnimationFrame(tick);
  }

  newSecretBtn.addEventListener("click", newSecret);
  newSecret();
  tick();
  card._stopTotp = () => { if (rafId) cancelAnimationFrame(rafId); };
  return card;
}

// ---------- Firewall rule simulator ----------
// Deterministic, real first-match-wins rule evaluation — exactly how
// iptables/most packet filters work, not a randomized "sometimes it
// blocks it" simulation. Random traffic is generated just to have
// something to test the rules against.
const PROTOCOLS = ["TCP", "UDP"];
const SAMPLE_IPS = ["203.0.113.7", "198.51.100.42", "192.0.2.15", "10.0.0.5", "185.220.101.3"];
const KNOWN_BAD_IP = "185.220.101.3"; // a real Tor exit-node range used in security teaching examples

function randomPacket() {
  return {
    ip: SAMPLE_IPS[Math.floor(Math.random() * SAMPLE_IPS.length)],
    port: [22, 25, 80, 443, 3389, 8080][Math.floor(Math.random() * 6)],
    protocol: PROTOCOLS[Math.floor(Math.random() * PROTOCOLS.length)],
  };
}

function evaluateRules(rules, packet) {
  for (const rule of rules) {
    const portMatch = !rule.port || Number(rule.port) === packet.port;
    const ipMatch = !rule.ip || packet.ip.startsWith(rule.ip);
    const protoMatch = !rule.protocol || rule.protocol === packet.protocol;
    if (portMatch && ipMatch && protoMatch) return rule;
  }
  return null; // no matching rule — default-deny, like a real firewall's implicit final rule
}

function buildFirewallSimulator() {
  const card = div("cyber-sim-card");
  const h = document.createElement("h2");
  h.className = "cyber-sim-title";
  h.textContent = "Firewall rules";
  card.appendChild(h);

  const p = document.createElement("p");
  p.className = "cyber-sim-desc";
  p.textContent = "Simulated packets arrive on the left; your rules are checked top to bottom and the first one that matches wins (exactly how a real firewall like iptables evaluates its rule chain) — if nothing matches, the packet is dropped by default. Reorder matters: a broad ALLOW above a specific BLOCK will let the traffic the BLOCK was supposed to stop right through.";
  card.appendChild(p);

  const rulesList = div("cyber-fw-rules");
  card.appendChild(rulesList);

  const addRow = div("cyber-fw-add");
  const actionSel = document.createElement("select");
  actionSel.innerHTML = `<option value="ALLOW">ALLOW</option><option value="BLOCK">BLOCK</option>`;
  const portInput = document.createElement("input");
  portInput.type = "text"; portInput.placeholder = "port (blank = any)"; portInput.maxLength = 5;
  const ipInput = document.createElement("input");
  ipInput.type = "text"; ipInput.placeholder = "source IP prefix (blank = any)"; ipInput.maxLength = 15;
  const protoSel = document.createElement("select");
  protoSel.innerHTML = `<option value="">any protocol</option><option value="TCP">TCP</option><option value="UDP">UDP</option>`;
  const addBtn = document.createElement("button");
  addBtn.className = "cyber-sim-btn";
  addBtn.textContent = "Add rule";
  addRow.append(actionSel, portInput, ipInput, protoSel, addBtn);
  card.appendChild(addRow);

  const feed = div("cyber-fw-feed");
  card.appendChild(feed);

  // A sane starting rule set — block a known-malicious source outright,
  // allow the two normal web ports, drop everything else by falling
  // through to the implicit default-deny.
  const rules = [
    { action: "BLOCK", ip: KNOWN_BAD_IP, port: "", protocol: "" },
    { action: "ALLOW", ip: "", port: "443", protocol: "TCP" },
    { action: "ALLOW", ip: "", port: "80", protocol: "TCP" },
  ];

  function renderRules() {
    rulesList.innerHTML = "";
    rules.forEach((rule, i) => {
      const row = div("cyber-fw-rule" + (rule.action === "BLOCK" ? " cyber-fw-rule-block" : " cyber-fw-rule-allow"));
      row.innerHTML = `
        <span class="cyber-fw-rule-num">${i + 1}</span>
        <span class="cyber-fw-rule-action">${rule.action}</span>
        <span>${rule.protocol || "any proto"}</span>
        <span>port ${rule.port || "any"}</span>
        <span>from ${rule.ip || "any"}</span>
      `;
      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "Remove rule";
      del.addEventListener("click", () => { rules.splice(i, 1); renderRules(); });
      row.appendChild(del);
      rulesList.appendChild(row);
    });
    const fallthrough = div("cyber-fw-rule cyber-fw-rule-block");
    fallthrough.innerHTML = `<span class="cyber-fw-rule-num">${rules.length + 1}</span><span class="cyber-fw-rule-action">BLOCK</span><span colspan="3">everything else (default deny)</span>`;
    rulesList.appendChild(fallthrough);
  }

  addBtn.addEventListener("click", () => {
    rules.push({ action: actionSel.value, port: portInput.value.trim(), ip: ipInput.value.trim(), protocol: protoSel.value });
    portInput.value = ""; ipInput.value = "";
    renderRules();
  });

  function logPacket() {
    const packet = randomPacket();
    const matched = evaluateRules(rules, packet);
    const allowed = matched?.action === "ALLOW";
    const line = div("cyber-fw-line" + (allowed ? " cyber-fw-allowed" : " cyber-fw-blocked"));
    line.textContent = `${packet.protocol} ${packet.ip} → port ${packet.port}: ${allowed ? "ALLOWED" : "BLOCKED"}${matched ? " (rule match)" : " (default deny)"}`;
    feed.prepend(line);
    while (feed.children.length > 12) feed.removeChild(feed.lastChild);
  }

  renderRules();
  for (let i = 0; i < 3; i++) logPacket();
  const intervalId = setInterval(logPacket, 1800);
  card._stopFirewall = () => clearInterval(intervalId);
  return card;
}
