"use strict";
console.log("BUILD_MARKER_FINAL");
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
let myId = null;
let myName = "";
let hitRadius = 22;
let ws = null;
let joined = false;
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
// server-authoritative max HP (ONLY from server)
let myMaxHp = null;
const players = new Map();
const smooth = new Map();
const WS_URL = location.hostname === "localhost"
    ? "ws://localhost:8080"
    : "wss://snapaim.onrender.com";
let heartbeat = null;
function msgType(msg) {
    return msg?.t ?? msg?.type;
}
function wsSend(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return;
    ws.send(JSON.stringify(payload));
}
// ---------- JOIN ----------
nameInput.focus();
function startGame() {
    if (joined)
        return;
    joined = true;
    const clean = nameInput.value.trim().slice(0, 18);
    myName = clean.length ? clean : "Player";
    mouseX = window.innerWidth / 2;
    mouseY = window.innerHeight / 2;
    hudName.textContent = myName || "Loading...";
    hudHpText.textContent = "Connecting...";
    hpBarInner.style.width = "100%";
    hpBarInner.style.background = "hsl(120,85%,55%)";
    menu.style.display = "none";
    hudBottom.style.display = "flex";
    connect();
}
nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        startGame();
    }
});
// ---------- SOCKET ----------
function connect() {
    ws = new WebSocket(WS_URL);
    ws.addEventListener("open", () => {
        heartbeat = window.setInterval(() => {
            wsSend({ t: "move", x: mouseX, y: mouseY });
        }, 50);
        wsSend({ t: "setName", name: myName });
        wsSend({ t: "move", x: mouseX, y: mouseY });
    });
    ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        const t = msgType(msg);
        // ---------- WELCOME ----------
        if (t === "welcome") {
            if (typeof msg.id === "string")
                myId = msg.id;
            if (typeof msg.hitRadius === "number")
                hitRadius = msg.hitRadius;
            if (typeof msg.maxHp === "number") {
                myMaxHp = msg.maxHp;
            }
            return;
        }
        // ---------- STATE ----------
        if (t === "state") {
            const list = msg.players;
            if (!Array.isArray(list))
                return;
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
            // Recover myId if welcome was missed
            if (!myId) {
                for (const p of list) {
                    if ((p.name ?? "").trim() === myName) {
                        myId = p.id;
                        break;
                    }
                }
            }
            // Lock maxHp ONLY from server
            if (myId) {
                const me = list.find((p) => p.id === myId);
                if (me &&
                    typeof me.maxHp === "number" &&
                    me.maxHp > 0) {
                    myMaxHp = me.maxHp;
                }
            }
            const alive = new Set(list.map((p) => p.id));
            for (const id of smooth.keys())
                if (!alive.has(id))
                    smooth.delete(id);
            for (const id of players.keys())
                if (!alive.has(id))
                    players.delete(id);
            return;
        }
        // ---------- HIT ----------
        if (t === "hit") {
            const to = msg.to;
            const hp = msg.hp;
            if (typeof to === "string" && typeof hp === "number") {
                const target = players.get(to);
                if (target)
                    target.hp = hp;
            }
        }
    });
    ws.addEventListener("close", () => {
        if (heartbeat)
            clearInterval(heartbeat);
        heartbeat = null;
    });
}
// ---------- INPUT ----------
let lastMoveSend = 0;
const MOVE_SEND_MS = 50;
window.addEventListener("pointermove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    const now = performance.now();
    if (ws && ws.readyState === WebSocket.OPEN && now - lastMoveSend >= MOVE_SEND_MS) {
        lastMoveSend = now;
        wsSend({ t: "move", x: mouseX, y: mouseY });
    }
});
window.addEventListener("pointerdown", (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return;
    wsSend({ t: "click", x: e.clientX, y: e.clientY });
});
// ---------- RENDER ----------
function drawOtherHealthBar(x, y, p) {
    if (!myMaxHp)
        return;
    const w = 70;
    const h = 15;
    const pct = Math.max(0, Math.min(1, p.hp / myMaxHp));
    const bx = x - w / 2;
    const by = y - hitRadius - 24;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(bx, by, w, h);
    const color = pct > 0.6 ? "#3ddc84" :
        pct > 0.3 ? "#f5c542" :
            "#ff4d4d";
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, w * pct, h);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    ctx.strokeRect(bx, by, w, h);
    const text = Math.round(p.hp).toLocaleString();
    ctx.font = "9px Ubuntu, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(text, bx + w / 2, by + h / 2);
    ctx.fillStyle = "#fff";
    ctx.fillText(text, bx + w / 2, by + h / 2);
}
function updateBottomHud() {
    if (!joined)
        return;
    if (!myId || !myMaxHp) {
        hudName.textContent = myName || "Loading...";
        hudHpText.textContent = "Connecting...";
        return;
    }
    const me = players.get(myId);
    if (!me)
        return;
    hudName.textContent = me.name || myName;
    hudHpText.textContent = `${me.hp.toLocaleString()} / ${myMaxHp.toLocaleString()} HP`;
    const pct = Math.max(0, Math.min(1, me.hp / myMaxHp));
    hpBarInner.style.width = `${pct * 100}%`;
    hpBarInner.style.background = `hsl(${pct * 120},85%,55%)`;
}
function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const SMOOTH = 0.18;
    for (const s of smooth.values()) {
        s.x += (s.tx - s.x) * SMOOTH;
        s.y += (s.ty - s.y) * SMOOTH;
    }
    for (const p of players.values()) {
        if (p.id === myId)
            continue;
        const s = smooth.get(p.id);
        const x = s ? s.x : p.x;
        const y = s ? s.y : p.y;
        ctx.beginPath();
        ctx.arc(x, y, hitRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(90,240,150,0.95)";
        ctx.fill();
        drawOtherHealthBar(x, y, p);
    }
    updateBottomHud();
    requestAnimationFrame(loop);
}
loop();
