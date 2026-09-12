// Real audio, not a canned waveform image: a live AnalyserNode drives the
// waveform canvas straight from your microphone or from an oscillator this
// mode builds itself — same Web Audio API a DAW uses under the hood.
const SUB_MODES = [
  { id: "record", label: "Record & Visualize" },
  { id: "make", label: "Make Your Own Sound" },
];
const MAX_RECORD_MS = 10000;
const SAMPLE_INTERVAL_MS = 40; // ~25 samples/sec of amplitude history — plenty dense for a 10s strip

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

    this.body.appendChild(wrap);
  }
}
