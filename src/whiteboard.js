import { confirmPopup } from "./popup.js";

// Two lightweight, independent tools sharing one shell: a sketch surface
// for diagramming ideas/equations, and a simple text notebook. Each
// persists to its own localStorage slot so switching tabs (or reloading)
// never loses work.
const SUB_MODES = [
  { id: "sketch", label: "Draw" },
  { id: "note", label: "Write" },
];

const STORAGE_KEY = "continuum-whiteboard-v1";
const SKETCH_COLORS = ["#1c1f26", "#e0473f", "#2f7bde", "#2ecc71", "#f0a83c"];
const MAX_HISTORY = 40;

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStore(store) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* storage full/unavailable — drawing still works this session */ }
}

export class WhiteboardMode {
  constructor(root) {
    this.root = root;
    this.sub = "sketch";
    this.store = loadStore();
    if (!Array.isArray(this.store.notes)) this.store.notes = [];
    this._build();
  }

  mount() {
    this._renderSub();
  }

  unmount() {
    this._activeResizeObserver?.disconnect();
    if (this._activeKeyHandler) document.removeEventListener("keydown", this._activeKeyHandler);
  }

  _build() {
    this.root.innerHTML = "";
    this.root.className = "wb-root";

    const tabs = document.createElement("div");
    tabs.className = "wb-tabs";
    this._tabButtons = {};
    for (const m of SUB_MODES) {
      const btn = document.createElement("button");
      btn.className = "wb-tab" + (m.id === this.sub ? " active" : "");
      btn.textContent = m.label;
      btn.addEventListener("click", () => {
        this.sub = m.id;
        for (const [id, b] of Object.entries(this._tabButtons)) b.classList.toggle("active", id === this.sub);
        this._renderSub();
      });
      this._tabButtons[m.id] = btn;
      tabs.appendChild(btn);
    }
    this.root.appendChild(tabs);

    this.stage = document.createElement("div");
    this.stage.className = "wb-stage";
    this.root.appendChild(this.stage);
  }

  _renderSub() {
    this._activeResizeObserver?.disconnect();
    this._activeResizeObserver = null;
    if (this._activeKeyHandler) { document.removeEventListener("keydown", this._activeKeyHandler); this._activeKeyHandler = null; }
    this.stage.innerHTML = "";
    if (this.sub === "sketch") {
      this._buildCanvasEditor({ storeKey: "sketchImage", colors: SKETCH_COLORS, defaultSize: 3, tools: ["pen", "eraser"] });
    } else {
      this._buildNotes();
    }
  }

  // ---------- Shared canvas engine (Draw) ----------

  _buildCanvasEditor({ storeKey, colors, defaultSize, tools }) {
    const wrap = document.createElement("div");
    wrap.className = "wb-canvas-wrap";

    const toolbar = document.createElement("div");
    toolbar.className = "wb-toolbar";

    let tool = tools[0];
    let color = colors[0];
    let size = defaultSize;

    const toolRow = document.createElement("div");
    toolRow.className = "wb-tool-row";
    const toolLabels = { pen: "✏️ Pen", eraser: "🧹 Eraser" };
    const toolButtons = {};
    for (const t of tools) {
      const btn = document.createElement("button");
      btn.className = "wb-tool-btn" + (t === tool ? " active" : "");
      btn.textContent = toolLabels[t];
      btn.addEventListener("click", () => {
        tool = t;
        for (const [id, b] of Object.entries(toolButtons)) b.classList.toggle("active", id === tool);
      });
      toolButtons[t] = btn;
      toolRow.appendChild(btn);
    }
    toolbar.appendChild(toolRow);

    const colorRow = document.createElement("div");
    colorRow.className = "wb-color-row";
    const swatchButtons = [];
    for (const c of colors) {
      const sw = document.createElement("button");
      sw.className = "wb-color-swatch" + (c === color ? " active" : "");
      sw.style.background = c;
      sw.addEventListener("click", () => {
        color = c;
        for (const s of swatchButtons) s.classList.toggle("active", s === sw);
      });
      swatchButtons.push(sw);
      colorRow.appendChild(sw);
    }
    const customColor = document.createElement("input");
    customColor.type = "color";
    customColor.className = "wb-color-custom";
    customColor.value = color;
    customColor.addEventListener("input", () => {
      color = customColor.value;
      for (const s of swatchButtons) s.classList.remove("active");
    });
    colorRow.appendChild(customColor);
    toolbar.appendChild(colorRow);

    const sizeRow = document.createElement("div");
    sizeRow.className = "wb-size-row";
    const sizeLabel = document.createElement("span");
    sizeLabel.textContent = "Size";
    sizeRow.appendChild(sizeLabel);
    const sizeSlider = document.createElement("input");
    sizeSlider.type = "range";
    sizeSlider.min = "1";
    sizeSlider.max = "60";
    sizeSlider.value = String(defaultSize);
    sizeSlider.addEventListener("input", () => { size = parseFloat(sizeSlider.value); });
    sizeRow.appendChild(sizeSlider);
    const undoBtn = document.createElement("button");
    undoBtn.textContent = "↶ Undo";
    undoBtn.title = "Ctrl/Cmd+Z";
    sizeRow.appendChild(undoBtn);
    const redoBtn = document.createElement("button");
    redoBtn.textContent = "↷ Redo";
    redoBtn.title = "Ctrl/Cmd+Shift+Z";
    sizeRow.appendChild(redoBtn);
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.className = "wb-clear-btn";
    sizeRow.appendChild(clearBtn);
    toolbar.appendChild(sizeRow);

    wrap.appendChild(toolbar);

    const canvasHolder = document.createElement("div");
    canvasHolder.className = "wb-canvas-holder";
    const canvas = document.createElement("canvas");
    canvasHolder.appendChild(canvas);
    wrap.appendChild(canvasHolder);
    this.stage.appendChild(wrap);

    const ctx = canvas.getContext("2d");

    const resize = () => {
      const rect = canvasHolder.getBoundingClientRect();
      const prev = canvas.width && canvas.height ? canvas.toDataURL() : null;
      canvas.width = Math.max(200, Math.floor(rect.width));
      canvas.height = Math.max(200, Math.floor(rect.height));
      if (prev) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = prev;
      } else {
        const saved = this.store[storeKey];
        if (saved) {
          const img = new Image();
          img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          img.src = saved;
        }
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvasHolder);
    this._activeResizeObserver = resizeObserver;
    resize();

    const persist = () => {
      this.store[storeKey] = canvas.toDataURL("image/png");
      saveStore(this.store);
    };

    let drawing = false;
    let last = null;
    let undoStack = [];
    let redoStack = [];

    const updateHistoryButtons = () => {
      undoBtn.disabled = undoStack.length === 0;
      redoBtn.disabled = redoStack.length === 0;
    };
    updateHistoryButtons();

    const snapshot = () => ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pushUndo = () => {
      undoStack.push(snapshot());
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      updateHistoryButtons();
    };

    const drawSegment = (x0, y0, x1, y1) => {
      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    };

    canvas.addEventListener("pointerdown", (e) => {
      // Capture can fail in edge cases (e.g. a pointer already released) —
      // that's not a reason to skip starting the stroke itself.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      pushUndo();
      const rect = canvas.getBoundingClientRect();
      last = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      drawing = true;
      // A single tap/click still leaves a dot, not nothing.
      drawSegment(last.x, last.y, last.x, last.y);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing || !last) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      drawSegment(last.x, last.y, x, y);
      last = { x, y };
    });
    const endStroke = () => {
      if (!drawing) return;
      drawing = false;
      persist();
    };
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointerleave", endStroke);
    canvas.addEventListener("pointercancel", endStroke);

    const undo = () => {
      if (!undoStack.length) return;
      redoStack.push(snapshot());
      ctx.putImageData(undoStack.pop(), 0, 0);
      persist();
      updateHistoryButtons();
    };
    const redo = () => {
      if (!redoStack.length) return;
      undoStack.push(snapshot());
      ctx.putImageData(redoStack.pop(), 0, 0);
      persist();
      updateHistoryButtons();
    };
    undoBtn.addEventListener("click", undo);
    redoBtn.addEventListener("click", redo);

    const onKeyDown = (e) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (!cmd || e.key.toLowerCase() !== "z") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    document.addEventListener("keydown", onKeyDown);
    this._activeKeyHandler = onKeyDown;

    clearBtn.addEventListener("click", async () => {
      if (!(await confirmPopup("Clear this canvas?", { title: "Clear canvas", confirmLabel: "Clear", danger: true }))) return;
      pushUndo();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      persist();
    });
  }

  // ---------- Note-taking ----------

  _buildNotes() {
    if (!this.store.notes.length) {
      this.store.notes.push({ id: 1, title: "New note", body: "" });
      this._nextNoteId = 2;
    }
    if (this._selectedNoteId == null || !this.store.notes.some((n) => n.id === this._selectedNoteId)) {
      this._selectedNoteId = this.store.notes[0].id;
    }
    if (!this._nextNoteId) this._nextNoteId = Math.max(...this.store.notes.map((n) => n.id)) + 1;

    const wrap = document.createElement("div");
    wrap.className = "wb-notes-wrap";

    const list = document.createElement("div");
    list.className = "wb-notes-list";
    for (const note of this.store.notes) {
      const item = document.createElement("button");
      item.className = "wb-note-item" + (note.id === this._selectedNoteId ? " active" : "");
      const title = document.createElement("span");
      title.className = "wb-note-item-title";
      title.textContent = note.title || "Untitled";
      item.appendChild(title);
      item.addEventListener("click", () => { this._selectedNoteId = note.id; this._renderSub(); });
      list.appendChild(item);
    }
    const addBtn = document.createElement("button");
    addBtn.className = "primary wb-note-add";
    addBtn.textContent = "+ New note";
    addBtn.addEventListener("click", () => {
      const note = { id: this._nextNoteId++, title: "New note", body: "" };
      this.store.notes.push(note);
      this._selectedNoteId = note.id;
      saveStore(this.store);
      this._renderSub();
    });
    list.appendChild(addBtn);
    wrap.appendChild(list);

    const editor = document.createElement("div");
    editor.className = "wb-note-editor";
    const note = this.store.notes.find((n) => n.id === this._selectedNoteId);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "wb-note-title-input";
    titleInput.placeholder = "Title";
    titleInput.value = note.title;
    titleInput.addEventListener("input", () => {
      note.title = titleInput.value;
      saveStore(this.store);
      const activeItem = list.querySelector(".wb-note-item.active .wb-note-item-title");
      if (activeItem) activeItem.textContent = note.title || "Untitled";
    });
    editor.appendChild(titleInput);

    const body = document.createElement("textarea");
    body.className = "wb-note-body";
    body.placeholder = "Write here…";
    body.value = note.body;
    body.addEventListener("input", () => { note.body = body.value; saveStore(this.store); });
    editor.appendChild(body);

    if (this.store.notes.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "wb-note-delete danger";
      delBtn.textContent = "Delete note";
      delBtn.addEventListener("click", async () => {
        if (!(await confirmPopup(`Delete "${note.title || "Untitled"}"?`, { title: "Delete note", confirmLabel: "Delete", danger: true }))) return;
        this.store.notes = this.store.notes.filter((n) => n.id !== note.id);
        this._selectedNoteId = null;
        saveStore(this.store);
        this._renderSub();
      });
      editor.appendChild(delBtn);
    }

    wrap.appendChild(editor);
    this.stage.appendChild(wrap);
  }
}

