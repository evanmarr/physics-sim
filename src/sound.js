// Real audio, not a canned waveform image: a live AnalyserNode drives the
// waveform canvas straight from your microphone or from an oscillator this
// mode builds itself — same Web Audio API a DAW uses under the hood.
import { openModelInfo } from "./modelInfo.js";

const SUB_MODES = [
  { id: "record", label: "Record & Visualize" },
  { id: "make", label: "Make Your Own Sound" },
];
const MAX_RECORD_MS = 10000;
const SAMPLE_INTERVAL_MS = 40; // ~25 samples/sec of amplitude history — plenty dense for a 10s strip

// A real equal-tempered piano keyboard for the tile-assignment UI — same
// A4=440 formula as noteNameFor below, just run in reverse (semitone
// offset from C4 -> frequency). Three full octaves (C3-C6) gives a real
// "wider selection" to assign tiles from — generated rather than hardcoded
// per-note so widening/narrowing the range later is a one-line change.
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PIANO_LOW_OCTAVE = 3, PIANO_HIGH_OCTAVE = 6; // inclusive C3..C6
const PIANO_KEYS = [];
for (let octave = PIANO_LOW_OCTAVE; octave <= PIANO_HIGH_OCTAVE; octave++) {
  for (let i = 0; i < 12; i++) {
    if (octave === PIANO_HIGH_OCTAVE && i > 0) break; // stop at C6, not B6
    PIANO_KEYS.push({ name: `${NOTE_NAMES[i]}${octave}`, semis: (octave - 4) * 12 + i, black: NOTE_NAMES[i].includes("#") });
  }
}
const freqForSemis = (semis) => 440 * Math.pow(2, (semis - 9) / 12);
// The default Tile Pad layout stays the same familiar one-octave C4..D5
// diatonic scale even though the piano itself now spans much wider — nine
// tiles, nine white keys, easy to reason about before anyone reassigns one.
const DEFAULT_TILE_KEYS = PIANO_KEYS.filter((k) => !k.black && k.semis >= 0 && k.semis <= 14);

const RECORD_MODEL_INFO = {
  title: "Record & Visualize",
  concept: "The waveform you see is drawn live from a real AnalyserNode reading either your actual microphone input or an oscillator this mode builds itself — the same Web Audio API a DAW uses, not a decorative animation standing in for sound.",
  variables: [{ symbol: "amplitude", meaning: "the raw waveform sample value at each instant, read via getByteTimeDomainData" }],
  assumptions: ["The recorded strip samples amplitude roughly 25 times/second — dense enough to show real shape over a 10-second window without keeping every raw audio sample in memory."],
  limitations: ["No frequency-domain (spectrum) view — only the time-domain waveform shape is shown, not which frequencies make it up."],
  sources: ["Web Audio API — AnalyserNode, MediaStream microphone input"],
};
const MAKE_MODEL_INFO = {
  title: "Make Your Own Sound",
  concept: "A real OscillatorNode generates every tone here live. Waveform shape is the actual signal driving the speaker, not a picture of one: a sine wave really is a single pure frequency, while square/sawtooth/triangle are genuinely mixtures of many harmonic frequencies layered together — which is the real reason they sound \"buzzier\" than a sine at the same pitch. The Tile Pad's frequencies use the same real equal-tempered formula as the frequency slider's note readout.",
  equation: "f(n) = 440 · 2^(n/12)   (equal temperament: frequency of the note n semitones from A4)",
  variables: [{ symbol: "n", meaning: "semitone distance from A4 (440 Hz) — negative below A4, positive above" }],
  constants: [{ name: "A4 reference pitch", value: 440, unit: "Hz" }],
  assumptions: ["12-tone equal temperament (the standard modern tuning) — each semitone is exactly the 12th root of 2 apart in frequency, not a just-intonation ratio."],
  limitations: ["Tile Pad notes use a short fixed attack/decay envelope (~0.5s) rather than sustaining for as long as a key is held, since it's built for quick repeated taps rather than a held-note instrument."],
  sources: ["Web Audio API — OscillatorNode, GainNode envelopes", "12-tone equal temperament (standard Western musical tuning)"],
};

function div(cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  return el;
}

export class SoundMode {
  constructor(root) {
    this.root = root;
    this.sub = "record";
    this._build();
  }

  mount() { this._renderSub(); }
  unmount() { this._teardown(); }

  _teardown() {
    this._rafId && cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._sampleIntervalId && clearInterval(this._sampleIntervalId);
    this._sampleIntervalId = null;
    this._countdownId && clearInterval(this._countdownId);
    this._countdownId = null;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    this._oscillator?.stop();
    this._oscillator = null;
    this._audioCtx?.close().catch(() => {});
    this._audioCtx = null;
    this._playbackAudioCtx?.close().catch(() => {});
    this._playbackAudioCtx = null;
    this._mediaRecorder = null;
    this._redrawStaticBars = null;
    if (this._tileKeydownHandler) {
      window.removeEventListener("keydown", this._tileKeydownHandler);
      this._tileKeydownHandler = null;
    }
    this._tileOscillators?.forEach((o) => { try { o.stop(); } catch {} });
    this._tileOscillators = null;
  }

  _build() {
    this.root.innerHTML = "";
    this.root.className = "econ-root";

    const title = document.createElement("h1");
    title.className = "econ-title";
    title.textContent = "Sound";
    this.root.appendChild(title);

    const tabs = div("econ-tabs");
    for (const m of SUB_MODES) {
      const btn = document.createElement("button");
      btn.className = "econ-tab" + (m.id === this.sub ? " active" : "");
      btn.textContent = m.label;
      btn.addEventListener("click", () => { this._teardown(); this.sub = m.id; this._renderSub(); });
      tabs.appendChild(btn);
    }
    const infoBtn = document.createElement("button");
    infoBtn.textContent = "ℹ️ How This Model Works";
    infoBtn.title = "What this simulation actually models";
    infoBtn.style.marginLeft = "8px";
    infoBtn.addEventListener("click", () => openModelInfo(this.sub === "record" ? RECORD_MODEL_INFO : MAKE_MODEL_INFO));
    tabs.appendChild(infoBtn);
    this.root.appendChild(tabs);

    this.body = div("econ-body");
    this.root.appendChild(this.body);
    this._renderSub();
  }

  _renderSub() {
    this.body.innerHTML = "";
    if (this.sub === "record") this._renderRecord();
    else this._renderMake();
  }

  _makeCanvas() {
    const wrap = div("sound-canvas-wrap");
    const canvas = document.createElement("canvas");
    canvas.className = "sound-canvas";
    canvas.width = 900; canvas.height = 220;
    wrap.appendChild(canvas);
    return { wrap, canvas };
  }

  // Live oscilloscope view — used for the microphone's real-time trace and
  // for the oscillator in "Make Your Own Sound". Redraws every frame from
  // whatever's actually flowing through the AnalyserNode right now.
  _drawLiveWaveform(canvas, analyser) {
    const ctx = canvas.getContext("2d");
    const data = new Uint8Array(analyser.fftSize);
    const draw = () => {
      this._rafId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#4f8cff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const slice = canvas.width / data.length;
      for (let i = 0; i < data.length; i++) {
        const y = (data[i] / 255) * canvas.height;
        const x = i * slice;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw();
  }

  // Draws the recorded amplitude history as bars growing left-to-right —
  // this is what makes recording feel like a real recorder instead of just
  // a looping oscilloscope: it's a genuine history of the last 10 seconds,
  // not a live-only snapshot.
  _drawRecordingBars(canvas, samples, elapsedMs) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#4f8cff";
    ctx.fillStyle = accent;
    const totalBars = Math.round(MAX_RECORD_MS / SAMPLE_INTERVAL_MS);
    const barWidth = canvas.width / totalBars;
    const midY = canvas.height / 2;
    samples.forEach((s, i) => {
      const h = Math.max(2, s * canvas.height * 0.9);
      ctx.fillRect(i * barWidth, midY - h / 2, Math.max(1, barWidth - 1), h);
    });
    // A thin marker at the current recording position, past the drawn bars.
    const x = (elapsedMs / MAX_RECORD_MS) * canvas.width;
    ctx.fillStyle = "#f87171";
    ctx.fillRect(x, 0, 1.5, canvas.height);
  }

  // The recorded bar chart, with the trimmed-out region visibly dimmed
  // (so trim actually shows a change, not just numbers moving), plus a
  // sweeping playhead synced to real audio.currentTime. While the clip is
  // actually playing, a live AnalyserNode on the audio element itself
  // drives the same oscilloscope trace the microphone uses — real motion
  // in sync with what's audibly playing, not just a static shape.
  _drawPlayback(canvas, samples, audio, getTrim) {
    const ctx = canvas.getContext("2d");
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#4f8cff";
    const totalBars = Math.round(MAX_RECORD_MS / SAMPLE_INTERVAL_MS);
    const barWidth = canvas.width / totalBars;
    const midY = canvas.height / 2;

    const drawBars = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { start, end } = getTrim();
      samples.forEach((s, i) => {
        const t = (i * SAMPLE_INTERVAL_MS) / 1000;
        const inTrim = t >= start && t <= end;
        ctx.fillStyle = inTrim ? accent : "rgba(148,163,184,0.35)"; // dimmed outside the trimmed range
        const h = Math.max(2, s * canvas.height * 0.9);
        ctx.fillRect(i * barWidth, midY - h / 2, Math.max(1, barWidth - 1), h);
      });
      if (audio.duration > 0) {
        const x = (audio.currentTime / audio.duration) * canvas.width;
        ctx.strokeStyle = "#f87171";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
    };

    let liveAnalyser = null;
    try {
      this._playbackAudioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const src = this._playbackAudioCtx.createMediaElementSource(audio);
      liveAnalyser = this._playbackAudioCtx.createAnalyser();
      liveAnalyser.fftSize = 2048;
      src.connect(liveAnalyser);
      liveAnalyser.connect(this._playbackAudioCtx.destination);
    } catch {
      // createMediaElementSource can only be attached once per element —
      // harmless if this ever re-runs on the same <audio>, just skip the
      // live trace and keep the static bars/playhead working.
    }
    const liveData = liveAnalyser ? new Uint8Array(liveAnalyser.fftSize) : null;

    const tick = () => {
      if (liveAnalyser && !audio.paused) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        liveAnalyser.getByteTimeDomainData(liveData);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        const slice = canvas.width / liveData.length;
        for (let i = 0; i < liveData.length; i++) {
          const y = (liveData[i] / 255) * canvas.height;
          i === 0 ? ctx.moveTo(i * slice, y) : ctx.lineTo(i * slice, y);
        }
        ctx.stroke();
      } else {
        drawBars();
      }
      this._rafId = requestAnimationFrame(tick);
    };
    drawBars();
    tick();
    this._redrawStaticBars = drawBars;
  }

  // ---------- Record & Visualize ----------
  _renderRecord() {
    const wrap = div("sound-wrap");
    const intro = document.createElement("p");
    intro.className = "econ-intro";
    intro.textContent = "This draws your actual microphone input — a growing bar for every ~40ms of real amplitude while you record (up to 10 seconds). Play it back and you'll see the same kind of live waveform motion as recording, driven by the actual audio playing, not a static picture — pause it and you're back to the full recorded shape with a playhead and the trimmed-out region dimmed. Speeding playback up raises its pitch and slowing it down lowers it, the same physical relationship a tape or vinyl record speeding up or slowing down has, because both pitch and duration come from the same underlying sample rate.";
    wrap.appendChild(intro);

    const startBtn = document.createElement("button");
    startBtn.className = "cyber-sim-btn primary";
    startBtn.textContent = "Start microphone";
    wrap.appendChild(startBtn);

    const status = div("sound-status");
    wrap.appendChild(status);

    const { wrap: canvasWrap, canvas } = this._makeCanvas();
    wrap.appendChild(canvasWrap);

    const recordRow = div("sound-record-row");
    const recordBtn = document.createElement("button");
    recordBtn.className = "cyber-sim-btn";
    recordBtn.textContent = "● Record clip (10s max)";
    recordBtn.disabled = true;
    recordRow.appendChild(recordBtn);
    const timerEl = document.createElement("span");
    timerEl.className = "sound-timer";
    recordRow.appendChild(timerEl);
    wrap.appendChild(recordRow);

    const playbackWrap = div("sound-playback-wrap");
    wrap.appendChild(playbackWrap);

    startBtn.addEventListener("click", async () => {
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        status.textContent = "Microphone access was blocked or unavailable — check your browser's site permissions.";
        return;
      }
      status.textContent = "Listening — try talking, humming, or tapping the mic.";
      startBtn.disabled = true;
      recordBtn.disabled = false;

      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this._audioCtx.createMediaStreamSource(this._stream);
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      this._drawLiveWaveform(canvas, analyser);

      let chunks = [];
      let samples = [];
      let recordStart = 0;
      const sampleBuf = new Uint8Array(analyser.fftSize);

      this._mediaRecorder = new MediaRecorder(this._stream);
      this._mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      this._mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        chunks = [];
        this._rafId && cancelAnimationFrame(this._rafId);
        this._sampleIntervalId && clearInterval(this._sampleIntervalId);
        this._countdownId && clearInterval(this._countdownId);
        recordBtn.classList.remove("recording");
        recordBtn.textContent = "● Record clip (10s max)";
        timerEl.textContent = "";
        this._showPlayback(playbackWrap, blob, samples);
      };

      const startRecording = () => {
        samples = [];
        recordStart = performance.now();
        chunks = [];
        this._mediaRecorder.start();
        recordBtn.classList.add("recording");
        recordBtn.textContent = "■ Stop recording";

        this._rafId && cancelAnimationFrame(this._rafId);
        this._sampleIntervalId = setInterval(() => {
          analyser.getByteTimeDomainData(sampleBuf);
          let peak = 0;
          for (let i = 0; i < sampleBuf.length; i++) peak = Math.max(peak, Math.abs(sampleBuf[i] - 128) / 128);
          samples.push(peak);
          this._drawRecordingBars(canvas, samples, performance.now() - recordStart);
        }, SAMPLE_INTERVAL_MS);

        const tickCountdown = () => {
          const remaining = Math.max(0, MAX_RECORD_MS - (performance.now() - recordStart));
          timerEl.textContent = `${(remaining / 1000).toFixed(1)}s left`;
          if (remaining <= 0) this._mediaRecorder.stop();
        };
        tickCountdown();
        this._countdownId = setInterval(tickCountdown, 100);
        // A hard stop at exactly 10s regardless of the countdown's own polling.
        setTimeout(() => { if (this._mediaRecorder.state === "recording") this._mediaRecorder.stop(); }, MAX_RECORD_MS);
      };

      recordBtn.addEventListener("click", () => {
        if (recordBtn.classList.contains("recording")) this._mediaRecorder.stop();
        else { this._drawLiveWaveform(canvas, analyser); startRecording(); }
      });
    });

    this.body.appendChild(wrap);
  }

  _showPlayback(container, blob, samples) {
    container.innerHTML = "";
    const url = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = url;
    container.appendChild(audio);

    const { wrap: canvasWrap, canvas } = this._makeCanvas();
    container.appendChild(canvasWrap);

    // Volume — a plain gain-style control on the <audio> element itself.
    const volRow = div("sound-rate-row");
    const volLabel = document.createElement("label");
    const volVal = document.createElement("span");
    volVal.textContent = "100%";
    volLabel.append("Volume: ", volVal);
    volRow.appendChild(volLabel);
    const volSlider = document.createElement("input");
    volSlider.type = "range"; volSlider.min = "0"; volSlider.max = "1"; volSlider.step = "0.05"; volSlider.value = "1";
    volSlider.addEventListener("input", () => {
      audio.volume = Number(volSlider.value);
      volVal.textContent = `${Math.round(Number(volSlider.value) * 100)}%`;
    });
    volRow.appendChild(volSlider);
    container.appendChild(volRow);

    // Speed/pitch — unchanged from before, just relocated under the new controls.
    const rateRow = div("sound-rate-row");
    const label = document.createElement("label");
    const valSpan = document.createElement("span");
    valSpan.textContent = "1.00×";
    label.append("Speed / pitch: ", valSpan);
    rateRow.appendChild(label);
    const rate = document.createElement("input");
    rate.type = "range"; rate.min = "0.5"; rate.max = "2"; rate.step = "0.05"; rate.value = "1";
    rate.addEventListener("input", () => {
      audio.playbackRate = Number(rate.value);
      valSpan.textContent = `${Number(rate.value).toFixed(2)}×`;
    });
    rateRow.appendChild(rate);
    container.appendChild(rateRow);

    // Trim — clamps playback to [start, end] without re-encoding anything;
    // dragging past the trimmed region during playback snaps back to start.
    // The waveform above visibly dims whatever's outside [start, end] so
    // trimming shows an actual change, not just two numbers moving.
    const trimRow = div("sound-rate-row");
    const trimStartLabel = document.createElement("label");
    const trimStartVal = document.createElement("span");
    trimStartVal.textContent = "0.0s";
    trimStartLabel.append("Trim start: ", trimStartVal);
    trimRow.appendChild(trimStartLabel);
    const trimStart = document.createElement("input");
    trimStart.type = "range"; trimStart.min = "0"; trimStart.max = "10"; trimStart.step = "0.1"; trimStart.value = "0";
    trimRow.appendChild(trimStart);
    container.appendChild(trimRow);

    const trimRow2 = div("sound-rate-row");
    const trimEndLabel = document.createElement("label");
    const trimEndVal = document.createElement("span");
    trimEndVal.textContent = "10.0s";
    trimEndLabel.append("Trim end: ", trimEndVal);
    trimRow2.appendChild(trimEndLabel);
    const trimEnd = document.createElement("input");
    trimEnd.type = "range"; trimEnd.min = "0"; trimEnd.max = "10"; trimEnd.step = "0.1"; trimEnd.value = "10";
    trimRow2.appendChild(trimEnd);
    container.appendChild(trimRow2);

    const onTrimChange = () => {
      if (Number(trimStart.value) > Number(trimEnd.value)) trimStart.value = trimEnd.value;
      trimStartVal.textContent = `${Number(trimStart.value).toFixed(1)}s`;
      trimEndVal.textContent = `${Number(trimEnd.value).toFixed(1)}s`;
      this._redrawStaticBars?.();
    };
    trimStart.addEventListener("input", onTrimChange);
    trimEnd.addEventListener("input", onTrimChange);

    audio.addEventListener("loadedmetadata", () => {
      trimStart.max = trimEnd.max = String(audio.duration);
      trimEnd.value = String(audio.duration);
      onTrimChange();
      this._drawPlayback(canvas, samples, audio, () => ({ start: Number(trimStart.value), end: Number(trimEnd.value) }));
    }, { once: true });
    audio.addEventListener("timeupdate", () => {
      const s = Number(trimStart.value), e = Number(trimEnd.value);
      if (audio.currentTime < s) audio.currentTime = s;
      if (audio.currentTime > e) { audio.pause(); audio.currentTime = s; }
    });
    audio.addEventListener("play", () => { if (audio.currentTime < Number(trimStart.value) || audio.currentTime >= Number(trimEnd.value)) audio.currentTime = Number(trimStart.value); });

    const downloadRow = div("sound-record-row");
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = `recording-${Date.now()}.webm`;
    downloadLink.className = "cyber-sim-btn";
    downloadLink.textContent = "Download recording";
    downloadRow.appendChild(downloadLink);
    container.appendChild(downloadRow);

    const note = document.createElement("p");
    note.className = "sound-hint";
    note.textContent = "Speed/pitch changes playback rate directly, which changes pitch and duration together — real, honest coupling, not a studio-grade independent pitch shifter.";
    container.appendChild(note);
  }

  // ---------- Make Your Own Sound ----------
  _renderMake() {
    const wrap = div("sound-wrap");
    const intro = document.createElement("p");
    intro.className = "econ-intro";
    intro.textContent = "A real oscillator (Web Audio's OscillatorNode) generates these tones live — the waveform shape you pick genuinely is the sound's waveform, not a decoration. A sine wave is a single pure frequency; square, sawtooth, and triangle waves are all actually mixtures of many frequencies (harmonics) layered together, which is exactly why they sound \"buzzier\" or \"brighter\" than a plain sine — you're hearing more than one frequency at once.";
    wrap.appendChild(intro);

    const controls = div("sound-make-controls");
    const waveRow = div("sound-wave-picker");
    let currentWave = "sine";
    const waveButtons = {};
    for (const w of ["sine", "square", "sawtooth", "triangle"]) {
      const btn = document.createElement("button");
      btn.className = "sound-wave-btn" + (w === currentWave ? " active" : "");
      btn.textContent = w[0].toUpperCase() + w.slice(1);
      btn.addEventListener("click", () => {
        currentWave = w;
        Object.entries(waveButtons).forEach(([id, b]) => b.classList.toggle("active", id === w));
        if (this._oscillator) this._oscillator.type = currentWave;
      });
      waveButtons[w] = btn;
      waveRow.appendChild(btn);
    }
    controls.appendChild(waveRow);

    const freqLabel = document.createElement("label");
    const freqVal = document.createElement("span");
    freqVal.textContent = "440 Hz (A4)";
    freqLabel.appendChild(document.createTextNode("Frequency: "));
    freqLabel.appendChild(freqVal);
    controls.appendChild(freqLabel);
    const freqSlider = document.createElement("input");
    freqSlider.type = "range"; freqSlider.min = "80"; freqSlider.max = "1200"; freqSlider.step = "1"; freqSlider.value = "440";
    controls.appendChild(freqSlider);

    const playBtn = document.createElement("button");
    playBtn.className = "cyber-sim-btn primary";
    playBtn.textContent = "▶ Play tone";
    controls.appendChild(playBtn);
    wrap.appendChild(controls);

    const { wrap: canvasWrap, canvas } = this._makeCanvas();
    wrap.appendChild(canvasWrap);

    const noteNameFor = (freq) => {
      const A4 = 440, notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      const semitonesFromA4 = Math.round(12 * Math.log2(freq / A4));
      const noteIndex = ((9 + semitonesFromA4) % 12 + 12) % 12; // A is index 9 in a C-based octave
      const octave = 4 + Math.floor((9 + semitonesFromA4) / 12);
      return `${notes[noteIndex]}${octave}`;
    };

    freqSlider.addEventListener("input", () => {
      const f = Number(freqSlider.value);
      freqVal.textContent = `${f} Hz (${noteNameFor(f)})`;
      if (this._oscillator) this._oscillator.frequency.setValueAtTime(f, this._audioCtx.currentTime);
    });

    playBtn.addEventListener("click", () => {
      if (this._oscillator) {
        this._oscillator.stop();
        this._oscillator = null;
        this._rafId && cancelAnimationFrame(this._rafId);
        playBtn.textContent = "▶ Play tone";
        return;
      }
      this._audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const osc = this._audioCtx.createOscillator();
      osc.type = currentWave;
      osc.frequency.value = Number(freqSlider.value);
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.2; // audible but not ear-splitting
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      osc.connect(gain).connect(analyser).connect(this._audioCtx.destination);
      osc.start();
      this._oscillator = osc;
      this._drawLiveWaveform(canvas, analyser);
      playBtn.textContent = "■ Stop tone";
    });

    wrap.appendChild(this._buildTilePad(currentWave, () => currentWave));

    this.body.appendChild(wrap);
  }

  // A 3x3 grid of playable tiles ("Tile Pad") — each tile holds one real
  // note (a Web Audio oscillator + a short attack/decay envelope, not a
  // toggled drone, so multiple presses in quick succession sound like an
  // actual instrument instead of needing a manual stop). Tiles are
  // reassigned by selecting one, then clicking a note on the piano strip
  // below it. Number keys 1-9 play the matching tile the same way a click
  // does. getWaveType is a closure so the pad always uses whatever
  // waveform is currently selected up in the main controls.
  _buildTilePad(initialWave, getWaveType) {
    const section = div("sound-tilepad");
    const heading = document.createElement("p");
    heading.className = "econ-intro";
    heading.textContent = "Tile Pad — click a tile to select it, then click a piano key below to assign that note. Press 1-9 on your keyboard to play the tiles.";
    section.appendChild(heading);

    this._tileNotes = DEFAULT_TILE_KEYS.map((k) => ({ name: k.name, semis: k.semis }));
    let selectedTile = 0;

    const grid = div("sound-tile-grid");
    const tileButtons = [];
    for (let i = 0; i < 9; i++) {
      const tile = document.createElement("button");
      tile.className = "sound-tile" + (i === selectedTile ? " selected" : "");
      tile.innerHTML = `<span class="sound-tile-key">${i + 1}</span><span class="sound-tile-note">${this._tileNotes[i].name}</span>`;
      tile.addEventListener("click", () => {
        selectedTile = i;
        tileButtons.forEach((b, j) => b.classList.toggle("selected", j === i));
        this._playTileTone(freqForSemis(this._tileNotes[i].semis), getWaveType());
      });
      tileButtons.push(tile);
      grid.appendChild(tile);
    }
    section.appendChild(grid);

    const pianoHint = document.createElement("p");
    pianoHint.className = "sound-hint";
    pianoHint.textContent = `Assigning tile ${selectedTile + 1} — click a key:`;
    section.appendChild(pianoHint);

    // Fixed pixel-width keys (not percentage-of-container) so widening the
    // note range doesn't squeeze every key thinner — the scroll wrapper
    // below lets the now-3-octave range stay scrollable instead, same as a
    // real physical keyboard wider than its stand.
    const WHITE_KEY_PX = 26;
    const pianoScroll = div("sound-piano-scroll");
    const piano = div("sound-piano");
    const whiteKeys = PIANO_KEYS.filter((k) => !k.black);
    piano.style.width = `${whiteKeys.length * WHITE_KEY_PX}px`;
    let whiteIndex = -1;
    for (const k of PIANO_KEYS) {
      const key = document.createElement("button");
      if (!k.black) whiteIndex++;
      key.className = k.black ? "sound-piano-key sound-piano-key-black" : "sound-piano-key sound-piano-key-white";
      key.title = k.name;
      if (k.black) {
        key.style.left = `${whiteIndex * WHITE_KEY_PX + WHITE_KEY_PX - WHITE_KEY_PX * 0.3}px`;
        key.style.width = `${WHITE_KEY_PX * 0.6}px`;
      } else {
        key.style.left = `${whiteIndex * WHITE_KEY_PX}px`;
        key.style.width = `${WHITE_KEY_PX}px`;
      }
      key.addEventListener("click", () => {
        this._tileNotes[selectedTile] = { name: k.name, semis: k.semis };
        tileButtons[selectedTile].querySelector(".sound-tile-note").textContent = k.name;
        this._playTileTone(freqForSemis(k.semis), getWaveType());
      });
      piano.appendChild(key);
    }
    pianoScroll.appendChild(piano);
    section.appendChild(pianoScroll);

    tileButtons.forEach((b, i) => b.addEventListener("click", () => {
      pianoHint.textContent = `Assigning tile ${i + 1} — click a key:`;
    }));

    this._tileKeydownHandler = (e) => {
      if (e.repeat) return;
      if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      const i = n - 1;
      selectedTile = i;
      tileButtons.forEach((b, j) => b.classList.toggle("selected", j === i));
      pianoHint.textContent = `Assigning tile ${i + 1} — click a key:`;
      this._playTileTone(freqForSemis(this._tileNotes[i].semis), getWaveType());
    };
    window.addEventListener("keydown", this._tileKeydownHandler);

    return section;
  }

  // A short, real percussive-style tone: a genuine OscillatorNode with an
  // exponential decay envelope (fast attack, ~0.5s decay) rather than the
  // sustained drone the main Play/Stop button uses — appropriate for a
  // playable tile you tap repeatedly, not a held note.
  _playTileTone(freq, waveType) {
    this._audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (this._audioCtx.state === "suspended") this._audioCtx.resume();
    const ctx = this._audioCtx;
    const osc = ctx.createOscillator();
    osc.type = waveType;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.55);
    this._tileOscillators ||= [];
    this._tileOscillators.push(osc);
    osc.addEventListener("ended", () => {
      this._tileOscillators = this._tileOscillators?.filter((o) => o !== osc) || null;
    });
  }
}
