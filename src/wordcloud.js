// Word Cloud generator. Pure functions (tokenize/count/layout) have no DOM
// access at module top level so they can be imported and tested under node.

export const STOP_WORDS = new Set(("a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up upon very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves shall may might must also us yet nor thus").split(/\s+/));

export const SAMPLES = {
  "Gettysburg Address (excerpt)": "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal. Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. We are met on a great battle-field of that war. We have come to dedicate a portion of that field, as a final resting place for those who here gave their lives that that nation might live. It is altogether fitting and proper that we should do this. But, in a larger sense, we can not dedicate, we can not consecrate, we can not hallow this ground. The brave men, living and dead, who struggled here, have consecrated it, far above our poor power to add or detract. The world will little note, nor long remember what we say here, but it can never forget what they did here. It is for us the living, rather, to be dedicated here to the unfinished work which they who fought here have thus far so nobly advanced. It is rather for us to be here dedicated to the great task remaining before us, that government of the people, by the people, for the people, shall not perish from the earth.",
  "The Road Not Taken (Frost, 1916)": "Two roads diverged in a yellow wood, And sorry I could not travel both And be one traveler, long I stood And looked down one as far as I could To where it bent in the undergrowth; Then took the other, as just as fair, And having perhaps the better claim, Because it was grassy and wanted wear; Though as for that the passing there Had worn them really about the same, And both that morning equally lay In leaves no step had trodden black. Oh, I kept the first for another day! Yet knowing how way leads on to way, I doubted if I should ever come back. I shall be telling this with a sigh Somewhere ages and ages hence: Two roads diverged in a wood, and I, I took the one less traveled by, And that has made all the difference.",
  "Sonnet 18 (Shakespeare)": "Shall I compare thee to a summer's day? Thou art more lovely and more temperate: Rough winds do shake the darling buds of May, And summer's lease hath all too short a date; Sometime too hot the eye of heaven shines, And often is his gold complexion dimm'd; And every fair from fair sometime declines, By chance or nature's changing course untrimm'd; But thy eternal summer shall not fade, Nor lose possession of that fair thou ow'st; Nor shall death brag thou wander'st in his shade, When in eternal lines to time thou grow'st: So long as men can breathe or eyes can see, So long lives this, and this gives life to thee.",
};

// ---------- Pure helpers ----------

export function tokenize(text, opts = {}) {
  const { lowercase = true, includeNumbers = false } = opts;
  const src = lowercase ? String(text).toLowerCase() : String(text);
  // Letters (any script) with inner apostrophes; numbers optional.
  const re = includeNumbers
    ? /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu
    : /\p{L}+(?:['’]\p{L}+)*/gu;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[0].replace(/’/g, "'"));
  return out;
}

export function parseStopList(str) {
  return new Set(String(str || "").toLowerCase().split(/[\s,;]+/).map((s) => s.replace(/’/g, "'")).filter(Boolean));
}

// Returns [{word, count}] sorted by count desc then word asc.
export function countWords(text, opts = {}) {
  const { useStop = true, extraStop = new Set(), minLength = 3, minFreq = 1, lowercase = true } = opts;
  const tokens = tokenize(text, opts);
  const map = new Map();
  for (const t of tokens) {
    const key = lowercase ? t : t;
    const lk = key.toLowerCase();
    if (t.length < minLength) continue;
    if (extraStop.has(lk)) continue;
    if (useStop && STOP_WORDS.has(lk)) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  const arr = [];
  for (const [word, count] of map) if (count >= minFreq) arr.push({ word, count });
  arr.sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  return arr;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fontSizeFor(count, minC, maxC, minPx, maxPx, scale) {
  if (maxC <= minC) return (minPx + maxPx) / 2;
  const f = (c) => scale === "log" ? Math.log(c) : scale === "sqrt" ? Math.sqrt(c) : c;
  const lo = f(minC), hi = f(maxC);
  const t = hi === lo ? 0.5 : (f(count) - lo) / (hi - lo);
  return minPx + Math.max(0, Math.min(1, t)) * (maxPx - minPx);
}

// measure(word, fontSize) -> width in px. Returns placed items:
// {word,count,size,x,y (center),w,h (bounding box, after rotation),rot (0|90)}
export function layoutWords(words, width, height, opts = {}) {
  const { seed = 1, measure, minFont = 12, maxFont = 64, scale = "sqrt", orientation = "mostly", spiral = "archimedean" } = opts;
  const rand = mulberry32(seed);
  const CELL = 4;
  const gw = Math.ceil(width / CELL), gh = Math.ceil(height / CELL);
  const grid = new Uint8Array(gw * gh);
  const counts = words.map((w) => w.count);
  const minC = Math.min(...counts), maxC = Math.max(...counts);
  const placed = [];
  const free = (x0, y0, x1, y1) => {
    if (x0 < 0 || y0 < 0 || x1 > width || y1 > height) return false;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.ceil(x1 / CELL), cy0 = Math.floor(y0 / CELL), cy1 = Math.ceil(y1 / CELL);
    for (let cy = cy0; cy < cy1; cy++) {
      const row = cy * gw;
      for (let cx = cx0; cx < cx1; cx++) if (grid[row + cx]) return false;
    }
    return true;
  };
  const mark = (x0, y0, x1, y1) => {
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.ceil(x1 / CELL), cy0 = Math.floor(y0 / CELL), cy1 = Math.ceil(y1 / CELL);
    for (let cy = cy0; cy < cy1; cy++) for (let cx = cx0; cx < cx1; cx++) grid[cy * gw + cx] = 1;
  };
  const pad = 2;
  const maxR = Math.hypot(width, height) / 2;
  for (const w of words) {
    let size = fontSizeFor(w.count, minC, maxC, minFont, maxFont, scale);
    const rot = orientation === "horizontal" ? 0
      : orientation === "mostly" ? (rand() < 0.2 ? 90 : 0)
      : (rand() < 0.5 ? 90 : 0);
    const startAngle = rand() * Math.PI * 2;
    let done = false;
    for (let attempt = 0; attempt < 6 && !done; attempt++) {
      const tw = measure(w.word, size) + pad * 2, th = size * 1.15 + pad * 2;
      const bw = rot ? th : tw, bh = rot ? tw : th;
      if (bw > width || bh > height) { size *= 0.85; continue; }
      let t = 0;
      const step = spiral === "rectangular" ? 1 : 0.15;
      for (let i = 0; i < 6000; i++, t += step) {
        let dx, dy;
        if (spiral === "rectangular") {
          // square spiral: ring k, walk perimeter
          const k = Math.floor(Math.sqrt(t) / 2) + 1, p = t - 4 * (k - 1) * (k - 1);
          const side = Math.floor(p / (2 * k)) % 4, off = (p % (2 * k)) - k;
          const r = k * 3.2;
          [dx, dy] = side === 0 ? [off * 3.2, -r] : side === 1 ? [r, off * 3.2] : side === 2 ? [-off * 3.2, r] : [-r, -off * 3.2];
          dx *= 1.4;
        } else {
          const r = 1.6 * t;
          dx = r * Math.cos(t + startAngle) * 1.35; dy = r * Math.sin(t + startAngle);
        }
        const cx = width / 2 + dx, cy = height / 2 + dy;
        if (Math.hypot(dx, dy) > maxR * 1.6) break;
        const x0 = cx - bw / 2, y0 = cy - bh / 2;
        if (free(x0, y0, x0 + bw, y0 + bh)) {
          mark(x0, y0, x0 + bw, y0 + bh);
          placed.push({ word: w.word, count: w.count, size, x: cx, y: cy, w: bw, h: bh, rot });
          done = true; break;
        }
      }
      if (!done) size *= 0.85;
      if (size < 6) break;
    }
  }
  return placed;
}

export const PALETTES = {
  vibrant: { label: "Vibrant", colors: ["#4f8cff", "#ff5c7a", "#2ecc71", "#ffb84f", "#a78bfa", "#34d399", "#f97316"] },
  cool: { label: "Cool", colors: ["#1d4ed8", "#0891b2", "#0d9488", "#6366f1", "#0ea5e9", "#7c3aed"] },
  warm: { label: "Warm", colors: ["#dc2626", "#ea580c", "#d97706", "#be185d", "#b45309", "#e11d48"] },
  okabe: { label: "Colorblind-safe (Okabe-Ito)", colors: ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442"] },
  mono: { label: "Monochrome", colors: null },
};

export function pickColor(paletteId, index, dark) {
  const p = PALETTES[paletteId] || PALETTES.vibrant;
  if (!p.colors) return dark ? ["#ffffff", "#e5e7eb", "#d1d5db", "#b8bec8"][index % 4] : ["#111111", "#2b2b2b", "#444444", "#5c5c5c"][index % 4];
  return p.colors[index % p.colors.length];
}

// ---------- UI ----------

const FONTS = {
  "Sans-serif": "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  "Serif": "Georgia, 'Times New Roman', serif",
  "Monospace": "ui-monospace, Menlo, Consolas, monospace",
  "Impact": "Impact, 'Arial Black', sans-serif",
  "Cursive": "'Comic Sans MS', 'Brush Script MT', cursive",
};
const MAX_CHARS_TOKENIZED = 5_000_000;

function injectStyles() {
  if (document.getElementById("wordcloud-styles")) return;
  const s = document.createElement("style");
  s.id = "wordcloud-styles";
  s.textContent = `
.wc-root{display:flex;flex-wrap:wrap;align-content:flex-start;gap:12px;width:100%;height:100%;box-sizing:border-box;padding:12px;color:var(--text);overflow:auto}
.wc-left{flex:1 1 260px;max-width:340px;display:flex;flex-direction:column;gap:8px;min-width:0}
.wc-main{flex:3 1 340px;min-width:0;display:flex;flex-direction:column;gap:8px}
.wc-right{flex:1 1 200px;max-width:260px;min-width:0}
.wc-root textarea,.wc-root select,.wc-root input[type=text]{width:100%;box-sizing:border-box;background:var(--panel-alt);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px;font:inherit;font-size:12px}
.wc-root textarea{min-height:130px;resize:vertical}
.wc-row{display:flex;align-items:center;gap:6px;font-size:12px;flex-wrap:wrap}
.wc-row label{color:var(--text-dim);display:flex;align-items:center;gap:6px;flex:1 1 100%}
.wc-row input[type=range]{flex:1;min-width:60px}
.wc-val{min-width:28px;text-align:right;color:var(--text)}
.wc-root button{cursor:pointer;font-size:12px}
.wc-stage{position:relative;flex:1;min-height:260px;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.wc-stage canvas{display:block}
.wc-tip{position:fixed;pointer-events:none;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:12px;z-index:10000;display:none}
.wc-status{font-size:12px;color:var(--text-dim)}
.wc-stale{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
.wc-status.wc-err{color:var(--danger)}
.wc-tbl{width:100%;font-size:12px;border-collapse:collapse}
.wc-tbl td{padding:2px 4px;border-bottom:1px solid var(--border)}
.wc-bar{height:6px;border-radius:3px;background:var(--cool-2,var(--accent))}
.wc-h{font-size:12px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.04em}
@media(max-width:900px){.wc-root{flex-direction:column}.wc-left,.wc-right{flex:none}}
`;
  document.head.appendChild(s);
}

const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

export class WordCloudTool {
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx;
    this.s = { text: SAMPLES["Gettysburg Address (excerpt)"], lower: true, useStop: true, extraStop: "", minLen: 3, maxWords: 100, minFreq: 1, nums: false,
      scale: "sqrt", minFont: 12, maxFont: 72, font: "Sans-serif", orient: "mostly", palette: "vibrant", bg: "auto", size: "fit", seed: 1, spiral: "archimedean" };
    this.placed = []; this.freq = [];
    this._listeners = []; this._timers = [];
    this._built = false;
  }

  _on(target, ev, fn, opt) { target.addEventListener(ev, fn, opt); this._listeners.push([target, ev, fn, opt]); }

  mount() {
    injectStyles();
    if (!this._built) { this._build(); this._built = true; }
    this._on(window, "resize", () => this._schedule());
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this._schedule());
      this._ro.observe(this.stage);
    }
    this._schedule(0);
  }

  unmount() {
    for (const [t, e, f, o] of this._listeners) t.removeEventListener(e, f, o);
    this._listeners = [];
    for (const id of this._timers) clearTimeout(id);
    this._timers = [];
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    // The controls' own listeners were registered through _on() too, so
    // they were just removed above — mark the panel unbuilt so the next
    // mount() rebuilds it (settings live in this.s and are kept).
    if (this.tip) { this.tip.remove(); this.tip = null; }
    this._built = false;
  }

  // Settings no longer redraw on every tweak — change as many as you like,
  // then press Generate. (Resizing the window still redraws what you have.)
  _dirty() {
    this._stale = true;
    if (this.genBtn) this.genBtn.classList.add("wc-stale");
    if (this.status) { this.status.textContent = "Settings changed — press Generate to rebuild the cloud."; this.status.classList.remove("wc-err"); }
  }

  _schedule(delay = 120) {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.render(), delay);
    this._timers.push(this._t);
  }

  _ctl(parent, label, el, valFn) {
    const row = mk("div", "wc-row");
    const l = mk("label", null, label);
    l.appendChild(el);
    if (valFn) { const v = mk("span", "wc-val", valFn()); l.appendChild(v); el.addEventListener("input", () => { v.textContent = valFn(); }); }
    row.appendChild(l); parent.appendChild(row);
    return el;
  }
  _range(parent, label, key, min, max, step = 1) {
    const el = document.createElement("input");
    el.type = "range"; el.min = min; el.max = max; el.step = step; el.value = this.s[key];
    this._ctl(parent, label, el, () => el.value);
    this._on(el, "input", () => { this.s[key] = +el.value; if (key === "minFont" && this.s.minFont > this.s.maxFont) this.s.maxFont = this.s.minFont; this._dirty(); });
    return el;
  }
  _select(parent, label, key, opts) {
    const el = document.createElement("select");
    for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; el.appendChild(o); }
    el.value = this.s[key];
    this._ctl(parent, label, el);
    this._on(el, "change", () => { this.s[key] = el.value; this._dirty(); });
  }
  _check(parent, label, key) {
    const el = document.createElement("input"); el.type = "checkbox"; el.checked = this.s[key];
    const row = mk("div", "wc-row"); const l = mk("label", null, label); l.style.flexDirection = "row-reverse"; l.style.justifyContent = "flex-end";
    l.appendChild(el); row.appendChild(l); parent.appendChild(row);
    this._on(el, "change", () => { this.s[key] = el.checked; this._dirty(); });
  }

  _build() {
    const r = this.root;
    r.innerHTML = ""; r.classList.add("wc-root");
    const left = mk("div", "wc-left"), main = mk("div", "wc-main"), right = mk("div", "wc-right");
    left.appendChild(mk("div", "wc-h", "Text"));
    this.ta = document.createElement("textarea");
    this.ta.placeholder = "Paste or type text here...";
    this.ta.value = this.s.text;
    left.appendChild(this.ta);
    this._on(this.ta, "input", () => { this.s.text = this.ta.value; this._dirty(); });

    const srow = mk("div", "wc-row");
    const sample = document.createElement("select");
    const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Load a sample..."; sample.appendChild(o0);
    for (const k of Object.keys(SAMPLES)) { const o = document.createElement("option"); o.value = k; o.textContent = k; sample.appendChild(o); }
    srow.appendChild(sample); left.appendChild(srow);
    this._on(sample, "change", () => { if (sample.value) { this.ta.value = this.s.text = SAMPLES[sample.value]; sample.value = ""; this._dirty(); } });

    const file = document.createElement("input"); file.type = "file"; file.accept = ".txt,text/plain";
    left.appendChild(file);
    this._on(file, "change", () => {
      const f = file.files && file.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { this.ta.value = this.s.text = String(rd.result || ""); this._dirty(); };
      rd.onerror = () => this._status("Could not read that file.", true);
      rd.readAsText(f);
    });

    left.appendChild(mk("div", "wc-h", "Words"));
    this._check(left, "Lowercase", "lower");
    this._check(left, "Remove common English stop words", "useStop");
    this._check(left, "Include numbers", "nums");
    this.extra = document.createElement("input"); this.extra.type = "text"; this.extra.placeholder = "extra stop words (comma or space separated)";
    this.extra.value = this.s.extraStop; left.appendChild(this.extra);
    this._on(this.extra, "input", () => { this.s.extraStop = this.extra.value; this._dirty(); });
    this._range(left, "Min word length", "minLen", 1, 12);
    this._range(left, "Max words", "maxWords", 10, 300);
    this._range(left, "Min frequency", "minFreq", 1, 20);

    // main
    const bar = mk("div", "wc-row");
    this.genBtn = mk("button", "primary", "Generate");
    this._on(this.genBtn, "click", () => this.render());
    const shuffle = mk("button", null, "Shuffle"); const png = mk("button", null, "Download PNG"); const copy = mk("button", null, "Copy Frequencies");
    bar.append(this.genBtn, shuffle, png, copy); main.appendChild(bar);
    this._on(shuffle, "click", () => { this.s.seed = (this.s.seed * 1664525 + 1013904223) >>> 0; this.render(); });
    this._on(png, "click", () => this._download());
    this._on(copy, "click", () => this._copy());
    this.status = mk("div", "wc-status"); main.appendChild(this.status);
    this.stage = mk("div", "wc-stage"); this.canvas = document.createElement("canvas"); this.stage.appendChild(this.canvas);
    main.appendChild(this.stage);
    this.tip = mk("div", "wc-tip"); document.body.appendChild(this.tip);
    this._on(this.canvas, "mousemove", (e) => this._hover(e));
    this._on(this.canvas, "mouseleave", () => { this.tip.style.display = "none"; });
    this._on(this.canvas, "click", (e) => this._click(e));

    const opts = mk("div", "wc-left"); opts.style.flex = "none";
    opts.appendChild(mk("div", "wc-h", "Appearance"));
    this._select(opts, "Size scale", "scale", [["linear", "Linear"], ["sqrt", "Square root"], ["log", "Logarithmic"]]);
    this._range(opts, "Min font", "minFont", 8, 40);
    this._range(opts, "Max font", "maxFont", 30, 160);
    this._select(opts, "Font", "font", Object.keys(FONTS).map((k) => [k, k]));
    this._select(opts, "Orientation", "orient", [["horizontal", "All horizontal"], ["mostly", "Mostly horizontal"], ["mixed", "Mixed 90 degrees"]]);
    this._select(opts, "Placement", "spiral", [["archimedean", "Spiral"], ["rectangular", "Rectangular"]]);
    this._select(opts, "Palette", "palette", Object.entries(PALETTES).map(([k, p]) => [k, p.label]));
    this._select(opts, "Background", "bg", [["auto", "Match theme"], ["light", "Light"], ["dark", "Dark"], ["transparent", "Transparent"]]);
    this._select(opts, "Canvas size", "size", [["fit", "Fit to panel"], ["square", "Square"], ["wide", "16:9"]]);
    main.appendChild(opts);

    right.appendChild(mk("div", "wc-h", "Top 20 words"));
    this.tbl = document.createElement("table"); this.tbl.className = "wc-tbl"; right.appendChild(this.tbl);
    r.append(left, main, right);
  }

  _status(msg, err) { this.status.textContent = msg; this.status.classList.toggle("wc-err", !!err); }

  _isDark() {
    if (this.s.bg === "dark") return true;
    if (this.s.bg === "light" || this.s.bg === "transparent") return false;
    const th = document.documentElement.getAttribute("data-theme");
    return th ? th === "dark" : !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }

  render() {
    if (!this.canvas) return;
    this._stale = false; this.genBtn?.classList.remove("wc-stale");
    const s = this.s;
    let text = s.text || "";
    let note = "";
    if (text.length > MAX_CHARS_TOKENIZED) { text = text.slice(0, MAX_CHARS_TOKENIZED); note = " (input truncated to 5M characters)"; }
    const all = countWords(text, { lowercase: s.lower, includeNumbers: s.nums, useStop: s.useStop, extraStop: parseStopList(s.extraStop), minLength: s.minLen, minFreq: s.minFreq });
    this.freq = all;
    this._table(all);
    const words = all.slice(0, s.maxWords);
    // canvas size
    const sw = Math.max(200, this.stage.clientWidth), sh = Math.max(200, this.stage.clientHeight);
    let W = sw, H = sh;
    if (s.size === "square") { W = H = Math.min(sw, sh); }
    else if (s.size === "wide") { W = sw; H = Math.round(sw * 9 / 16); if (H > sh) { H = sh; W = Math.round(sh * 16 / 9); } }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = W + "px"; this.canvas.style.height = H + "px";
    const g = this.canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paint(g, W, H, words);
    this._status(words.length ? `${all.length} unique words, showing ${this.placed.length} of ${words.length} requested${this._fontScale < 0.99 ? " (text auto-shrunk to fit them all)" : ""}${note}` : "No words to show. Add some text or loosen the filters.", !words.length && false);
  }

  _paint(g, W, H, words) {
    const s = this.s, dark = this._isDark();
    g.clearRect(0, 0, W, H);
    if (s.bg !== "transparent") { g.fillStyle = dark ? "#16181d" : "#ffffff"; g.fillRect(0, 0, W, H); }
    this.placed = [];
    if (!words.length) {
      g.fillStyle = dark ? "#9aa1af" : "#6b7280"; g.font = "14px " + FONTS["Sans-serif"]; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("Nothing to draw yet", W / 2, H / 2); return;
    }
    const fam = FONTS[s.font] || FONTS["Sans-serif"];
    const weight = s.font === "Impact" ? "" : "600 ";
    const cache = new Map();
    const measure = (word, size) => { g.font = `${weight}${size}px ${fam}`; return g.measureText(word).width; };
    void cache;
    // Words that don't fit are dropped by the layout, so shrink every font a
    // little and retry until every requested word is placed (or text gets unreadably small).
    let k = 1;
    for (let attempt = 0; attempt < 14; attempt++) {
      const minF = Math.max(5, s.minFont * k), maxF = Math.max(minF, s.maxFont * k);
      this.placed = layoutWords(words, W, H, { seed: s.seed, measure, minFont: minF, maxFont: maxF, scale: s.scale, orientation: s.orient, spiral: s.spiral });
      if (this.placed.length >= words.length || minF <= 5) break;
      k *= 0.85;
    }
    this._fontScale = k;
    g.textAlign = "center"; g.textBaseline = "middle";
    this.placed.forEach((p, i) => {
      g.save(); g.translate(p.x, p.y); if (p.rot) g.rotate(-Math.PI / 2);
      g.font = `${weight}${p.size}px ${fam}`;
      g.fillStyle = pickColor(s.palette, s.palette === "mono" ? Math.min(3, Math.floor(i / 8)) : i, dark);
      g.fillText(p.word, 0, 0); g.restore();
    });
  }

  _table(all) {
    this.tbl.innerHTML = "";
    const top = all.slice(0, 20), max = top.length ? top[0].count : 1;
    for (const t of top) {
      const tr = document.createElement("tr");
      const a = mk("td", null, t.word), b = mk("td", null, String(t.count)); b.style.textAlign = "right";
      const c = mk("td"); c.style.width = "40%"; const bar = mk("div", "wc-bar"); bar.style.width = Math.max(4, (t.count / max) * 100) + "%"; c.appendChild(bar);
      tr.append(a, b, c); this.tbl.appendChild(tr);
    }
    if (!top.length) { const tr = document.createElement("tr"); tr.appendChild(mk("td", null, "No words")); this.tbl.appendChild(tr); }
  }

  _hit(e) {
    const rc = this.canvas.getBoundingClientRect();
    const x = e.clientX - rc.left, y = e.clientY - rc.top;
    for (const p of this.placed) if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2) return p;
    return null;
  }
  _hover(e) {
    const p = this._hit(e);
    this.canvas.style.cursor = p ? "pointer" : "default";
    if (!p) { this.tip.style.display = "none"; return; }
    this.tip.textContent = `${p.word}: ${p.count} (click to exclude)`;
    this.tip.style.display = "block"; this.tip.style.left = e.clientX + 12 + "px"; this.tip.style.top = e.clientY + 12 + "px";
  }
  _click(e) {
    const p = this._hit(e); if (!p) return;
    const set = parseStopList(this.s.extraStop); set.add(p.word.toLowerCase());
    this.s.extraStop = [...set].join(", "); this.extra.value = this.s.extraStop;
    this.tip.style.display = "none";
    this.render();
  }

  _download() {
    this.canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "wordcloud.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }

  async _copy() {
    const txt = this.freq.slice(0, this.s.maxWords).map((t) => `${t.word}\t${t.count}`).join("\n");
    try { await navigator.clipboard.writeText(txt); this._status("Frequency table copied."); }
    catch { this._status("Clipboard unavailable in this browser context.", true); }
  }
}
