const speedEl = document.getElementById("speed") as HTMLSpanElement;

type Vec2 = { x: number; y: number };

let lastPos: Vec2 | null = null;
let lastT = performance.now();

let speed = 0;
let smoothSpeed = 0;
const SMOOTH = 0.2;

let lastMoveAt = performance.now();

window.addEventListener("pointermove", (e) => {
  const now = performance.now();
  lastMoveAt = now;

  const pos = { x: e.clientX, y: e.clientY };

  if (lastPos) {
    const dt = (now - lastT) / 1000;
    if (dt > 0) {
      const dist = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y);
      speed = dist / dt; // px/s
      smoothSpeed += (speed - smoothSpeed) * SMOOTH;
    }
  }

  lastPos = pos;
  lastT = now;
});

function tick() {
  const now = performance.now();

  // If no pointermove for 100ms, treat as stopped
  if (now - lastMoveAt > 100) {
    speed = 0;
    smoothSpeed = 0;
  }

  speedEl.textContent = String(Math.round(smoothSpeed));
  requestAnimationFrame(tick);
}
tick();
