const speedEl = document.getElementById("speed") as HTMLSpanElement;

type Vec2 = { x: number; y: number };

let lastPos: Vec2 | null = null;
let lastT = performance.now();
let smoothSpeed = 0;

window.addEventListener("pointermove", (e) => {
  const now = performance.now();
  const pos = { x: e.clientX, y: e.clientY };

  if (lastPos) {
    const dt = (now - lastT) / 1000;
    if (dt > 0) {
      const dist = Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y);
      const speed = dist / dt; // px/s
      smoothSpeed += (speed - smoothSpeed) * 0.2;
      speedEl.textContent = String(Math.round(smoothSpeed));
    }
  }

  lastPos = pos;
  lastT = now;
});
