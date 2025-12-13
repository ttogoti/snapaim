"use strict";
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();
let myId = null;
let hitRadius = 22;
const START_HP = 100000;
const players = new Map();
// IMPORTANT: when deployed, replace with your hosted wss:// URL
const WS_URL = location.hostname === "localhost"
    ? "ws://localhost:8080"
    : "wss://YOUR_SERVER_HOST_HERE"; // <- replace after deploying server
const ws = new WebSocket(WS_URL);
ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === "welcome") {
        myId = msg.id;
        hitRadius = msg.hitRadius ?? hitRadius;
        return;
    }
    if (msg.t === "state") {
        for (const p of msg.players) {
            players.set(p.id, p);
        }
        return;
    }
    if (msg.t === "hit") {
        const target = players.get(msg.to);
        if (target)
            target.hp = msg.hp;
    }
});
let mouseX = 0;
let mouseY = 0;
// Send movement (throttled)
let lastSent = 0;
const SEND_EVERY_MS = 20; // 50/sec
window.addEventListener("pointermove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    const now = performance.now();
    if (ws.readyState === WebSocket.OPEN && now - lastSent >= SEND_EVERY_MS) {
        lastSent = now;
        ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
    }
});
window.addEventListener("pointerdown", (e) => {
    if (ws.readyState !== WebSocket.OPEN)
        return;
    ws.send(JSON.stringify({ t: "click", x: e.clientX, y: e.clientY }));
});
function drawHealthBar(x, y, hp) {
    const maxHp = START_HP;
    const w = 70;
    const h = 8;
    const pct = Math.max(0, Math.min(1, hp / maxHp));
    const bx = x - w / 2;
    const by = y - hitRadius - 18;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = "rgba(255,80,80,0.95)";
    ctx.fillRect(bx, by, w * pct, h);
    ctx.fillStyle = "white";
    ctx.font = "12px system-ui";
    ctx.fillText(`${Math.round(hp)}`, bx, by - 4);
}
function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of players.values()) {
        // hitbox
        ctx.beginPath();
        ctx.arc(p.x, p.y, hitRadius, 0, Math.PI * 2);
        ctx.fillStyle = p.id === myId ? "rgba(80,160,255,0.95)" : "rgba(90,240,150,0.95)";
        ctx.fill();
        drawHealthBar(p.x, p.y, p.hp);
        ctx.fillStyle = "white";
        ctx.font = "12px system-ui";
        ctx.fillText(p.id === myId ? "YOU" : p.id.slice(0, 4), p.x - 14, p.y + hitRadius + 14);
    }
    requestAnimationFrame(loop);
}
loop();
