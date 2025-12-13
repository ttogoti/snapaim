"use strict";
const speedEl = document.getElementById("speed");
let lastPos = null;
let lastT = performance.now();
let smoothSpeed = 0;
const SMOOTH = 0.2;
let lastMoveAt = performance.now(); // ✅ track last movement time
window.addEventListener("pointermove", (e) => {
    const now = performance.now();
    lastMoveAt = now; // ✅ mark movement
    const pos = { x: e.clientX, y: e.clientY };
    if (lastPos) {
        const dt = (now - lastT) / 1000;
        if (dt > 0) {
            const dx = pos.x - lastPos.x;
            const dy = pos.y - lastPos.y;
            const dist = Math.hypot(dx, dy);
            const speed = dist / dt; // px/s
            smoothSpeed += (speed - smoothSpeed) * SMOOTH;
        }
    }
    lastPos = pos;
    lastT = now;
});
// ✅ decay-to-zero loop
function tick() {
    const now = performance.now();
    // if no movement for 80ms, start decaying
    if (now - lastMoveAt > 80) {
        // exponential-ish decay each frame
        smoothSpeed *= 0.85;
        // snap to 0 when very small
        if (smoothSpeed < 1)
            smoothSpeed = 0;
    }
    speedEl.textContent = String(Math.round(smoothSpeed));
    requestAnimationFrame(tick);
}
tick();
