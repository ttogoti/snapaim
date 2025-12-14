"use strict";
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const menu = document.getElementById("menu");
const nameInput = document.getElementById("nameInput");
const hudBottom = document.getElementById("hudBottom");
const hudName = document.getElementById("hudName");
const hudHpText = document.getElementById("hudHpText");
const hpBarInner = document.getElementById("hpBarInner");
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();
const START_HP = 100000; // change to 10_000 if you want 10k everywhere
let myId = null;
let myName = "";
let hitRadius = 22;
let ws = null;
let joined = false;
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
// Keep a local map of player states (server authority)
const players = new Map();
const smooth = new Map();
// Server URL
const WS_URL = location.hostname === "localhost"
    ? "ws://localhost:8080"
    : "wss://snapaim.onrender.com";
// Heartbeat keeps server position fresh even if pointermove doesn't fire
let heartbeat = null;
// --- Join/Menu ---
nameInput.focus();
function startGame() {
    if (joined)
        return;
    joined = true;
    const clean = nameInput.value.trim().slice(0, 18);
    myName = clean.length ? clean : "Player";
    // Set an initial position so the server isn't stuck at (0,0)
    mouseX = window.innerWidth / 2;
    mouseY = window.innerHeight / 2;
    // Immediately update HUD so it doesn't sit on "Loading..."
    hudName.textContent = myName;
    hudHpText.textContent = `${START_HP.toLocaleString()} / ${START_HP.toLocaleString()} HP`;
    hpBarInner.style.width = "100%";
    hpBarInner.style.backgroundImage = "none";
    hpBarInner.style.background = "hsl(120, 85%, 55%)";
    hpBarInner.style.opacity = "1";
    menu.style.display = "none";
    hudBottom.style.display = "block";
    connect();
}
nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        startGame();
    }
});
// --- WebSocket ---
function connect() {
    ws = new WebSocket(WS_URL);
    ws.addEventListener("open", () => {
        // Heartbeat sends move packets even when stationary
        heartbeat = window.setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
            }
        }, 50); // 20 Hz
    });
    ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.t === "welcome") {
            myId = msg.id;
            hitRadius = msg.hitRadius ?? hitRadius;
            // Immediately set name on server
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ t: "setName", name: myName }));
                ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
            }
            return;
        }
        if (msg.t === "state") {
            const list = msg.players;
            // Update players + smoothing targets
            for (const p of list) {
                players.set(p.id, p);
                if (p.id !== myId) {
                    const s = smooth.get(p.id);
                    if (!s) {
                        smooth.set(p.id, { x: p.x, y: p.y, tx: p.x, ty: p.y });
                    }
                    else {
                        s.tx = p.x;
                        s.ty = p.y;
                    }
                }
            }
            // If we never received welcome, infer myId from the state:
            // choose the player with myName closest to my current mouse position
            if (joined && !myId && myName) {
                let bestId = null;
                let bestD = Infinity;
                for (const p of list) {
                    if ((p.name || "").trim() !== myName)
                        continue;
                    const dx = p.x - mouseX;
                    const dy = p.y - mouseY;
                    const d = dx * dx + dy * dy;
                    if (d < bestD) {
                        bestD = d;
                        bestId = p.id;
                    }
                }
                // Only lock if it's reasonably close (prevents grabbing a same-name stranger)
                if (bestId && bestD < (hitRadius * 4) * (hitRadius * 4)) {
                    myId = bestId;
                    // Once we know our ID, ensure our name is set server-side
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ t: "setName", name: myName }));
                    }
                }
            }
            // Remove smoothing entries for players that no longer exist
            const alive = new Set(list.map((p) => p.id));
            for (const id of smooth.keys()) {
                if (!alive.has(id))
                    smooth.delete(id);
            }
            // Remove vanished players
            for (const id of players.keys()) {
                if (!alive.has(id))
                    players.delete(id);
            }
            return;
        }
        if (msg.t === "hit") {
            const target = players.get(msg.to);
            if (target)
                target.hp = msg.hp;
            return;
        }
    });
    ws.addEventListener("close", () => {
        if (heartbeat !== null) {
            clearInterval(heartbeat);
            heartbeat = null;
        }
    });
}
// Ensure close message reaches server quickly
window.addEventListener("beforeunload", () => {
    try {
        ws?.close();
    }
    catch { }
});
// --- Input ---
let lastMoveSend = 0;
const MOVE_SEND_MS = 50;
window.addEventListener("pointermove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    const now = performance.now();
    if (ws && ws.readyState === WebSocket.OPEN && now - lastMoveSend >= MOVE_SEND_MS) {
        lastMoveSend = now;
        ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
    }
});
window.addEventListener("pointerdown", (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return;
    ws.send(JSON.stringify({ t: "click", x: e.clientX, y: e.clientY }));
});
// --- Rendering ---
function drawOtherHealthBar(x, y, hp) {
    ctx.save();
    const w = 70;
    const h = 15;
    const pct = Math.max(0, Math.min(1, hp / START_HP));
    const bx = x - w / 2;
    const by = y - hitRadius - 24;
    // background
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(bx, by, w, h);
    // bar color
    let color;
    if (pct > 0.6)
        color = "#3ddc84";
    else if (pct > 0.3)
        color = "#f5c542";
    else
        color = "#ff4d4d";
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, w * pct, h);
    // outline around bar (same style as name outline, but 3px)
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    ctx.strokeRect(bx, by, w, h);
    // HP number inside bar with outline
    const text = Math.round(hp).toLocaleString();
    ctx.font = "9px Ubuntu, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    ctx.strokeText(text, bx + w / 2, by + h / 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(text, bx + w / 2, by + h / 2);
    ctx.restore();
}
function updateBottomHud() {
    // If we haven't locked myId yet, keep showing myName (not Loading...)
    if (!joined)
        return;
    if (!myId) {
        hudName.textContent = myName || "Loading...";
        return;
    }
    const me = players.get(myId);
    if (!me)
        return;
    hudName.textContent = me.name || myName || "Player";
    hudHpText.textContent = `${Math.round(me.hp).toLocaleString()} / ${START_HP.toLocaleString()} HP`;
    const pct = Math.max(0, Math.min(1, me.hp / START_HP));
    hpBarInner.style.width = `${pct * 100}%`;
    const hue = pct * 120;
    hpBarInner.style.backgroundImage = "none";
    hpBarInner.style.background = `hsl(${hue}, 85%, 55%)`;
    hpBarInner.style.opacity = "1";
}
function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Smooth other players toward their targets
    const SMOOTH = 0.18;
    for (const s of smooth.values()) {
        s.x += (s.tx - s.x) * SMOOTH;
        s.y += (s.ty - s.y) * SMOOTH;
    }
    // Draw everyone EXCEPT you (works once myId is known; before that we still try to infer)
    for (const p of players.values()) {
        if (myId && p.id === myId)
            continue;
        const s = smooth.get(p.id);
        const x = s ? s.x : p.x;
        const y = s ? s.y : p.y;
        ctx.save();
        // player circle
        ctx.beginPath();
        ctx.arc(x, y, hitRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(90,240,150,0.95)";
        ctx.fill();
        // name underneath (outlined)
        const label = (p.name && p.name.trim().length) ? p.name : p.id.slice(0, 4);
        ctx.font = "12px Ubuntu, system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(55,55,55,0.95)";
        ctx.strokeText(label, x, y + hitRadius + 14);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillText(label, x, y + hitRadius + 14);
        ctx.restore();
        // healthbar + number above
        drawOtherHealthBar(x, y, p.hp);
    }
    updateBottomHud();
    requestAnimationFrame(loop);
}
loop();
