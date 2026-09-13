// A lightweight, real snapshot of a saved world/item: draws each object's
// actual shape and material color onto a small offscreen canvas, using the
// same position/size/material data that's actually being saved — not a
// generic icon, and not a full re-render through the app's own SVG
// pipeline (which would need a live DOM element). Good enough to recognize
// a saved world at a glance in a list of thumbnails.
import { materialOf } from "./materials.js";

const SNAPSHOT_W = 240, SNAPSHOT_H = 150;

export function generateSnapshot(specs) {
  if (!Array.isArray(specs) || !specs.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of specs) {
    const hw = (s.width ?? s.radius * 2 ?? 40) / 2;
    const hh = (s.height ?? s.radius * 2 ?? 40) / 2;
    minX = Math.min(minX, s.x - hw); maxX = Math.max(maxX, s.x + hw);
    minY = Math.min(minY, s.y - hh); maxY = Math.max(maxY, s.y + hh);
  }
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  const pad = 20;
  const scale = Math.min((SNAPSHOT_W - pad * 2) / spanX, (SNAPSHOT_H - pad * 2) / spanY, 1.5);
  const offsetX = (SNAPSHOT_W - spanX * scale) / 2 - minX * scale;
  const offsetY = (SNAPSHOT_H - spanY * scale) / 2 - minY * scale;

  const canvas = document.createElement("canvas");
  canvas.width = SNAPSHOT_W; canvas.height = SNAPSHOT_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eef1f6";
  ctx.fillRect(0, 0, SNAPSHOT_W, SNAPSHOT_H);

  for (const s of specs) {
    const mat = materialOf(s.material);
    ctx.save();
    ctx.translate(s.x * scale + offsetX, s.y * scale + offsetY);
    ctx.rotate(((s.rotation || 0) * Math.PI) / 180);
    ctx.fillStyle = mat?.color || "#8a8f9a";
    ctx.strokeStyle = mat?.strokeColor || "#333";
    ctx.lineWidth = 1;
    if (s.radius) {
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1.5, s.radius * scale), 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    } else {
      const w = Math.max(2, (s.width || 40) * scale), h = Math.max(2, (s.height || 40) * scale);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null; // canvas can throw in rare tainted-origin edge cases — a missing snapshot beats a hard failure on save
  }
}
