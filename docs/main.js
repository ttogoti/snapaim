"use strict";
console.log("BUILD_MARKER_1");
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
// server-authoritative max HP for MY player (set ONLY from welcome/state)
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
    // keep compatibility between {t:"..."} and {type:"..."}
    const out = { ...payload };
    if (out.t && !out.type)
        out.type = out.t;
    if (out.type && !out.t)
        out.t = out.type;
    ws.send(JSON.stringify(out));
}
// -------- Respawn / Reset --------
function resetToMenu() {
    // stop heartbeat
    if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
    }
    // close ws
    try {
        ws?.close();
    }
    catch { }
    ws = null;
    // reset state
    joined = false;
    myId = null;
    myMaxHp = null;
    players.clear();
    smooth.clear();
    // UI back to menu
    hudBottom.style.display = "none";
    menu.style.display = "flex";
    // reset HUD text
    hudName.textContent = "";
    hudHpText.textContent = "";
    hpBarInner.style.width = "0%";
    nameInput.value = "";
    nameInput.focus();
}
// --- Join/Menu ---
nameInput.focus();
function startGame() {
    if (joined)
        return;
    joined = true;
    const clean = nameInput.value.trim().slice(0, 18);
    myName = clean.length ? clean : "Player";
    mouseX = window.innerWidth / 2;
    mouseY = window.innerHeight / 2;
    // UI feedback immediately
    hudName.textContent = myName || "Loading...";
    hudHpText.textContent = "Connecting...";
    hpBarInner.style.width = "100%";
    hpBarInner.style.backgroundImage = "none";
    hpBarInner.style.background = "hsl(120, 85%, 55%)";
    hpBarInner.style.opacity = "1";
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
// --- WebSocket ---
function connect() {
    ws = new WebSocket(WS_URL);
    ws.addEventListener("open", () => {
        // heartbeat keeps server position fresh
        heartbeat = window.setInterval(() => {
            wsSend({ t: "move", x: mouseX, y: mouseY });
        }, 50);
        wsSend({ t: "setName", name: myName });
        wsSend({ t: "move", x: mouseX, y: mouseY });
    });
    ws.addEventListener("message", (ev) => {
        const msg = JSON.parse(ev.data);
        const t = msgType(msg);
        // Server tells you you're dead -> reset to menu (respawn flow)
        if (t === "dead") {
            resetToMenu();
            return;
        }
        if (t === "welcome") {
            myId = typeof msg.id === "string" ? msg.id : myId;
            hitRadius = typeof msg.hitRadius === "number" ? msg.hitRadius : hitRadius;
            // IMPORTANT: max HP is ONLY set from server
            if (typeof msg.maxHp === "number" && msg.maxHp > 0) {
                myMaxHp = msg.maxHp;
            }
            else if (typeof msg.hp === "number" && msg.hp > 0 && myMaxHp === null) {
                // fallback only if server didn't send maxHp (older server)
                myMaxHp = msg.hp;
            }
            wsSend({ t: "setName", name: myName });
            wsSend({ t: "move", x: mouseX, y: mouseY });
            return;
        }
        if (t === "state") {
            const list = msg.players;
            if (!Array.isArray(list))
                return;
            // update maps
            for (const p of list) {
                players.set(p.id, p);
                // init smoothing for others
                if (p.id !== myId) {
                    const s = smooth.get(p.id);
                    if (!s)
                        smooth.set(p.id, { x: p.x, y: p.y, tx: p.x, ty: p.y });
                    else {
                        s.tx = p.x;
                        s.ty = p.y;
                    }
                }
            }
            // If we have myId, lock myMaxHp from my own state (server authority)
            if (myId) {
                const meFromList = list.find((p) => p.id === myId);
                if (meFromList) {
                    if (typeof meFromList.maxHp === "number" && meFromList.maxHp > 0) {
                        myMaxHp = meFromList.maxHp;
                    }
                    else if (myMaxHp === null && typeof meFromList.hp === "number" && meFromList.hp > 0) {
                        // fallback for older servers
                        myMaxHp = meFromList.hp;
                    }
                }
            }
            // cleanup vanished
            const alive = new Set(list.map((p) => p.id));
            for (const id of smooth.keys())
                if (!alive.has(id))
                    smooth.delete(id);
            for (const id of players.keys())
                if (!alive.has(id))
                    players.delete(id);
            // Fallback: if your HP hits 0 (or you disappear), reset to menu
            if (myId) {
                const me = players.get(myId);
                if (!me || me.hp <= 0) {
                    resetToMenu();
                    return;
                }
            }
            return;
        }
        if (t === "hit") {
            const to = msg.to ?? msg.target ?? msg.id;
            const hp = msg.hp ?? msg.newHp ?? msg.health;
            if (typeof to === "string" && typeof hp === "number") {
                const target = players.get(to);
                if (target)
                    target.hp = hp;
            }
            return;
        }
    });
    ws.addEventListener("close", () => {
        if (heartbeat !== null) {
            clearInterval(heartbeat);
            heartbeat = null;
        }
        // If we were in-game and connection drops (server killed us or restart), go back to menu.
        if (joined) {
            resetToMenu();
        }
    });
    ws.addEventListener("error", () => {
        // treat errors like disconnects
        if (joined)
            resetToMenu();
    });
}
// --- Input ---
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
// --- Rendering helpers ---
function maxHpForPlayer(p) {
    // for other players, prefer their server-provided maxHp; otherwise fallback to myMaxHp; otherwise 1
    if (typeof p.maxHp === "number" && p.maxHp > 0)
        return p.maxHp;
    if (myMaxHp !== null && myMaxHp > 0)
        return myMaxHp;
    return 1;
}
function drawOtherHealthBar(x, y, p) {
    ctx.save();
    const maxHp = maxHpForPlayer(p);
    const w = 70;
    const h = 15;
    const pct = Math.max(0, Math.min(1, p.hp / maxHp));
    const bx = x - w / 2;
    const by = y - hitRadius - 24;
    // background
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(bx, by, w, h);
    // color based on HP %
    let color;
    if (pct > 0.6)
        color = "#3ddc84";
    else if (pct > 0.3)
        color = "#f5c542";
    else
        color = "#ff4d4d";
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, w * pct, h);
    // thick outline (same vibe as player name outline)
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    ctx.strokeRect(bx, by, w, h);
    // HP text inside bar
    const text = Math.round(p.hp).toLocaleString();
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
    if (!joined)
        return;
    if (!myId) {
        hudName.textContent = myName || "Loading...";
        hudHpText.textContent = "Connecting...";
        return;
    }
    const me = players.get(myId);
    if (!me)
        return;
    // IMPORTANT: bottom HUD uses myMaxHp (server authority)
    const maxHp = (myMaxHp !== null && myMaxHp > 0) ? myMaxHp : maxHpForPlayer(me);
    hudName.textContent = me.name || myName || "Player";
    hudHpText.textContent = `${Math.round(me.hp).toLocaleString()} / ${Math.round(maxHp).toLocaleString()} HP`;
    const pct = Math.max(0, Math.min(1, me.hp / maxHp));
    hpBarInner.style.width = `${pct * 100}%`;
    const hue = pct * 120;
    hpBarInner.style.backgroundImage = "none";
    hpBarInner.style.background = `hsl(${hue}, 85%, 55%)`;
    hpBarInner.style.opacity = "1";
}
function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // smooth other players
    const SMOOTH = 0.18;
    for (const s of smooth.values()) {
        s.x += (s.tx - s.x) * SMOOTH;
        s.y += (s.ty - s.y) * SMOOTH;
    }
    // draw everyone except you
    for (const p of players.values()) {
        if (myId && p.id === myId)
            continue;
        const s = smooth.get(p.id);
        const x = s ? s.x : p.x;
        const y = s ? s.y : p.y;
        // hitbox circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, hitRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(90,240,150,0.95)";
        ctx.fill();
        // name label under (outlined)
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
        // other player's health bar
        drawOtherHealthBar(x, y, p);
    }
    updateBottomHud();
    requestAnimationFrame(loop);
}
loop();
