"use strict";
const canvas = document.getElementById("c");
const ctx = canvas?.getContext("2d") ?? null;
const menu = document.getElementById("menu");
const nameInput = document.getElementById("nameInput");
const playBtn = document.getElementById("playBtn");
const hudBottom = document.getElementById("hudBottom");
const speedHud = document.getElementById("speedHud");
const hpFill = document.getElementById("hpFill");
const hpText = document.getElementById("hpText");
const levelFill = document.getElementById("levelFill");
const levelText = document.getElementById("levelText");
const speedFill = document.getElementById("speedFill");
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
    if (!canvas)
        return;
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
const SPEEDING_SEND_MS = 120;
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
    if (hudBottom)
        hudBottom.style.display = "none";
    if (speedHud)
        speedHud.style.display = "none";
    if (leaderboard)
        leaderboard.style.display = "none";
    if (menu)
        menu.style.display = "none";
    if (deathBig)
        deathBig.textContent = killedBy;
    if (deathScreen)
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
    if (deathScreen)
        deathScreen.style.display = "none";
    if (hudBottom)
        hudBottom.style.display = "none";
    if (speedHud)
        speedHud.style.display = "none";
    if (leaderboard)
        leaderboard.style.display = "none";
    if (menu)
        menu.style.display = "flex";
    if (hpFill)
        hpFill.style.width = "0%";
    if (hpText)
        hpText.textContent = "HP: 0/0";
    if (levelFill)
        levelFill.style.width = "0%";
    if (levelText)
        levelText.textContent = "Level: 1";
    if (speedFill)
        speedFill.style.height = "0%";
    if (nameInput) {
        nameInput.value = "";
        nameInput.focus();
    }
}
if (continueBtn) {
    continueBtn.addEventListener("click", () => {
        resetToMenu();
    });
}
if (nameInput)
    nameInput.focus();
const CONTROL_RADIUS = 110;
const BODY_SPEED = 520;
let bodyX = window.innerWidth / 2;
let bodyY = window.innerHeight / 2;
let pointerLocked = false;
let wDown = false;
let aDown = false;
let sDown = false;
let dDown = false;
function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
}
function clampMouseToCircle() {
    const dx = mouseX - bodyX;
    const dy = mouseY - bodyY;
    const len = Math.hypot(dx, dy);
    if (len <= CONTROL_RADIUS || len <= 0)
        return;
    const k = CONTROL_RADIUS / len;
    mouseX = bodyX + dx * k;
    mouseY = bodyY + dy * k;
}
function clampBodyToCanvas() {
    if (!canvas)
        return;
    bodyX = clamp(bodyX, 0, canvas.width);
    bodyY = clamp(bodyY, 0, canvas.height);
}
function startGame() {
    if (joined)
        return;
    joined = true;
    const clean = (nameInput?.value ?? "").trim().slice(0, 18);
    myName = clean.length ? clean : "Player";
    bodyX = window.innerWidth / 2;
    bodyY = window.innerHeight / 2;
    mouseX = bodyX;
    mouseY = bodyY;
    clampMouseToCircle();
    joinTimeMs = performance.now();
    resetSpeedSampler();
    if (deathScreen)
        deathScreen.style.display = "none";
    if (menu)
        menu.style.display = "none";
    if (hudBottom)
        hudBottom.style.display = "flex";
    if (speedHud)
        speedHud.style.display = "block";
    if (leaderboard)
        leaderboard.style.display = "block";
    showRoomText();
    setRoomTextCount(null);
    connect();
}
if (playBtn)
    playBtn.addEventListener("click", () => startGame());
if (nameInput) {
    nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            startGame();
        }
    });
}
window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "w")
        wDown = true;
    if (k === "a")
        aDown = true;
    if (k === "s")
        sDown = true;
    if (k === "d")
        dDown = true;
});
window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k === "w")
        wDown = false;
    if (k === "a")
        aDown = false;
    if (k === "s")
        sDown = false;
    if (k === "d")
        dDown = false;
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
    if (!leaderboardBody)
        return;
    if (!rows || !Array.isArray(rows)) {
        leaderboardBody.innerHTML = "";
        return;
    }
    leaderboardBody.innerHTML = "";
    for (let i = 0; i < Math.min(10, rows.length); i++) {
        const r = rows[i];
        const row = document.createElement("div");
        row.className = "lbRow";
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
document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
});
function connect() {
    ws = new WebSocket(WS_URL);
    ws.addEventListener("open", () => {
        heartbeat = window.setInterval(() => {
            wsSend({ t: "move", x: mouseX, y: mouseY, bx: bodyX, by: bodyY });
        }, 50);
        wsSend({ t: "setName", name: myName });
        wsSend({ t: "move", x: mouseX, y: mouseY, bx: bodyX, by: bodyY });
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
            wsSend({ t: "move", x: mouseX, y: mouseY, bx: bodyX, by: bodyY });
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
                    const bx = typeof p.bx === "number" && isFinite(p.bx) ? p.bx : p.x;
                    const by = typeof p.by === "number" && isFinite(p.by) ? p.by : p.y;
                    const s = smooth.get(p.id);
                    if (!s)
                        smooth.set(p.id, { x: p.x, y: p.y, tx: p.x, ty: p.y, bx, by, tbx: bx, tby: by });
                    else {
                        s.tx = p.x;
                        s.ty = p.y;
                        s.tbx = bx;
                        s.tby = by;
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
        if (joined && (!deathScreen || deathScreen.style.display !== "flex")) {
            resetToMenu();
        }
    });
    ws.addEventListener("error", () => {
        if (joined && (!deathScreen || deathScreen.style.display !== "flex"))
            resetToMenu();
    });
}
let lastMoveSend = 0;
const MOVE_SEND_MS = 50;
window.addEventListener("pointermove", (e) => {
    if (pointerLocked) {
        mouseX += e.movementX;
        mouseY += e.movementY;
    }
    else {
        mouseX = e.clientX;
        mouseY = e.clientY;
    }
    clampMouseToCircle();
    updateSpeedFromMouse();
    const now = performance.now();
    if (ws && ws.readyState === WebSocket.OPEN && now - lastMoveSend >= MOVE_SEND_MS) {
        lastMoveSend = now;
        wsSend({ t: "move", x: mouseX, y: mouseY, bx: bodyX, by: bodyY });
    }
});
window.addEventListener("pointerdown", (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return;
    clampMouseToCircle();
    wsSend({ t: "click", x: mouseX, y: mouseY });
});
function maxHpForPlayer(p) {
    if (typeof p.maxHp === "number" && p.maxHp > 0)
        return p.maxHp;
    if (myMaxHp !== null && myMaxHp > 0)
        return myMaxHp;
    return 1;
}
function hpHueGreenToRed(pct) {
    const t = Math.max(0, Math.min(1, pct));
    return 120 * t;
}
function speedHueYellowToRed(pct) {
    const t = Math.max(0, Math.min(1, pct));
    return 60 - 60 * t;
}
function updateHudBars() {
    if (!joined || isDead || !myId) {
        if (hpFill)
            hpFill.style.width = "0%";
        if (hpText)
            hpText.textContent = "HP: 0/0";
        if (levelFill)
            levelFill.style.width = "0%";
        if (levelText)
            levelText.textContent = "Level: 1";
        if (speedFill)
            speedFill.style.height = "0%";
        return;
    }
    const me = players.get(myId);
    if (!me)
        return;
    const maxHp = maxHpForPlayer(me);
    const hpPct = Math.max(0, Math.min(1, me.hp / maxHp));
    const spPct = Math.max(0, Math.min(1, smoothSpeed / SPEED_MAX));
    const hh = hpHueGreenToRed(hpPct);
    if (hpFill) {
        hpFill.style.width = `${hpPct * 100}%`;
        hpFill.style.background = `hsl(${hh}, 85%, 55%)`;
    }
    if (hpText) {
        hpText.textContent = `HP: ${Math.round(me.hp).toLocaleString()}/${Math.round(maxHp).toLocaleString()}`;
    }
    const level = typeof me.level === "number" && isFinite(me.level) ? me.level : 1;
    const inLvl = typeof me.killsInLevel === "number" && isFinite(me.killsInLevel) ? me.killsInLevel : 0;
    const need = typeof me.killsNeeded === "number" && isFinite(me.killsNeeded) && me.killsNeeded > 0 ? me.killsNeeded : 3;
    const lp = Math.max(0, Math.min(1, inLvl / need));
    if (levelFill) {
        levelFill.style.width = lp <= 0 ? "14px" : `${lp * 100}%`;
        levelFill.style.background = "linear-gradient(to bottom, #7fb6ff 0%, #7fb6ff 66.666%, #2f76ff 66.666%, #2f76ff 100%)";
    }
    if (levelText)
        levelText.textContent = `Level: ${level}`;
    const sh = speedHueYellowToRed(spPct);
    if (speedFill) {
        speedFill.style.height = `${spPct * 100}%`;
        speedFill.style.background = `linear-gradient(to bottom, hsl(${sh}, 95%, 52%) 0%, hsl(${sh}, 95%, 52%) 66.666%, hsl(${sh}, 95%, 40%) 66.666%, hsl(${sh}, 95%, 40%) 100%)`;
    }
}
function drawOtherLabel(x, y, p) {
    if (!ctx)
        return;
    const name = (p.name && p.name.trim().length) ? p.name : p.id.slice(0, 4);
    const kills = typeof p.kills === "number" ? p.kills : 0;
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
    const line2Y = baseY + 14;
    const numText = `${kills}`;
    const suffix = " kills";
    ctx.font = "800 12px Ubuntu, system-ui";
    const numW = ctx.measureText(numText).width;
    ctx.font = "12px Ubuntu, system-ui";
    const sufW = ctx.measureText(suffix).width;
    const totalW = numW + sufW;
    const startX = x - totalW / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    ctx.font = "800 12px Ubuntu, system-ui";
    ctx.strokeText(numText, startX + numW / 2, line2Y);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(numText, startX + numW / 2, line2Y);
    ctx.font = "12px Ubuntu, system-ui";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    ctx.strokeText(suffix, startX + numW + sufW / 2, line2Y);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(suffix, startX + numW + sufW / 2, line2Y);
    ctx.restore();
}
function drawOtherHealthbar(x, y, p) {
    if (!ctx)
        return;
    const maxHp = maxHpForPlayer(p);
    const hpVal = typeof p.hp === "number" && isFinite(p.hp) ? p.hp : maxHp;
    const hpPct = Math.max(0, Math.min(1, hpVal / maxHp));
    const hh = hpHueGreenToRed(hpPct);
    const w = 78;
    const h = 10;
    const r = 5;
    const bx = x - w / 2;
    const by = y - hitRadius - 22;
    const rr = (x, y, w, h, rad) => {
        const rr = Math.min(rad, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr);
        ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr);
        ctx.closePath();
    };
    ctx.save();
    rr(bx, by, w, h, r);
    ctx.fillStyle = "#000";
    ctx.fill();
    const fw = Math.max(0, w * hpPct);
    if (fw > 0) {
        rr(bx, by, fw, h, r);
        ctx.fillStyle = `hsl(${hh}, 85%, 55%)`;
        ctx.fill();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = "#000";
        ctx.fillRect(bx, by + h * 0.65, fw, h * 0.35);
        ctx.globalAlpha = 1;
    }
    rr(bx, by, w, h, r);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
}
function drawCircleOutline(x, y, r, color, lw) {
    if (!ctx)
        return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.restore();
}
function drawTriangle(x, y, ang, size, color) {
    if (!ctx)
        return;
    const r = size;
    const a0 = ang;
    const a1 = ang + (Math.PI * 2) / 3;
    const a2 = ang + (Math.PI * 4) / 3;
    const p0x = x + Math.cos(a0) * r;
    const p0y = y + Math.sin(a0) * r;
    const p1x = x + Math.cos(a1) * r;
    const p1y = y + Math.sin(a1) * r;
    const p2x = x + Math.cos(a2) * r;
    const p2y = y + Math.sin(a2) * r;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0x, p0y);
    ctx.lineTo(p1x, p1y);
    ctx.lineTo(p2x, p2y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}
function loop(t) {
    if (!canvas || !ctx)
        return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const SMOOTH = 0.18;
    for (const s of smooth.values()) {
        s.x += (s.tx - s.x) * SMOOTH;
        s.y += (s.ty - s.y) * SMOOTH;
        s.bx += (s.tbx - s.bx) * SMOOTH;
        s.by += (s.tby - s.by) * SMOOTH;
    }
    const dt = typeof loop._lt === "number" ? Math.min(0.05, (t - loop._lt) / 1000) : 0;
    loop._lt = t;
    const prevBX = bodyX;
    const prevBY = bodyY;
    if (joined && !isDead) {
        let vx = 0;
        let vy = 0;
        if (wDown)
            vy -= 1;
        if (sDown)
            vy += 1;
        if (aDown)
            vx -= 1;
        if (dDown)
            vx += 1;
        const len = Math.hypot(vx, vy);
        if (len > 0) {
            vx /= len;
            vy /= len;
        }
        bodyX += vx * BODY_SPEED * dt;
        bodyY += vy * BODY_SPEED * dt;
        clampBodyToCanvas();
        const dx = bodyX - prevBX;
        const dy = bodyY - prevBY;
        mouseX += dx;
        mouseY += dy;
        clampMouseToCircle();
    }
    for (const p of players.values()) {
        const isMe = myId && p.id === myId;
        const s = !isMe ? smooth.get(p.id) : null;
        const mx = isMe ? mouseX : (s ? s.x : p.x);
        const my = isMe ? mouseY : (s ? s.y : p.y);
        const bx = isMe
            ? bodyX
            : (s ? s.bx : (typeof p.bx === "number" && isFinite(p.bx) ? p.bx : p.x));
        const by = isMe
            ? bodyY
            : (s ? s.by : (typeof p.by === "number" && isFinite(p.by) ? p.by : p.y));
        if (!isMe) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(mx, my, hitRadius, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(235,70,70,0.95)";
            ctx.fill();
            ctx.restore();
        }
        drawCircleOutline(bx, by, CONTROL_RADIUS, "rgba(40,200,80,0.95)", 3);
        const ang = Math.atan2(my - by, mx - bx);
        drawTriangle(bx, by, ang, 18, "rgba(40,200,80,0.95)");
        if (!isMe) {
            drawOtherHealthbar(mx, my, p);
            drawOtherLabel(mx, my, p);
        }
    }
    updateHudBars();
    requestAnimationFrame(loop);
}
hideRoomText();
requestAnimationFrame(loop);
