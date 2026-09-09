// Real audio, not a canned waveform image: a live AnalyserNode drives the
// waveform canvas straight from your microphone or from an oscillator this
// mode builds itself — same Web Audio API a DAW uses under the hood.
const SUB_MODES = [
  { id: "record", label: "Record & Visualize" },
  { id: "make", label: "Make Your Own Sound" },
];

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
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    this._oscillator?.stop();
    this._oscillator = null;
    this._audioCtx?.close().catch(() => {});
    this._audioCtx = null;
    this._mediaRecorder = null;
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

  _drawWaveform(canvas, analyser) {
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

  // ---------- Record & Visualize ----------
  _renderRecord() {
    const wrap = div("sound-wrap");
    const intro = document.createElement("p");
    intro.className = "econ-intro";
    intro.textContent = "This draws your actual microphone input in real time (a Web Audio AnalyserNode reading live samples), not a stock animation. Record a clip, then play it back at a different speed — speeding audio up raises its pitch and slowing it down lowers it, the same physical relationship a tape or vinyl record speeding up or slowing down has, because both pitch and duration come from the same underlying sample rate.";
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
    recordBtn.textContent = "● Record clip";
    recordBtn.disabled = true;
    recordRow.appendChild(recordBtn);
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
      this._drawWaveform(canvas, analyser);

      let chunks = [];
      this._mediaRecorder = new MediaRecorder(this._stream);
      this._mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      this._mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        chunks = [];
        this._showPlayback(playbackWrap, blob);
      };
      recordBtn.addEventListener("click", () => {
        if (recordBtn.classList.contains("recording")) {
          this._mediaRecorder.stop();
          recordBtn.classList.remove("recording");
          recordBtn.textContent = "● Record clip";
        } else {
          chunks = [];
          this._mediaRecorder.start();
          recordBtn.classList.add("recording");
          recordBtn.textContent = "■ Stop recording";
        }
      });
    });

    this.body.appendChild(wrap);
  }

  _showPlayback(container, blob) {
    container.innerHTML = "";
    const url = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = url;
    container.appendChild(audio);

    const rateRow = div("sound-rate-row");
    const label = document.createElement("label");
    label.textContent = "Speed / pitch: ";
    const valSpan = document.createElement("span");
    valSpan.textContent = "1.00×";
    label.appendChild(valSpan);
    rateRow.appendChild(label);
    const rate = document.createElement("input");
    rate.type = "range"; rate.min = "0.5"; rate.max = "2"; rate.step = "0.05"; rate.value = "1";
    rate.addEventListener("input", () => {
      audio.playbackRate = Number(rate.value);
      valSpan.textContent = `${Number(rate.value).toFixed(2)}×`;
    });
    rateRow.appendChild(rate);
    container.appendChild(rateRow);
    const note = document.createElement("p");
    note.className = "sound-hint";
    note.textContent = "This changes playback rate directly, which changes pitch and duration together — real, honest pitch/speed coupling, not a studio-grade independent pitch shifter.";
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
    const waveSel = document.createElement("select");
    for (const w of ["sine", "square", "sawtooth", "triangle"]) {
      const opt = document.createElement("option");
      opt.value = w; opt.textContent = w[0].toUpperCase() + w.slice(1);
      waveSel.appendChild(opt);
    }
    controls.appendChild(waveSel);

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
    waveSel.addEventListener("change", () => {
      if (this._oscillator) this._oscillator.type = waveSel.value;
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
      osc.type = waveSel.value;
      osc.frequency.value = Number(freqSlider.value);
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.2; // audible but not ear-splitting
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      osc.connect(gain).connect(analyser).connect(this._audioCtx.destination);
      osc.start();
      this._oscillator = osc;
      this._drawWaveform(canvas, analyser);
      playBtn.textContent = "■ Stop tone";
    });

    this.body.appendChild(wrap);
  }
}
