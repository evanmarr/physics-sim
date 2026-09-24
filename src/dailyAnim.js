// Small library of canvas-2D explainer animations for the Concept of the Day.
// Every kind is a pure draw function (ctx, w, h, t, params, C): t is loop time in
// seconds (0..LOOP), split into three 3-second steps that match the 3 captions.
// C is a colour palette read from the page's CSS variables (theme aware).

export const LOOP = 9;
export const STEP = 3;
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const lerp = (a, b, u) => a + (b - a) * u;
const stepOf = (t) => Math.min(2, Math.floor(t / STEP));
const local = (t) => (t % STEP) / STEP;

export function readColors(el) {
  const cs = typeof getComputedStyle === "function" && el ? getComputedStyle(el) : null;
  const v = (n, d) => (cs && cs.getPropertyValue(n).trim()) || d;
  return {
    text: v("--text", "#1c1f26"), dim: v("--text-dim", "#6b7280"), accent: v("--accent", "#3b6fe0"),
    accent2: v("--accent-2", "#c9791a"), border: v("--border", "#d8dce2"), panel: v("--panel-alt", "#eef0f3"),
    good: v("--good", "#1f9d5c"), danger: v("--danger", "#d93a3a"),
  };
}

// ---- drawing helpers ----
function dot(c, x, y, r, fill, stroke) {
  c.beginPath(); c.arc(x, y, Math.max(0.5, r), 0, TAU);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
}
function ln(c, x1, y1, x2, y2, col, lw = 2, dash) {
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
  c.strokeStyle = col; c.lineWidth = lw; c.setLineDash(dash || []); c.stroke(); c.setLineDash([]);
}
function arrow(c, x1, y1, x2, y2, col, lw = 2.5) {
  const L = Math.hypot(x2 - x1, y2 - y1); if (L < 3) return;
  ln(c, x1, y1, x2, y2, col, lw);
  const a = Math.atan2(y2 - y1, x2 - x1), s = 7;
  c.beginPath(); c.moveTo(x2, y2);
  c.lineTo(x2 - s * Math.cos(a - 0.4), y2 - s * Math.sin(a - 0.4));
  c.lineTo(x2 - s * Math.cos(a + 0.4), y2 - s * Math.sin(a + 0.4)); c.closePath();
  c.fillStyle = col; c.fill();
}
function txt(c, s, x, y, col, size = 12, align = "center", bold = false) {
  c.font = `${bold ? "700 " : ""}${size}px system-ui, sans-serif`;
  c.fillStyle = col; c.textAlign = align; c.textBaseline = "middle"; c.fillText(s, x, y);
}
function tri(x) { const m = ((x % 2) + 2) % 2; return m < 1 ? m : 2 - m; } // triangle wave 0..1..0
function rnd(i) { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function wave(c, x0, x1, yMid, amp, fn, col, lw = 2) {
  c.beginPath();
  for (let x = x0; x <= x1; x += 2) { const y = yMid - amp * fn(x); x === x0 ? c.moveTo(x, y) : c.lineTo(x, y); }
  c.strokeStyle = col; c.lineWidth = lw; c.stroke();
}

const K = {};

// ---------- physics ----------
K.projectile = {
  title: "Projectile motion",
  caps: ["1. Launch at an angle.", "2. Gravity changes only the vertical speed.", "3. The path is a parabola."],
  draw(c, w, h, t, p, C) {
    const a = ((p.angle ?? 45) * Math.PI) / 180, g = p.g ?? 200, gy = h - 22, x0 = 26;
    const R = (w - 60) * 0.9, v = Math.sqrt((R * g) / Math.sin(2 * a)), Tf = (2 * v * Math.sin(a)) / g;
    ln(c, 0, gy, w, gy, C.border, 2);
    const at = (s) => [x0 + v * Math.cos(a) * s, gy - (v * Math.sin(a) * s - 0.5 * g * s * s)];
    c.beginPath();
    for (let i = 0; i <= 60; i++) { const [x, y] = at((Tf * i) / 60); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.strokeStyle = C.border; c.lineWidth = 2; c.setLineDash([5, 5]); c.stroke(); c.setLineDash([]);
    const q = clamp((t - 0.8) / 6.4), s = q * Tf, [x, y] = at(s);
    c.beginPath();
    for (let i = 0; i <= 40; i++) { const [px, py] = at((s * i) / 40); i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.strokeStyle = C.accent; c.lineWidth = 2.5; c.stroke();
    dot(c, x, y, 7, C.accent2);
    const k = 0.22, vx = v * Math.cos(a), vy = v * Math.sin(a) - g * s;
    if (t < 8.2) {
      arrow(c, x, y, x + vx * k, y, C.good);
      arrow(c, x, y, x, y - vy * k, C.danger);
      txt(c, "sideways: steady", Math.min(w - 50, x + vx * k + 4), y - 12, C.good, 11, "center");
    }
    txt(c, `${Math.round(p.angle ?? 45)}°`, x0 + 34, gy - 10, C.dim, 11);
  },
};

K.pendulum = {
  title: "Pendulum",
  caps: ["1. Lift the bob and let go.", "2. Height turns into speed, then back.", "3. The swing repeats at a steady rhythm."],
  draw(c, w, h, t, p, C) {
    const amp = p.amp ?? 0.7, T = p.period ?? 3, px = w * 0.4, py = 18, L = Math.min(h - 50, w * 0.6);
    const th = amp * Math.cos((TAU * t) / T), bx = px + L * Math.sin(th), by = py + L * Math.cos(th);
    c.beginPath(); c.arc(px, py, L, Math.PI / 2 - amp, Math.PI / 2 + amp);
    c.strokeStyle = C.border; c.lineWidth = 1.5; c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]);
    ln(c, px, py, bx, by, C.text, 2); dot(c, px, py, 4, C.dim); dot(c, bx, by, 14, C.accent);
    const hgt = (1 - Math.cos(th)) / (1 - Math.cos(amp)), bxr = w - 70, bh = h - 60;
    txt(c, "energy", bxr + 22, 14, C.dim, 11);
    c.fillStyle = C.accent2; c.fillRect(bxr, 24 + bh * (1 - hgt), 18, bh * hgt);
    c.fillStyle = C.good; c.fillRect(bxr + 26, 24 + bh * hgt, 18, bh * (1 - hgt));
    txt(c, "height", bxr + 9, h - 18, C.dim, 10); txt(c, "speed", bxr + 35, h - 6, C.dim, 10);
  },
};

K.spring = {
  title: "Spring and harmonic motion",
  caps: ["1. Pull the mass from rest.", "2. The spring pulls back in proportion to the stretch.", "3. It oscillates back and forth."],
  draw(c, w, h, t, p, C) {
    const A = w * 0.22, T = p.period ?? 3, d = p.damp ?? 0, wall = 24, mid = w * 0.5, y = h * 0.34;
    const xf = (s) => A * Math.exp(-d * s) * Math.cos((TAU * s) / T);
    const x = mid + xf(t), bw = 34;
    ln(c, wall, y - 26, wall, y + 26, C.text, 4);
    c.beginPath(); c.moveTo(wall, y);
    const coils = 10, x1 = x - bw / 2;
    for (let i = 1; i < coils * 2; i++) c.lineTo(wall + ((x1 - wall) * i) / (coils * 2), y + (i % 2 ? -10 : 10));
    c.lineTo(x1, y); c.strokeStyle = C.dim; c.lineWidth = 2; c.stroke();
    c.fillStyle = C.accent; c.fillRect(x - bw / 2, y - bw / 2, bw, bw);
    ln(c, mid, y + 30, mid, y + 40, C.border, 1); txt(c, "rest", mid, y + 50, C.dim, 10);
    const gy = h * 0.78, gh = h * 0.16; ln(c, 10, gy, w - 10, gy, C.border, 1);
    c.beginPath();
    for (let i = 0; i <= 120; i++) { const q = (t * i) / 120, Y = gy - (gh * xf(q)) / A; i ? c.lineTo(10 + ((w - 20) * q) / LOOP, Y) : c.moveTo(10, Y); }
    c.strokeStyle = C.accent2; c.lineWidth = 2; c.stroke();
  },
};

K.waves = {
  title: "Wave superposition",
  caps: ["1. Two waves travel through the same spot.", "2. Where they meet, their heights add.", "3. Peaks with peaks grow; peaks with troughs cancel."],
  draw(c, w, h, t, p, C) {
    const f1 = p.f1 ?? 3, f2 = p.f2 ?? 3, ph = p.phase2 ?? 0, lane = h / 3, amp = lane * 0.34;
    const s1 = (x) => Math.sin((TAU * f1 * x) / w - TAU * 0.5 * t);
    const s2 = (x) => Math.sin((TAU * f2 * x) / w - TAU * 0.5 * t + ph);
    const show = t < 3 ? 0.6 : 1;
    c.globalAlpha = show; wave(c, 0, w, lane * 0.5, amp, s1, C.accent); wave(c, 0, w, lane * 1.5, amp, s2, C.accent2); c.globalAlpha = 1;
    const sumA = t < 3 ? 0.25 : t < 6 ? clamp(local(t) * 2) : 1;
    c.globalAlpha = sumA; wave(c, 0, w, lane * 2.5, amp, (x) => (s1(x) + s2(x)) / 2, C.text, 3); c.globalAlpha = 1;
    txt(c, "wave A", 30, 10, C.accent, 11); txt(c, "wave B", 30, lane + 10, C.accent2, 11); txt(c, "sum", 20, 2 * lane + 10, C.text, 11);
  },
};

K.orbit = {
  title: "Orbit (Kepler)",
  caps: ["1. A planet circles the Sun in an ellipse.", "2. It speeds up when it is closer.", "3. It sweeps equal areas in equal times."],
  draw(c, w, h, t, p, C) {
    const e = p.e ?? 0.5, a = Math.min(w * 0.42, (h * 0.42) / Math.sqrt(1 - e * e)), b = a * Math.sqrt(1 - e * e);
    const cx = w / 2 - a * e * 0.5, cy = h / 2;
    const pos = (M) => { let E = M; for (let i = 0; i < 8; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); return [cx + a * Math.cos(E), cy + b * Math.sin(E)]; };
    const sx = cx + a * e;
    c.beginPath(); c.ellipse(cx, cy, a, b, 0, 0, TAU); c.strokeStyle = C.border; c.lineWidth = 1.5; c.stroke();
    const wedge = (M0, M1, col) => {
      c.beginPath(); c.moveTo(sx, cy);
      for (let i = 0; i <= 16; i++) { const [x, y] = pos(lerp(M0, M1, i / 16)); c.lineTo(x, y); }
      c.closePath(); c.fillStyle = col; c.globalAlpha = 0.35; c.fill(); c.globalAlpha = 1;
    };
    if (t >= STEP) { const d = 0.75; wedge(-d / 2, d / 2, C.accent); wedge(Math.PI - d / 2, Math.PI + d / 2, C.accent2); }
    dot(c, sx, cy, 9, "#f5b301");
    const M = (TAU * t) / LOOP, [x, y] = pos(M); dot(c, x, y, 6, C.accent);
    if (e > 0.15 && t >= STEP && t < 2 * STEP) txt(c, Math.hypot(x - sx, y - cy) < a ? "close: fast" : "far: slow", x, y - 14, C.dim, 11);
  },
};

K.incline = {
  title: "Forces on a ramp",
  caps: ["1. Gravity pulls the block straight down.", "2. The ramp pushes back, and part of gravity slides it.", "3. Friction fights the slide; the larger force wins."],
  draw(c, w, h, t, p, C) {
    const th = ((p.angle ?? 30) * Math.PI) / 180, mu = p.mu ?? 0.2, sin = Math.sin(th), cos = Math.cos(th);
    const x0 = 24, by = h - 20, rise = Math.min((w - 48) * Math.tan(th), h - 60), rr = rise / Math.tan(th), L = Math.hypot(rr, rise);
    c.beginPath(); c.moveTo(x0, by); c.lineTo(x0 + rr, by); c.lineTo(x0, by - rise); c.closePath();
    c.fillStyle = C.panel; c.fill(); c.strokeStyle = C.border; c.lineWidth = 2; c.stroke();
    const slides = sin > mu * cos, sz = 28, acc = slides ? (sin - mu * cos) * 220 : 0;
    const s = clamp(0.22 * L + (t >= 2 * STEP ? 0.5 * acc * (t - 2 * STEP) ** 2 : 0), 0, 0.9 * L - sz);
    const n = [sin, -cos], d = [cos, sin], px = x0 + d[0] * s, py = by - rise + d[1] * s;
    c.save(); c.translate(px, py); c.rotate(th); c.fillStyle = C.accent; c.fillRect(-sz / 2, -sz, sz, sz); c.restore();
    const cx = px + (n[0] * sz) / 2, cy = py + (n[1] * sz) / 2, S = 50;
    arrow(c, cx, cy, cx, cy + S, C.danger);
    if (t >= STEP) {
      arrow(c, cx, cy, cx + n[0] * S * cos, cy + n[1] * S * cos, C.good);
      arrow(c, cx, cy, cx + d[0] * S * sin, cy + d[1] * S * sin, C.accent2);
    }
    if (t >= 2 * STEP) { const f = Math.min(sin, mu * cos); arrow(c, cx, cy, cx - d[0] * S * f, cy - d[1] * S * f, C.text); }
    const legend = [["gravity", C.danger, 0], ["ramp push", C.good, 1], ["slide part", C.accent2, 1], ["friction", C.text, 2]];
    legend.forEach(([s2, col, st], i) => { if (t >= st * STEP) txt(c, s2, w - 44, 14 + i * 14, col, 10); });
    if (t >= 2 * STEP) txt(c, slides ? "it slides" : "it stays put", w - 44, 76, C.dim, 11, "center", true);
  },
};

K.collision = {
  title: "Collisions",
  caps: ["1. A moving cart heads for a resting one.", "2. They collide; total momentum stays the same.", "3. Elastic: energy bounces on. Inelastic: some becomes heat."],
  draw(c, w, h, t, p, C) {
    const el = p.elastic !== false, m1 = p.m1 ?? 1, m2 = p.m2 ?? 1, v = 70, y = h * 0.5, gy = y + 26;
    const w1 = 22 + 14 * Math.sqrt(m1), w2 = 22 + 14 * Math.sqrt(m2), x10 = 40 + w1 / 2, x20 = w * 0.6;
    const tc = (x20 - x10 - (w1 + w2) / 2) / v, cxp = x10 + v * tc;
    let v1 = v, v2 = 0, x1 = x10 + v * Math.min(t, tc), x2 = x20;
    if (t > tc) {
      const s = t - tc;
      if (el) { v1 = ((m1 - m2) / (m1 + m2)) * v; v2 = ((2 * m1) / (m1 + m2)) * v; }
      else { v1 = v2 = (m1 * v) / (m1 + m2); }
      x1 = cxp + v1 * s; x2 = x20 + v2 * s;
      if (!el) x2 = x1 + (w1 + w2) / 2;
    }
    x1 = clamp(x1, w1 / 2 + 4, w - w1 / 2 - 4); x2 = clamp(x2, w2 / 2 + 4, w - w2 / 2 - 4);
    ln(c, 0, gy, w, gy, C.border, 2);
    c.fillStyle = C.accent; c.fillRect(x1 - w1 / 2, y - w1 / 2 + 2, w1, w1);
    c.fillStyle = C.accent2; c.fillRect(x2 - w2 / 2, y - w2 / 2 + 2, w2, w2);
    const k = 0.5; if (Math.abs(v1) > 1) arrow(c, x1, y - w1 / 2 - 10, x1 + v1 * k, y - w1 / 2 - 10, C.text);
    if (Math.abs(v2) > 1) arrow(c, x2, y - w2 / 2 - 10, x2 + v2 * k, y - w2 / 2 - 10, C.text);
    const P = m1 * v, after = t > tc;
    txt(c, after ? "momentum after = before" : "momentum before", w / 2, h - 30, C.dim, 12);
    txt(c, after && !el ? "some kinetic energy became heat" : after ? "kinetic energy kept" : `p = ${P}`, w / 2, h - 12, after ? C.good : C.dim, 11);
    if (Math.abs(t - tc) < 0.25) { c.globalAlpha = 1 - Math.abs(t - tc) / 0.25; dot(c, (x1 + x2) / 2, y, 26, null, C.danger); c.globalAlpha = 1; }
  },
};

// ---------- chemistry ----------
K.atom = {
  title: "Atom and electron shells",
  caps: ["1. Protons and neutrons make the nucleus.", "2. Electrons fill shells around it.", "3. The outer shell decides how it reacts."],
  draw(c, w, h, t, p, C) {
    const shells = p.shells ?? [2, 8, 1], cx = w / 2, cy = h / 2, maxR = Math.min(w, h) / 2 - 8, r0 = 22;
    const step = shells.length > 1 ? (maxR - r0) / shells.length : 0;
    for (let i = 0; i < 7; i++) dot(c, cx + Math.cos(i * 2.1) * (i ? 5 : 0), cy + Math.sin(i * 2.1) * (i ? 5 : 0), 5, i % 2 ? C.danger : C.dim);
    shells.forEach((n, i) => {
      if (t < STEP && i >= 0) return;
      const r = r0 + step * (i + 1), last = i === shells.length - 1;
      c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.strokeStyle = t >= 2 * STEP && last ? C.accent2 : C.border; c.lineWidth = t >= 2 * STEP && last ? 2.5 : 1.5; c.stroke();
      for (let k = 0; k < n; k++) {
        const ang = (TAU * k) / n + (t * (1.4 - i * 0.3)) * (i % 2 ? -1 : 1);
        const pulse = t >= 2 * STEP && last ? 1 + 0.3 * Math.sin(t * 6) : 1;
        dot(c, cx + r * Math.cos(ang), cy + r * Math.sin(ang), 5 * pulse, last && t >= 2 * STEP ? C.accent2 : C.accent);
      }
    });
    txt(c, shells.join(" · ") + " electrons", cx, h - 8, C.dim, 11);
    if (t < STEP) txt(c, "nucleus", cx, cy + 22, C.dim, 10);
  },
};

K.molecule = {
  title: "Bonding and reactions",
  caps: ["1. Separate atoms or molecules drift near each other.", "2. Old bonds break and electrons rearrange.", "3. New bonds form; the same atoms make new substances."],
  draw(c, w, h, t, p, C) {
    const mode = p.mode ?? "reaction", u = ease((t - 3) / 3), cx = w / 2, cy = h / 2, wob = (i) => [Math.sin(t * 3 + i * 2) * 2, Math.cos(t * 2.4 + i) * 2];
    const bond = (a, b, dbl) => { ln(c, a[0], a[1], b[0], b[1], C.text, dbl ? 6 : 3); if (dbl) ln(c, a[0], a[1], b[0], b[1], C.panel, 2); };
    if (mode === "reaction") {
      const sc = Math.min(w, 340) / 340, S = (x, y) => [cx + x * sc, cy + y * sc];
      const R = [S(-120, -50), S(-88, -50), S(-120, 40), S(-88, 40), S(50, -6), S(88, -6)]; // H H H H O O
      // products: O(4) bonded to H(0),H(1) ; O(5) bonded to H(2),H(3)
      const P = [S(8, -50), S(92, -50), S(8, 30), S(92, 30), S(50, -30), S(50, 50)], kinds = ["H", "H", "H", "H", "O", "O"];
      const pos2 = R.map((r, i) => { const [wx, wy] = wob(i); return [lerp(r[0], P[i][0], u) + wx, lerp(r[1], P[i][1], u) + wy]; });
      if (t < 4.5) { bond(pos2[0], pos2[1]); bond(pos2[2], pos2[3]); bond(pos2[4], pos2[5], true); }
      else if (t >= 6) { bond(pos2[4], pos2[0]); bond(pos2[4], pos2[1]); bond(pos2[5], pos2[2]); bond(pos2[5], pos2[3]); }
      pos2.forEach((q, i) => { dot(c, q[0], q[1], kinds[i] === "O" ? 13 : 8, kinds[i] === "O" ? C.danger : C.accent); });
      txt(c, t < 4.5 ? "2 H₂ + O₂" : t < 6 ? "… rearranging …" : "2 H₂O", cx, h - 12, C.text, 13, "center", true);
    } else if (mode === "ionic") {
      const gap = lerp(90, 34, ease((t - 6) / 2)), na = [cx - gap, cy], cl = [cx + gap, cy], e = ease((t - 3) / 2);
      const ion = t >= 5;
      dot(c, na[0], na[1], 20, C.accent); dot(c, cl[0], cl[1], 26, C.good);
      const ex = lerp(na[0] + 26, cl[0] - 32, e), ey = cy - 6 * Math.sin(e * Math.PI) - 24 * Math.sin(e * Math.PI);
      dot(c, t < 3 ? na[0] + 24 : ex, t < 3 ? cy : ey, 5, C.accent2);
      txt(c, ion ? "Na⁺" : "Na", na[0], cy, "#fff", 13, "center", true); txt(c, ion ? "Cl⁻" : "Cl", cl[0], cy, "#fff", 13, "center", true);
      txt(c, t < 3 ? "sodium has 1 loose outer electron" : t < 6 ? "it jumps to chlorine" : "opposite charges attract: NaCl", cx, h - 12, C.dim, 11);
    } else { // covalent H2
      const gap = lerp(80, 26, ease((t - 3) / 3));
      dot(c, cx - gap, cy, 22, C.accent, null); dot(c, cx + gap, cy, 22, C.accent, null);
      if (t >= 4) { c.globalAlpha = 0.9; const a = ease((t - 4) / 2); dot(c, cx, cy - 6 * a, 5, C.accent2); dot(c, cx, cy + 6 * a, 5, C.accent2); c.globalAlpha = 1; }
      else { dot(c, cx - gap, cy, 5, C.accent2); dot(c, cx + gap, cy, 5, C.accent2); }
      txt(c, t < 4 ? "each H has 1 electron" : "they share a pair: H₂", cx, h - 12, C.dim, 11);
    }
  },
};

K.phase = {
  title: "States of matter",
  caps: ["1. Cold: particles vibrate in place (solid).", "2. Warmer: they slide past each other (liquid).", "3. Hot: they fly freely (gas)."],
  draw(c, w, h, t, p, C) {
    const k = t / LOOP, bx = 46, by = 14, bw = w - bx - 14, bh = h - 46, n = 40, cols = 8, rows = 5;
    c.strokeStyle = C.border; c.lineWidth = 2; c.strokeRect(bx, by, bw, bh);
    const g = ease((k - 0.6) / 0.2), liq = ease((k - 0.28) / 0.1), amp = 1.5 + 9 * liq;
    for (let i = 0; i < n; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const hx = bx + bw * (0.16 + 0.68 * (col + 0.5) / cols), hy = by + bh * (0.9 - 0.36 * (row + 0.5) / rows * (1 + liq * 0.4));
      const wx = Math.sin(t * (6 + rnd(i) * 4) + i) * amp, wy = Math.cos(t * (5 + rnd(i + 9) * 4) + i * 2) * amp;
      const gx = bx + 8 + (bw - 16) * tri(rnd(i + 3) + t * (0.15 + rnd(i + 5) * 0.25) * 1.2), gy = by + 8 + (bh - 16) * tri(rnd(i + 7) + t * (0.15 + rnd(i + 11) * 0.25));
      dot(c, lerp(hx + wx, gx, g), lerp(hy + wy, gy, g), 5.5, C.accent);
    }
    const T = k, ty = by + bh - bh * T;
    c.fillStyle = C.panel; c.fillRect(14, by, 14, bh); c.fillStyle = C.danger; c.fillRect(14, ty, 14, bh * T);
    txt(c, "heat", 21, by + bh + 12, C.dim, 10);
    txt(c, k < 0.3 ? p.solid ?? "solid" : k < 0.6 ? p.liquid ?? "liquid" : p.gas ?? "gas", bx + bw / 2, h - 12, C.text, 13, "center", true);
  },
};

// ---------- biology / genetics ----------
K.foodchain = {
  title: "Energy pyramid (10% rule)",
  caps: ["1. Plants capture sunlight as chemical energy.", "2. Each level up keeps only about 10% of it.", "3. The rest is used or lost as heat, so top levels are small."],
  draw(c, w, h, t, p, C) {
    const lv = p.levels ?? [["Plants", "10,000"], ["Plant-eaters", "1,000"], ["Predators", "100"], ["Top predator", "10"]];
    const n = lv.length, top = 26, bh = (h - top - 24) / n, mw = w * 0.86;
    txt(c, "☀ sunlight", w - 50, 12, C.accent2, 11);
    for (let i = 0; i < n; i++) {
      const lvl = n - 1 - i, y = top + i * bh, bw = mw * (0.25 + 0.75 * ((i + 1) / n) ** 1.2) * 0.9 + 20;
      if (t < lvl * 1.6) continue;
      c.fillStyle = [C.good, C.accent, C.accent2, C.danger][lvl % 4]; c.globalAlpha = 0.85;
      c.fillRect(w / 2 - bw / 2, y + 2, bw, bh - 4); c.globalAlpha = 1;
      txt(c, `${lv[lvl][0]} · ${lv[lvl][1]}`, w / 2, y + bh / 2, "#fff", Math.min(12, bh * 0.4), "center", true);
      if (lvl > 0 && t >= STEP && p.ratio !== "") txt(c, p.ratio ?? "\u224810%", Math.min(w - 22, w / 2 + bw / 2 + 24), y + bh, C.dim, 10);
    }
    if (t >= 2 * STEP) for (let i = 0; i < 10; i++) { const u = ((t * 0.5 + i / 10) % 1); dot(c, 14 + rnd(i) * 30 + Math.sin(i + t * 2) * 4, h - 22 - u * (h - 60), 2.5, C.danger); }
    if (t >= 2 * STEP) txt(c, "heat", 24, h - 8, C.danger, 10);
  },
};

K.punnett = {
  title: "Punnett square",
  caps: ["1. Each parent passes on one of their two alleles.", "2. Fill the square with every possible pairing.", "3. Count the offspring types to see the odds."],
  draw(c, w, h, t, p, C) {
    const a = p.p1 ?? "Aa", b = p.p2 ?? "Aa", s = Math.min(w * 0.22, (h - 50) / 2.4, 70), gx = w / 2 - s, gy = 40;
    const dom = (g) => g[0] === g[0].toUpperCase() || g[1] === g[1].toUpperCase();
    txt(c, "parent 1", gx + s, 12, C.dim, 10); txt(c, "parent 2", gx - s * 0.55, gy + s, C.dim, 10, "center");
    for (let i = 0; i < 2; i++) { txt(c, a[i], gx + s * (i + 0.5), gy - 10, C.accent, 16, "center", true); txt(c, b[i], gx - 12, gy + s * (i + 0.5), C.accent2, 16, "center", true); }
    let nd = 0, nr = 0;
    for (let r = 0; r < 2; r++) for (let q = 0; q < 2; q++) {
      const idx = r * 2 + q, gt = [a[q], b[r]].sort((x, y2) => (x < y2 ? -1 : 1)).join(""), d = dom(gt), on = t >= STEP + idx * 0.7;
      c.strokeStyle = C.border; c.lineWidth = 2; c.strokeRect(gx + q * s, gy + r * s, s, s);
      if (on) { c.fillStyle = d ? C.accent : C.accent2; c.globalAlpha = 0.28; c.fillRect(gx + q * s + 1, gy + r * s + 1, s - 2, s - 2); c.globalAlpha = 1; txt(c, gt, gx + (q + 0.5) * s, gy + (r + 0.5) * s, C.text, 16, "center", true); if (d) nd++; else nr++; }
    }
    if (t >= 2 * STEP + 0.5) txt(c, `${nd} dominant : ${nr} recessive look`, w / 2, h - 12, C.text, 12, "center", true);
    else txt(c, t < STEP ? "capital = dominant allele" : "each box = 1 in 4", w / 2, h - 12, C.dim, 11);
  },
};

// ---------- economics ----------
K.supplydemand = {
  title: "Supply and demand",
  caps: ["1. Price settles where supply meets demand.", "2. Something changes: a curve shifts.", "3. A new balance: the price and quantity move."],
  draw(c, w, h, t, p, C) {
    const L = 40, B = h - 30, W = w - L - 16, H = B - 16, dir = p.dir ?? 1, sh = p.shift ?? "demand";
    const s = ease((t - 3) / 2.5) * 0.28 * dir;
    const D = (q, o) => 0.9 - 0.7 * q + o, S = (q, o) => 0.1 + 0.7 * q - o; // price 0..1
    const dOff = sh === "demand" ? s : 0, sOff = sh === "supply" ? s : 0; // supply shift right = lower prices
    const eq = (dO, sO) => { const q = (0.9 + dO - 0.1 + sO) / 1.4; return [q, D(q, dO)]; };
    const X = (q) => L + W * q, Y = (pr) => B - H * pr;
    ln(c, L, 8, L, B, C.text, 2); ln(c, L, B, w - 8, B, C.text, 2);
    txt(c, "price", 18, 20, C.dim, 10); txt(c, "quantity", w - 34, B + 14, C.dim, 10);
    const line = (f, o, col, lab, dash) => { ln(c, X(0.02), Y(f(0.02, o)), X(0.98), Y(f(0.98, o)), col, 3, dash); txt(c, lab, X(0.98) - 6, Y(f(0.98, o)) + (lab === "S" ? -10 : 10), col, 12, "center", true); };
    line(D, 0, C.border, "", [4, 4]); line(S, 0, C.border, "", [4, 4]);
    line(D, dOff, C.accent, "D"); line(S, sOff, C.accent2, "S");
    const [q0, p0] = eq(0, 0), [q1, p1] = eq(dOff, sOff);
    ln(c, L, Y(p0), X(q0), Y(p0), C.border, 1, [3, 3]); dot(c, X(q0), Y(p0), 5, C.dim);
    ln(c, L, Y(p1), X(q1), Y(p1), C.good, 1.5, [3, 3]); ln(c, X(q1), Y(p1), X(q1), B, C.good, 1.5, [3, 3]); dot(c, X(q1), Y(p1), 7, C.good);
    if (t >= 2 * STEP) txt(c, `price ${p1 > p0 + 0.01 ? "rises" : "falls"}, quantity ${q1 > q0 + 0.01 ? "rises" : "falls"}`, w / 2 + 14, 14, C.text, 12, "center", true);
  },
};

// ---------- cybersecurity ----------
function toyHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0).toString(16).padStart(8, "0");
}
export { toyHash as _toyHash };
K.hashing = {
  title: "Hashing and the avalanche effect",
  caps: ["1. A hash turns any input into a fixed-size fingerprint.", "2. Change one tiny thing in the input…", "3. …and the fingerprint changes completely."],
  draw(c, w, h, t, p, C) {
    if (p.mode === "caesar") {
      const shift = p.shift ?? 3, cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 14, r = R - 26;
      const rot = ease((t - 3) / 3) * shift * (TAU / 26);
      for (let i = 0; i < 26; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 26, ch = String.fromCharCode(65 + i);
        txt(c, ch, cx + R * Math.cos(a), cy + R * Math.sin(a), C.text, 12, "center", true);
        const a2 = a - rot; txt(c, ch, cx + r * Math.cos(a2), cy + r * Math.sin(a2), t >= 3 ? C.accent2 : C.dim, 11);
      }
      const word = t < 6 ? "HELLO" : [...("HELLO")].map((x) => String.fromCharCode(((x.charCodeAt(0) - 65 + shift) % 26) + 65)).join("");
      txt(c, word, cx, cy - 6, t < 6 ? C.text : C.accent2, 18, "center", true);
      txt(c, t < 3 ? "plain letters" : t < 6 ? `shift by ${shift}` : "secret message", cx, cy + 16, C.dim, 10);
      return;
    }
    const A = p.a ?? "cat", B = p.b ?? "cot", show = t >= STEP ? B : A;
    const hs = toyHash(show), ha = toyHash(A), y = h * 0.3;
    txt(c, "input", 12, y - 26, C.dim, 10, "left"); txt(c, `"${show}"`, w / 2, y, C.text, 18, "center", true);
    arrow(c, w / 2, y + 16, w / 2, y + 44, C.dim);
    txt(c, "hash", w / 2 + 34, y + 30, C.dim, 10);
    const cw = Math.min(30, (w - 24) / 8);
    for (let i = 0; i < 8; i++) {
      const x = w / 2 - 4 * cw + i * cw + cw / 2, changed = t >= 2 * STEP && hs[i] !== ha[i], flick = t >= STEP && t < 2 * STEP + 0.4 && Math.floor(t * 12 + i) % 2 === 0 && t < 2 * STEP;
      c.fillStyle = changed ? C.accent2 : C.panel; c.fillRect(x - cw / 2 + 1, y + 54, cw - 2, 34);
      txt(c, flick ? "?" : hs[i], x, y + 71, changed ? "#fff" : C.text, 16, "center", true);
    }
    if (t >= 2 * STEP) txt(c, "almost every character changed", w / 2, y + 108, C.accent2, 12, "center", true);
    else txt(c, t >= STEP ? "one letter differs" : "same input → same fingerprint", w / 2, y + 108, C.dim, 12);
    txt(c, "(toy hash for illustration)", w / 2, h - 8, C.dim, 9);
  },
};

// ---------- mathematics ----------
K.sorting = {
  title: "Sorting and number sense",
  caps: ["1. Start with a jumbled set.", "2. Apply one simple rule again and again.", "3. Order (or a pattern) appears."],
  draw(c, w, h, t, p, C) {
    const mode = p.mode ?? "sort";
    if (mode === "numberline") {
      const a = p.a ?? 3, b = p.b ?? -5, lo = Math.min(0, a, a + b) - 1, hi = Math.max(0, a, a + b) + 1, y = h * 0.62, L = 20, W = w - 40;
      const X = (v) => L + (W * (v - lo)) / (hi - lo);
      ln(c, L, y, L + W, y, C.text, 2);
      for (let v = Math.ceil(lo); v <= hi; v++) { ln(c, X(v), y - 5, X(v), y + 5, C.text, 1.5); txt(c, String(v), X(v), y + 18, v === 0 ? C.text : C.dim, 11); }
      const hop = (f, to, col, u) => { const x1 = X(f), x2 = X(lerp(f, to, u)); ln(c, x1, y - 24, x2, y - 24, col, 3); arrow(c, x1, y - 24, x2, y - 24, col); };
      const u1 = clamp((t - 0.5) / 2), u2 = clamp((t - 3.5) / 2.5);
      hop(0, a, C.accent, u1); if (t >= 3) hop(a, a + b, C.accent2, u2);
      dot(c, X(t < 3 ? lerp(0, a, u1) : lerp(a, a + b, u2)), y, 8, C.danger);
      txt(c, t < 3 ? `start at 0, move ${a >= 0 ? "+" : ""}${a}` : t < 6 ? `then move ${b >= 0 ? "+" : ""}${b}` : `${a} ${b < 0 ? "−" : "+"} ${Math.abs(b)} = ${a + b}`, w / 2, 20, t >= 6 ? C.text : C.dim, 14, "center", t >= 6);
      return;
    }
    if (mode === "primes") {
      const N = 30, cols = 10, cs = Math.min(34, (w - 20) / cols), x0 = (w - cs * cols) / 2, y0 = 12, out = new Set();
      const step = stepOf(t), lim = t < 1.5 ? 0 : step === 0 ? 2 : step === 1 ? 3 : 5;
      const marks = [2, 3, 5];
      for (let n = 2; n <= N; n++) for (const m of marks) if (m <= lim && n !== m && n % m === 0) out.add(n);
      for (let n = 1; n <= N; n++) {
        const x = x0 + ((n - 1) % cols) * cs, y = y0 + Math.floor((n - 1) / cols) * cs * 0.95, isOut = n === 1 || out.has(n);
        c.fillStyle = t >= 7 && !isOut ? C.accent : C.panel; c.fillRect(x + 2, y + 2, cs - 4, cs * 0.95 - 4);
        txt(c, String(n), x + cs / 2, y + cs * 0.475, t >= 7 && !isOut ? "#fff" : isOut ? C.border : C.text, 12, "center", !isOut);
      }
      txt(c, t < 1.5 ? "list 1 to 30" : t < 3 ? "cross out multiples of 2" : t < 6 ? "then multiples of 3" : t < 7 ? "then multiples of 5" : "what remains is prime", w / 2, h - 12, C.dim, 12);
      return;
    }
    const vals = [5, 2, 7, 1, 6, 3, 8, 4], arr = vals.slice(), frames = [arr.slice()];
    for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr.length - 1 - i; j++) if (arr[j] > arr[j + 1]) { [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]]; frames.push(arr.slice()); }
    const fi = Math.min(frames.length - 1, Math.floor(clamp((t - 1.5) / 6.5) * frames.length)), cur = frames[fi], bw = (w - 30) / cur.length;
    cur.forEach((v, i) => {
      const bh = ((h - 50) * v) / 8, sortedSpot = fi === frames.length - 1;
      c.fillStyle = sortedSpot ? C.good : C.accent; c.fillRect(15 + i * bw + 3, h - 24 - bh, bw - 6, bh);
      txt(c, String(v), 15 + i * bw + bw / 2, h - 12, C.dim, 11);
    });
    txt(c, "bubble sort: swap neighbours that are out of order", w / 2, 12, C.dim, 11);
  },
};

// ---------- sound ----------
K.sound = {
  title: "Sound waves: pitch and loudness",
  caps: ["1. Sound is a vibration that travels as a wave.", "2. Faster vibration (higher frequency) means higher pitch.", "3. Bigger vibration (amplitude) means louder sound."],
  draw(c, w, h, t, p, C) {
    const f0 = p.freq ?? 3, mid = h / 2;
    const fq = t < STEP ? f0 : t < 2 * STEP ? lerp(f0, f0 * 2, ease(local(t) * 2)) : f0 * 2;
    const am = t < 2 * STEP ? 0.35 : lerp(0.35, 0.85, ease(local(t) * 2));
    ln(c, 0, mid, w, mid, C.border, 1);
    wave(c, 0, w, mid, (h / 2 - 12) * am, (x) => Math.sin((TAU * fq * x) / w - TAU * 0.6 * t), C.accent, 3);
    txt(c, t < STEP ? "one note" : t < 2 * STEP ? "higher pitch" : "louder", w - 40, 12, C.dim, 11);
    if (t >= STEP) { const y = h - 12; txt(c, t < 2 * STEP ? `pitch ↑ ${Math.round(fq / f0 * 100) / 100}×` : "amplitude ↑", w / 2, y, t < 2 * STEP ? C.accent2 : C.danger, 11); }
  },
};

// ---------- exponential ----------
K.exponential = {
  title: "Exponential change",
  caps: ["1. Start with a small amount.", "2. Each step multiplies it by the same factor.", "3. The curve races upward (or shrinks toward zero)."],
  draw(c, w, h, t, p, C) {
    const decay = p.mode === "decay", n = 7, base = h - 26, top = 24, bw = (w - 30) / n, unit = p.unit ?? "step";
    for (let i = 0; i < n; i++) {
      const v = decay ? 1 / 2 ** i : 2 ** i / 2 ** (n - 1), on = clamp((t - 0.5 - i * 0.9) / 0.5);
      const bh = (base - top) * v * on; c.fillStyle = decay ? C.accent2 : C.accent; c.globalAlpha = 0.85; c.fillRect(15 + i * bw + 4, base - bh, bw - 8, bh); c.globalAlpha = 1;
      txt(c, `${i}`, 15 + i * bw + bw / 2, base + 12, C.dim, 11);
      if (on > 0.9) txt(c, decay ? (i === 0 ? "1" : `1/${2 ** i}`) : String(2 ** i), 15 + i * bw + bw / 2, base - bh - 9, C.text, 10);
    }
    ln(c, 12, base, w - 12, base, C.text, 1.5);
    if (t >= 2 * STEP) {
      c.beginPath();
      for (let i = 0; i <= 60; i++) { const s = (i / 60) * (n - 1), v = decay ? 2 ** -s : 2 ** s / 2 ** (n - 1), x = 15 + s * bw + bw / 2, y = base - (base - top) * v; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.strokeStyle = C.danger; c.lineWidth = 2.5; c.stroke();
    }
    txt(c, decay ? `halves every ${unit}` : `doubles every ${unit}`, w / 2, 10, C.dim, 11);
  },
};

// ---------- history ----------
K.timeline = {
  title: "Timeline",
  caps: ["1. Follow the story from the earliest event…", "2. …through each turning point…", "3. …to where it leads."],
  draw(c, w, h, t, p, C) {
    const ev = p.events ?? [{ label: "Start" }, { label: "Middle" }, { label: "End" }], n = ev.length, L = 30, W = w - 60, y = h / 2;
    const prog = clamp((t - 0.5) / 7.5); ln(c, L, y, L + W, y, C.border, 3); ln(c, L, y, L + W * prog, y, C.accent, 3);
    ev.forEach((e, i) => {
      const u = n > 1 ? i / (n - 1) : 0, x = L + W * u, hit = prog >= u - 1e-6, age = prog - u, pulse = hit ? 1 + 0.6 * Math.max(0, 1 - age * 6) : 1;
      dot(c, x, y, hit ? 7 * pulse : 5, hit ? C.accent2 : C.border, hit ? null : null);
      const up = i % 2 === 0, ty = y + (up ? -34 : 34);
      if (hit) {
        const lines = [e.year ? String(e.year) : null, e.label].filter(Boolean);
        lines.forEach((s, k) => txt(c, s, clamp(x, 40, w - 40), ty + (up ? -8 * (lines.length - 1 - k) * 1.5 + 0 : 14 * k), k === 0 && e.year ? C.accent2 : C.text, k === 0 && e.year ? 12 : 11, "center", k === 0 && !!e.year));
        ln(c, x, y + (up ? -8 : 8), x, ty + (up ? 8 : -12), C.border, 1);
      }
    });
    if (prog < 1) dot(c, L + W * prog, y, 4, C.accent);
  },
};

// ---------- sustainability ----------
K.greenhouse = {
  title: "Greenhouse energy balance",
  caps: ["1. Sunlight passes through the air and warms the surface.", "2. The warm surface sends heat (infrared) back up.", "3. Greenhouse gases return part of it, warming the planet."],
  draw(c, w, h, t, p, C) {
    const gy = h - 26, bandT = h * 0.34, bandB = h * 0.5, more = p.more ? 1 : 0, alb = p.albedo ?? 0.3, xs = [w * 0.2, w * 0.4, w * 0.6, w * 0.8];
    c.fillStyle = C.panel; c.fillRect(0, gy, w, 26); txt(c, "surface", w / 2, gy + 13, C.dim, 11);
    c.fillStyle = C.accent; c.globalAlpha = 0.14 + 0.1 * more; c.fillRect(0, bandT, w, bandB - bandT); c.globalAlpha = 1;
    txt(c, "greenhouse gases", 64, (bandT + bandB) / 2, C.dim, 10);
    txt(c, "☀ sunlight", w - 44, 12, C.accent2, 11);
    const st = stepOf(t);
    xs.forEach((x, i) => {
      const ph = (t * 0.4 + i * 0.25) % 1;
      const dn = ph * (gy - 14) + 8; // sunlight down
      if (dn < gy) dot(c, x - 10, dn, 3.5, "#f5b301");
      if (i === 0 && alb > 0.5) { if (dn > gy - 30) dot(c, x + 6, gy - (dn - (gy - 30)) * 2, 3, "#f5b301"); }
      if (st >= 1) { const up = 1 - ((t * 0.35 + i * 0.25) % 1); const y = gy - (gy - 8) * (1 - up); if (y > bandB || st === 1) { if (y > 6) dot(c, x + 10, y, 3.5, C.danger); } else if (y < bandT) dot(c, x + 10, y, 3.5, C.danger); }
      if (st >= 2) { const q = (t * 0.45 + i * 0.25) % 1, y = bandB + q * (gy - bandB - 4); dot(c, x + 24, y, 3.5 + more, C.danger); if (more) dot(c, x + 32, bandB + ((q + 0.5) % 1) * (gy - bandB - 4), 3.5, C.danger); }
    });
    if (st >= 2) txt(c, more ? "more gas: more heat comes back" : "some heat comes back down", w / 2, h * 0.68, C.danger, 11, "center", true);
    if (st === 0) txt(c, alb > 0.5 ? "bright ice reflects most sunlight" : "about 70% is absorbed", w / 2, h * 0.68, C.dim, 11);
  },
};

export const ANIM_KINDS = Object.keys(K);

export function animMeta(anim) {
  const k = K[anim && anim.kind]; if (!k) return { title: "", captions: [] };
  const p = (anim && anim.params) || {};
  return { title: p.title || k.title, captions: (p.caps && p.caps.length === 3 ? p.caps : k.caps).slice() };
}

export function drawFrame(ctx, w, h, t, anim, colors) {
  const k = K[anim && anim.kind]; if (!k) return;
  ctx.clearRect(0, 0, w, h);
  k.draw(ctx, w, h, ((t % LOOP) + LOOP) % LOOP, (anim && anim.params) || {}, colors);
}

/**
 * Canvas player. Starts playing unless the user prefers reduced motion (then it
 * shows one static frame and waits for play()). Pauses while off-screen or when
 * the tab is hidden. onStep(i) fires when the caption step changes (0..2);
 * onState(playing) when play/pause changes.
 */
export function createPlayer(canvas, anim, { onStep, onState } = {}) {
  const ctx = canvas.getContext("2d");
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let t = reduced ? STEP * 1.5 + 0.9 : 0, want = !reduced, visible = true, raf = 0, last = 0, lastStep = -1, colors = readColors(canvas), io = null, ro = null, disposed = false;
  const running = () => want && visible && !document.hidden && !disposed;
  function size() {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return [w, h];
  }
  function render() {
    const [w, h] = size(); drawFrame(ctx, w, h, t, anim, colors);
    const s = stepOf(t % LOOP); if (s !== lastStep) { lastStep = s; if (onStep) onStep(s); }
  }
  function frame(now) {
    raf = 0; if (!running()) return;
    t += Math.min(0.1, (now - last) / 1000); last = now; render(); raf = requestAnimationFrame(frame);
  }
  function kick() { if (running() && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  const onVis = () => { if (running()) kick(); };
  document.addEventListener("visibilitychange", onVis);
  if (typeof IntersectionObserver === "function") { io = new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) { colors = readColors(canvas); kick(); } }, { threshold: 0.05 }); io.observe(canvas); }
  if (typeof ResizeObserver === "function") { ro = new ResizeObserver(() => { if (!running()) render(); }); ro.observe(canvas); }
  render(); kick();
  return {
    play() { want = true; if (onState) onState(true); kick(); },
    pause() { want = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } if (onState) onState(false); },
    toggle() { want ? this.pause() : this.play(); },
    isPlaying: () => want,
    seekStep(i) { t = i * STEP + STEP * 0.85; render(); },
    refreshColors() { colors = readColors(canvas); if (!running()) render(); },
    destroy() { disposed = true; if (raf) cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); if (io) io.disconnect(); if (ro) ro.disconnect(); },
  };
}
