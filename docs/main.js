"use strict";
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const menu = document.getElementById("menu");
const nameInput = document.getElementById("nameInput");
const playBtn = document.getElementById("playBtn");
const hudBottom = document.getElementById("hudBottom");
const levelBarInner = document.getElementById("levelBarInner");
const levelBarText = document.getElementById("levelBarText");
const hpBarInner = document.getElementById("hpBarInner");
const hpBarText = document.getElementById("hpBarText");
const speedVert = document.getElementById("speedVert");
const speedVertFill = document.getElementById("speedVertFill");
const deathScreen = document.getElementById("deathScreen");
const deathBig = document.getElementById("deathBig");
const continueBtn = document.getElementById("continueBtn");
const leaderboard = document.getElementById("leaderboard");
const leaderboardBody = document.getElementById("leaderboardBody");
let roomText = document.getElementById("roomText");
function ensureRoomText() {
    if (roomText)
        return;
    const d = document.createElement("div");
    d.id = "roomText";
    d.style.position = "fixed";
    d.style.top = "10px";
    d.style.left = "50%";
    d.style.transform = "translateX(-50%)";
    d.style.fontWeight = "800";
    d.style.fontSize = "16px";
    d.style.color = "rgba(0,0,0,0.75)";
    d.style.zIndex = "9999";
    d.style.pointerEvents = "none";
    d.style.display = "none";
    d.textContent = "";
    document.body.appendChild(d);
    roomText = d;
}
function showRoomText() {
    ensureRoomText();
    if (roomText)
        roomText.style.display = "block";
}
function hideRoomText() {
    if (roomText) {
        roomText.style.display = "none";
        roomText.textContent = "";
    }
}
function setRoomTextCount(count) {
    ensureRoomText();
    if (!roomText)
        return;
    roomText.textContent = count === null ? "Connecting..." : `People in room: ${count}`;
}
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();
let myId = null;
let myName = "";
let hitRadius = 22;
let isDead = false;
let ws = null;
let joined = false;
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
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
    const out = { ...payload };
    if (out.t && !out.type)
        out.type = out.t;
    if (out.type && !out.t)
        out.t = out.type;
    ws.send(JSON.stringify(out));
}
let SPEED_MAX = 2000;
let lastSpeedT = performance.now();
let lastSpeedX = mouseX;
let lastSpeedY = mouseY;
let smoothSpeed = 0;
let joinTimeMs = performance.now();
const SPEED_GRACE_MS = 650;
let lastSpeedingSend = 0;
const SPEEDING_SEND_MS = 140;
function resetSpeedSampler() {
    lastSpeedT = performance.now();
    lastSpeedX = mouseX;
    lastSpeedY = mouseY;
    smoothSpeed = 0;
    lastSpeedingSend = 0;
}
function updateSpeedFromMouse() {
    const tNow = performance.now();
    const dt = tNow - lastSpeedT;
    if (dt <= 0)
        return;
    const dx = mouseX - lastSpeedX;
    const dy = mouseY - lastSpeedY;
    const d = Math.hypot(dx, dy);
    const instant = (d / dt) * 1000;
    const alpha = 0.18;
    smoothSpeed += (instant - smoothSpeed) * alpha;
    lastSpeedT = tNow;
    lastSpeedX = mouseX;
    lastSpeedY = mouseY;
    if (!joined || isDead)
        return;
    if ((tNow - joinTimeMs) <= SPEED_GRACE_MS)
        return;
    if (smoothSpeed >= SPEED_MAX) {
        const now = performance.now();
        if (!ws || ws.readyState !== WebSocket.OPEN)
            return;
        if (now - lastSpeedingSend < SPEEDING_SEND_MS)
            return;
        lastSpeedingSend = now;
        wsSend({ t: "speeding" });
    }
}
let lastKillerName = null;
function stopConnection() {
    if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
    }
    try {
        ws?.close();
    }
    catch { }
    ws = null;
}
function showDeathScreen(killedBy) {
    if (isDead)
        return;
    isDead = true;
    stopConnection();
    hideRoomText();
    hudBottom.style.display = "none";
    leaderboard.style.display = "none";
    speedVert.style.display = "none";
    menu.style.display = "none";
    deathBig.textContent = killedBy;
    deathScreen.style.display = "flex";
}
function resetToMenu() {
    stopConnection();
    hideRoomText();
    isDead = false;
    joined = false;
    myId = null;
    myMaxHp = null;
    lastKillerName = null;
    players.clear();
    smooth.clear();
    resetSpeedSampler();
    deathScreen.style.display = "none";
    hudBottom.style.display = "none";
    leaderboard.style.display = "none";
    speedVert.style.display = "none";
    menu.style.display = "flex";
    levelBarInner.style.width = "0%";
    levelBarText.textContent = "Level: 1";
    hpBarInner.style.width = "0%";
    hpBarText.textContent = "HP: 0/0";
    nameInput.value = "";
    nameInput.focus();
}
continueBtn.addEventListener("click", () => {
    resetToMenu();
});
nameInput.focus();
function startGame() {
    if (joined)
        return;
    joined = true;
    const clean = nameInput.value.trim().slice(0, 18);
    myName = clean.length ? clean : "Player";
    mouseX = window.innerWidth / 2;
    mouseY = window.innerHeight / 2;
    joinTimeMs = performance.now();
    resetSpeedSampler();
    deathScreen.style.display = "none";
    menu.style.display = "none";
    hudBottom.style.display = "flex";
    leaderboard.style.display = "block";
    speedVert.style.display = "block";
    showRoomText();
    setRoomTextCount(null);
    connect();
}
playBtn.addEventListener("click", () => startGame());
nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        startGame();
    }
});
function pickRoomCount(msg, list) {
    const rc = typeof msg?.roomCount === "number" ? msg.roomCount :
        typeof msg?.count === "number" ? msg.count :
            typeof msg?.playersInRoom === "number" ? msg.playersInRoom :
                typeof msg?.room?.count === "number" ? msg.room.count :
                    null;
    if (typeof rc === "number" && isFinite(rc))
        return rc;
    if (Array.isArray(list))
        return list.length;
    return null;
}
function setLeaderboard(rows) {
    if (!rows || !Array.isArray(rows)) {
        leaderboardBody.innerHTML = "";
        return;
    }
    leaderboardBody.innerHTML = "";
    for (let i = 0; i < Math.min(10, rows.length); i++) {
        const r = rows[i];
        const row = document.createElement("div");
        row.className = "lbRow" + (myId && r.id === myId ? " lbMe" : "");
        const left = document.createElement("div");
        left.className = "lbName";
        left.textContent = `${i + 1}. ${String(r?.name ?? "Player")}`;
        const right = document.createElement("div");
        right.className = "lbDmg";
        right.textContent = `${Math.round(Number(r?.damage ?? 0)).toLocaleString()}`;
        row.appendChild(left);
        row.appendChild(right);
        leaderboardBody.appendChild(row);
    }
}
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
        if (t === "dead") {
            const byName = typeof msg.byName === "string" ? msg.byName : null;
            showDeathScreen(byName ?? lastKillerName ?? "Unknown");
            return;
        }
        if (t === "welcome") {
            myId = typeof msg.id === "string" ? msg.id : myId;
            hitRadius = typeof msg.hitRadius === "number" ? msg.hitRadius : hitRadius;
            if (typeof msg.speedMax === "number" && msg.speedMax > 0)
                SPEED_MAX = msg.speedMax;
            if (typeof msg.maxHp === "number" && msg.maxHp > 0) {
                myMaxHp = msg.maxHp;
            }
            else if (typeof msg.hp === "number" && msg.hp > 0 && myMaxHp === null) {
                myMaxHp = msg.hp;
            }
            const rc = pickRoomCount(msg, null);
            setRoomTextCount(rc);
            wsSend({ t: "setName", name: myName });
            wsSend({ t: "move", x: mouseX, y: mouseY });
            return;
        }
        if (t === "state") {
            const list = msg.players;
            if (!Array.isArray(list))
                return;
            const rc = pickRoomCount(msg, list);
            setRoomTextCount(rc);
            const lb = msg.leaderboard;
            setLeaderboard(Array.isArray(lb) ? lb : null);
            for (const p of list) {
                players.set(p.id, p);
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
            if (myId) {
                const meFromList = list.find((p) => p.id === myId);
                if (meFromList) {
                    if (typeof meFromList.maxHp === "number" && meFromList.maxHp > 0) {
                        myMaxHp = meFromList.maxHp;
                    }
                    else if (myMaxHp === null && typeof meFromList.hp === "number" && meFromList.hp > 0) {
                        myMaxHp = meFromList.hp;
                    }
                }
            }
            const alive = new Set(list.map((p) => p.id));
            for (const id of smooth.keys())
                if (!alive.has(id))
                    smooth.delete(id);
            for (const id of players.keys())
                if (!alive.has(id))
                    players.delete(id);
            if (myId) {
                const me = players.get(myId);
                if (!me || me.hp <= 0) {
                    showDeathScreen(lastKillerName ?? "Unknown");
                    return;
                }
            }
            return;
        }
        if (t === "hit") {
            const to = msg.to ?? msg.target ?? msg.id;
            const hp = msg.hp ?? msg.newHp ?? msg.health;
            const maxHp = msg.maxHp ?? msg.maxHealth;
            if (typeof to === "string") {
                const target = players.get(to);
                if (target) {
                    if (typeof hp === "number")
                        target.hp = hp;
                    if (typeof maxHp === "number" && maxHp > 0)
                        target.maxHp = maxHp;
                }
            }
            if (myId && to === myId) {
                const from = msg.from;
                if (typeof from === "string") {
                    if (from === "speed") {
                        lastKillerName = "Speed";
                    }
                    else {
                        const killer = players.get(from);
                        lastKillerName =
                            (killer?.name && killer.name.trim().length)
                                ? killer.name
                                : from.slice(0, 4);
                    }
                }
                if (typeof hp === "number" && hp <= 0) {
                    showDeathScreen(lastKillerName ?? "Unknown");
                }
            }
            return;
        }
        if (t === "room") {
            const rc = pickRoomCount(msg, null);
            setRoomTextCount(rc);
            return;
        }
    });
    ws.addEventListener("close", () => {
        if (heartbeat !== null) {
            clearInterval(heartbeat);
            heartbeat = null;
        }
        if (joined && deathScreen.style.display !== "flex") {
            resetToMenu();
        }
    });
    ws.addEventListener("error", () => {
        if (joined && deathScreen.style.display !== "flex")
            resetToMenu();
    });
}
let lastMoveSend = 0;
const MOVE_SEND_MS = 50;
window.addEventListener("pointermove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    updateSpeedFromMouse();
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
function maxHpForPlayer(p) {
    if (typeof p.maxHp === "number" && p.maxHp > 0)
        return p.maxHp;
    if (myMaxHp !== null && myMaxHp > 0)
        return myMaxHp;
    return 1;
}
function roundedRect(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}
function hpHueGreenToRed(pct) {
    const t = Math.max(0, Math.min(1, pct));
    return 120 * t;
}
function speedHueYellowToRed(pct) {
    const t = Math.max(0, Math.min(1, pct));
    return 60 - 60 * t;
}
function updateSpeedVert() {
    const pct = Math.max(0, Math.min(1, smoothSpeed / SPEED_MAX));
    speedVertFill.style.height = `${pct * 100}%`;
    const h = speedHueYellowToRed(pct);
    speedVertFill.style.background = `hsl(${h}, 95%, 55%)`;
}
function updateBottomBars() {
    if (!joined || !myId) {
        hpBarInner.style.width = "0%";
        hpBarText.textContent = "HP: 0/0";
        levelBarInner.style.width = "0%";
        levelBarText.textContent = "Level: 1";
        return;
    }
    const me = players.get(myId);
    if (!me)
        return;
    const maxHp = maxHpForPlayer(me);
    const hpPct = Math.max(0, Math.min(1, me.hp / maxHp));
    hpBarInner.style.width = `${hpPct * 100}%`;
    const hh = hpHueGreenToRed(hpPct);
    hpBarInner.style.background = `hsl(${hh}, 95%, 45%)`;
    hpBarText.textContent = `HP: ${Math.round(me.hp).toLocaleString()}/${Math.round(maxHp).toLocaleString()}`;
    const level = typeof me.level === "number" && isFinite(me.level) ? me.level : 1;
    const inLvl = typeof me.killsInLevel === "number" && isFinite(me.killsInLevel) ? me.killsInLevel : 0;
    const need = typeof me.killsNeeded === "number" && isFinite(me.killsNeeded) && me.killsNeeded > 0 ? me.killsNeeded : 3;
    const pct = Math.max(0, Math.min(1, inLvl / need));
    if (pct <= 0) {
        levelBarInner.style.width = "14px";
    }
    else {
        levelBarInner.style.width = `${pct * 100}%`;
    }
    levelBarInner.style.background = "linear-gradient(to bottom, #7fb6ff 0%, #7fb6ff 66.666%, #2f76ff 66.666%, #2f76ff 100%)";
    levelBarText.textContent = `Level: ${level}`;
}
function drawOtherHpBar(x, y, p) {
    const maxHp = maxHpForPlayer(p);
    const pct = Math.max(0, Math.min(1, p.hp / maxHp));
    const w = 70;
    const h = 12;
    const r = 6;
    const bx = x - w / 2;
    const by = y - hitRadius - 24;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.20)";
    roundedRect(bx, by, w, h, r);
    ctx.fill();
    const fw = w * pct;
    if (fw > 0) {
        const hh = hpHueGreenToRed(pct);
        ctx.fillStyle = `hsl(${hh}, 95%, 45%)`;
        roundedRect(bx, by, fw, h, r);
        ctx.fill();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    roundedRect(bx, by, w, h, r);
    ctx.stroke();
    ctx.restore();
}
function drawOtherLabel(x, y, p) {
    const name = (p.name && p.name.trim().length) ? p.name : p.id.slice(0, 4);
    const baseY = y + hitRadius + 14;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "12px Ubuntu, system-ui";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    ctx.strokeText(name, x, baseY);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(name, x, baseY);
    ctx.restore();
}
function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const SMOOTH = 0.18;
    for (const s of smooth.values()) {
        s.x += (s.tx - s.x) * SMOOTH;
        s.y += (s.ty - s.y) * SMOOTH;
    }
    for (const p of players.values()) {
        if (myId && p.id === myId)
            continue;
        const s = smooth.get(p.id);
        const x = s ? s.x : p.x;
        const y = s ? s.y : p.y;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, hitRadius, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 70, 70, 0.95)";
        ctx.fill();
        ctx.restore();
        drawOtherHpBar(x, y, p);
        drawOtherLabel(x, y, p);
    }
    updateSpeedVert();
    updateBottomBars();
    requestAnimationFrame(loop);
}
hideRoomText();
loop();
