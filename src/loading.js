// A canvas loading animation: three balls orbit a center nucleus along the
// same three tilted ellipses (0°, 60°, 120°) the real logo is built from,
// each leaving a fading trail in the logo's own three colors. When the app
// is ready, the canvas fades out while the real static logo fades in
// underneath, so the trails settle into the exact shape they were tracing.
const COLORS = ["#38bdf8", "#8b5cf6", "#10b981"]; // matches --cool-1/2/3
const MIN_DISPLAY_MS = 1600;

let rafId = null;
let startTime = null;
let teardown = null;

export function startLoadingAnimation() {
  const canvas = document.getElementById("loading-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.4;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  const trails = [[], [], []];
  const TRAIL_LEN = 22;

  function frame(t) {
    startTime ??= t;
    const size = canvas.width / dpr;
    const cx = size / 2, cy = size / 2;
    const rx = size * 0.34, ry = size * 0.14;

    ctx.clearRect(0, 0, size, size);

    // Nucleus
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.045, 0, Math.PI * 2);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--text") || "#1c1f26";
    ctx.fill();

    for (let i = 0; i < 3; i++) {
      const tilt = (i * 60 * Math.PI) / 180;
      const angle = (t / 1000) * (1.4 + i * 0.15) + (i * 2 * Math.PI) / 3;
      const lx = Math.cos(angle) * rx, ly = Math.sin(angle) * ry;
      const x = cx + lx * Math.cos(tilt) - ly * Math.sin(tilt);
      const y = cy + lx * Math.sin(tilt) + ly * Math.cos(tilt);

      trails[i].push({ x, y });
      if (trails[i].length > TRAIL_LEN) trails[i].shift();

      ctx.strokeStyle = COLORS[i];
      ctx.lineWidth = size * 0.018;
      ctx.lineCap = "round";
      for (let j = 1; j < trails[i].length; j++) {
        ctx.globalAlpha = j / trails[i].length;
        ctx.beginPath();
        ctx.moveTo(trails[i][j - 1].x, trails[i][j - 1].y);
        ctx.lineTo(trails[i][j].x, trails[i][j].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(x, y, size * 0.028, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[i];
      ctx.fill();
    }

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  teardown = () => {
    window.removeEventListener("resize", resize);
    if (rafId) cancelAnimationFrame(rafId);
  };
  return teardown;
}

// Called once the app has actually finished booting — still waits out
// whatever's left of a minimum display time so the animation isn't just a
// single-frame flash on a fast load, then crossfades to the real logo.
export function finishLoading() {
  const screen = document.getElementById("loading-screen");
  if (!screen) return;
  const elapsed = startTime ? performance.now() - startTime : 0;
  const wait = Math.max(0, MIN_DISPLAY_MS - elapsed);
  setTimeout(() => {
    screen.classList.add("loading-done");
    teardown?.(); // stop the rAF loop right as the canvas starts fading — no point drawing frames nobody can see
    setTimeout(() => screen.remove(), 700);
  }, wait);
}
