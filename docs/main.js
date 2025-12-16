"use strict";
const $ = (id) => document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d");
const nicknameEl = $("nickname");
const regionEl = $("region");
const playBtn = $("playBtn");
const practiceBtn = $("practiceBtn");
const stopBtn = $("stopBtn");
const restartBtn = $("restartBtn");
const scoreEl = $("score");
const accEl = $("acc");
const streakEl = $("streak");
const centerMsg = $("centerMsg");
const sessionName = $("sessionName");
const sessionRegion = $("sessionRegion");
const wsDot = $("wsDot");
const wsText = $("wsText");
const pingDot = $("pingDot");
const pingText = $("pingText");
const settingsBtn = $("settingsBtn");
const drawer = $("drawer");
const closeDrawer = $("closeDrawer");
const resetBtn = $("resetBtn");
const sens = $("sens");
const tSize = $("tSize");
const spawn = $("spawn");
const shake = $("shake");
const sound = $("sound");
const sensVal = $("sensVal");
const tSizeVal = $("tSizeVal");
const spawnVal = $("spawnVal");
const shakeVal = $("shakeVal");
const soundVal = $("soundVal");
const toast = $("toast");
const toastText = $("toastText");
const socialBtn = $("socialBtn");
const STORAGE_KEY = "snapaim.settings.v1";
const STATE_KEY = "snapaim.state.v1";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const now = () => performance.now();
const defaultSettings = {
    sens: 1.15,
    targetSize: 28,
    spawnRate: 1.05,
    shake: 0.65,
    sound: 0.45
};
const loadSettings = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return { ...defaultSettings };
        const parsed = JSON.parse(raw);
        return {
            sens: clamp(Number(parsed.sens ?? defaultSettings.sens), 0.2, 3),
            targetSize: clamp(Number(parsed.targetSize ?? defaultSettings.targetSize), 10, 56),
            spawnRate: clamp(Number(parsed.spawnRate ?? defaultSettings.spawnRate), 0.45, 1.6),
            shake: clamp(Number(parsed.shake ?? defaultSettings.shake), 0, 1),
            sound: clamp(Number(parsed.sound ?? defaultSettings.sound), 0, 1)
        };
    }
    catch {
        return { ...defaultSettings };
    }
};
const showToast = (msg) => {
    toastText.textContent = msg;
    toast.classList.add("show");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => toast.classList.remove("show"), 1100);
};
let settings = loadSettings();
const saveSettings = (s) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    showToast("Saved");
};
const bindSettingsUI = () => {
    sens.value = String(settings.sens);
    tSize.value = String(settings.targetSize);
    spawn.value = String(settings.spawnRate);
    shake.value = String(settings.shake);
    sound.value = String(settings.sound);
    const sync = () => {
        settings.sens = Number(sens.value);
        settings.targetSize = Number(tSize.value);
        settings.spawnRate = Number(spawn.value);
        settings.shake = Number(shake.value);
        settings.sound = Number(sound.value);
        sensVal.textContent = settings.sens.toFixed(2);
        tSizeVal.textContent = `${Math.round(settings.targetSize)}`;
        spawnVal.textContent = settings.spawnRate.toFixed(2);
        shakeVal.textContent = settings.shake.toFixed(2);
        soundVal.textContent = settings.sound.toFixed(2);
        saveSettings(settings);
    };
    sens.addEventListener("input", sync);
    tSize.addEventListener("input", sync);
    spawn.addEventListener("input", sync);
    shake.addEventListener("input", sync);
    sound.addEventListener("input", sync);
    sensVal.textContent = settings.sens.toFixed(2);
    tSizeVal.textContent = `${Math.round(settings.targetSize)}`;
    spawnVal.textContent = settings.spawnRate.toFixed(2);
    shakeVal.textContent = settings.shake.toFixed(2);
    soundVal.textContent = settings.sound.toFixed(2);
};
const openDrawer = () => drawer.classList.add("open");
const closeDrawerFn = () => drawer.classList.remove("open");
const toggleDrawer = () => drawer.classList.toggle("open");
settingsBtn.addEventListener("click", toggleDrawer);
closeDrawer.addEventListener("click", closeDrawerFn);
document.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
        e.preventDefault();
        toggleDrawer();
    }
    if (e.key === "Escape")
        closeDrawerFn();
});
socialBtn.addEventListener("click", () => {
    showToast("Socials coming soon");
});
let audio = null;
const ensureAudio = () => {
    if (audio)
        return audio;
    const ctxA = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctxA.createGain();
    master.gain.value = settings.sound;
    master.connect(ctxA.destination);
    audio = { ctx: ctxA, master };
    return audio;
};
const blip = (freq, durMs, gain) => {
    if (settings.sound <= 0.001)
        return;
    const a = ensureAudio();
    if (a.ctx.state === "suspended")
        a.ctx.resume();
    a.master.gain.value = settings.sound;
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g);
    g.connect(a.master);
    const t0 = a.ctx.currentTime;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
    o.start(t0);
    o.stop(t0 + durMs / 1000);
};
let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
let w = 0;
let h = 0;
const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    w = Math.floor(rect.width * dpr);
    h = Math.floor(rect.height * dpr);
    canvas.width = w;
    canvas.height = h;
};
window.addEventListener("resize", resize);
resize();
let running = false;
let pointerLocked = false;
let aimX = 0;
let aimY = 0;
let velX = 0;
let velY = 0;
let score = 0;
let shots = 0;
let hits = 0;
let streak = 0;
let target = null;
let nextSpawnAt = 0;
let shakeT = 0;
let shakeMag = 0;
const rand = (a, b) => a + Math.random() * (b - a);
const spawnTarget = (t) => {
    const r = settings.targetSize * dpr;
    const pad = r + 18 * dpr;
    const x = rand(pad, w - pad);
    const y = rand(pad, h - pad);
    target = {
        x,
        y,
        r,
        born: t,
        life: rand(850, 1350) / settings.spawnRate,
        pulse: rand(0, Math.PI * 2)
    };
};
const resetStats = () => {
    score = 0;
    shots = 0;
    hits = 0;
    streak = 0;
    updateHud();
    localStorage.removeItem(STATE_KEY);
    showToast("Stats reset");
};
resetBtn.addEventListener("click", resetStats);
const saveState = () => {
    const s = { score, shots, hits, streak };
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
};
const loadState = () => {
    try {
        const raw = localStorage.getItem(STATE_KEY);
        if (!raw)
            return;
        const s = JSON.parse(raw);
        score = Number(s.score ?? 0);
        shots = Number(s.shots ?? 0);
        hits = Number(s.hits ?? 0);
        streak = Number(s.streak ?? 0);
    }
    catch { }
};
const updateHud = () => {
    scoreEl.textContent = String(score);
    streakEl.textContent = String(streak);
    const acc = shots > 0 ? Math.round((hits / shots) * 100) : 0;
    accEl.textContent = `${acc}%`;
};
loadState();
updateHud();
const setCenterMessage = (big, small) => {
    const bigEl = centerMsg.querySelector(".big");
    const smallEl = centerMsg.querySelector(".small");
    bigEl.textContent = big;
    smallEl.textContent = small;
};
const setSession = (name, region) => {
    sessionName.textContent = name;
    sessionRegion.textContent = region.toUpperCase();
};
const getNickname = () => {
    const v = nicknameEl.value.trim();
    if (!v)
        return "guest";
    return v.slice(0, 16);
};
const getRegion = () => regionEl.value || "eu";
const startGame = () => {
    running = true;
    setCenterMessage("Go.", "Click to lock pointer. Hit targets fast. Space to stop. R to restart.");
    centerMsg.style.opacity = "0";
    setTimeout(() => (centerMsg.style.opacity = "1"), 40);
    nextSpawnAt = 0;
};
const stopGame = () => {
    running = false;
    target = null;
    setCenterMessage("Paused.", "Press Space to start. Tab settings. Esc unlock pointer.");
};
const restartGame = () => {
    target = null;
    score = 0;
    shots = 0;
    hits = 0;
    streak = 0;
    updateHud();
    saveState();
    startGame();
    showToast("Restarted");
};
stopBtn.addEventListener("click", stopGame);
restartBtn.addEventListener("click", restartGame);
playBtn.addEventListener("click", () => {
    const name = getNickname();
    const reg = getRegion();
    setSession(name, reg);
    joinRegion(reg, name);
    startGame();
});
practiceBtn.addEventListener("click", () => {
    const name = getNickname();
    const reg = getRegion();
    setSession(name, reg);
    joinRegion(reg, name);
    startGame();
});
document.addEventListener("keydown", (e) => {
    if (e.key === " ") {
        e.preventDefault();
        running ? stopGame() : startGame();
    }
    if (e.key.toLowerCase() === "r")
        restartGame();
});
canvas.addEventListener("click", async () => {
    if (!pointerLocked) {
        try {
            await canvas.requestPointerLock();
        }
        catch { }
        return;
    }
    fire();
});
document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked)
        setCenterMessage("Unlocked.", "Click to lock pointer. Esc unlocks. Space starts/stops.");
});
document.addEventListener("mousemove", (e) => {
    if (!pointerLocked)
        return;
    const scale = settings.sens * dpr;
    velX = e.movementX * scale;
    velY = e.movementY * scale;
    aimX += velX;
    aimY += velY;
    aimX = clamp(aimX, 0, w);
    aimY = clamp(aimY, 0, h);
});
const initAim = () => {
    aimX = w * 0.5;
    aimY = h * 0.5;
};
initAim();
const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
};
const fire = () => {
    if (!running)
        return;
    shots++;
    const t = now();
    const hit = target && dist2(aimX, aimY, target.x, target.y) <= target.r * target.r;
    if (hit) {
        hits++;
        streak++;
        const bonus = 10 + Math.min(15, Math.floor(streak / 4));
        score += bonus;
        shakeT = 1;
        shakeMag = (6 + Math.min(16, streak)) * settings.shake * dpr;
        blip(520 + Math.min(420, streak * 10), 65, 0.22);
        spawnTarget(t);
    }
    else {
        streak = 0;
        score = Math.max(0, score - 2);
        blip(220, 70, 0.12);
    }
    updateHud();
    saveState();
};
const wsState = {
    ws: null,
    pingT0: 0,
    pingMs: 0,
    alive: false,
    presence: 0
};
const setWsBadge = (ok, text) => {
    wsText.textContent = text;
    wsDot.classList.toggle("good", ok);
    wsDot.classList.toggle("bad", !ok);
};
const setPing = (ms) => {
    if (ms == null) {
        pingText.textContent = "Ping �";
        pingDot.classList.remove("good");
        pingDot.classList.remove("bad");
        return;
    }
    pingText.textContent = `Ping ${Math.round(ms)}ms`;
    const good = ms < 70;
    pingDot.classList.toggle("good", good);
    pingDot.classList.toggle("bad", !good);
};
const connectWS = () => {
    try {
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${location.host}/ws`);
        wsState.ws = ws;
        setWsBadge(false, "Connecting�");
        setPing(null);
        ws.onopen = () => {
            wsState.alive = true;
            setWsBadge(true, "Connected");
            ws.send(JSON.stringify({ t: "hello", v: 1 }));
            schedulePing();
        };
        ws.onclose = () => {
            wsState.alive = false;
            setWsBadge(false, "Offline");
            setPing(null);
            wsState.ws = null;
            window.setTimeout(connectWS, 800);
        };
        ws.onerror = () => {
            wsState.alive = false;
            setWsBadge(false, "Error");
        };
        ws.onmessage = (ev) => {
            let msg = null;
            try {
                msg = JSON.parse(ev.data);
            }
            catch {
                return;
            }
            if (!msg || typeof msg.t !== "string")
                return;
            if (msg.t === "pong") {
                wsState.pingMs = now() - wsState.pingT0;
                setPing(wsState.pingMs);
                schedulePing();
            }
            if (msg.t === "presence") {
                const n = Number(msg.n ?? 0);
                wsState.presence = Math.max(0, Math.floor(n));
            }
        };
    }
    catch {
        setWsBadge(false, "Offline");
        window.setTimeout(connectWS, 1000);
    }
};
const schedulePing = () => {
    window.clearTimeout(schedulePing._t);
    schedulePing._t = window.setTimeout(() => {
        if (!wsState.ws || wsState.ws.readyState !== WebSocket.OPEN)
            return;
        wsState.pingT0 = now();
        wsState.ws.send(JSON.stringify({ t: "ping", ts: wsState.pingT0 }));
    }, 1500);
};
const joinRegion = (region, name) => {
    if (!wsState.ws || wsState.ws.readyState !== WebSocket.OPEN)
        return;
    wsState.ws.send(JSON.stringify({ t: "join", region, name }));
};
connectWS();
bindSettingsUI();
let last = now();
const drawBg = (t) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "rgba(124,92,255,0.10)");
    g.addColorStop(0.55, "rgba(0,212,255,0.06)");
    g.addColorStop(1, "rgba(255,61,154,0.05)");
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = "white";
    for (let i = 0; i < 18; i++) {
        const x = (t * 0.01 + i * 123.45) % w;
        const y = (t * 0.013 + i * 77.7) % h;
        ctx.beginPath();
        ctx.arc(x, y, 110 * dpr, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
};
const drawCrosshair = () => {
    const r = 8 * dpr;
    ctx.save();
    ctx.translate(aimX, aimY);
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 1.4 * dpr;
    ctx.globalAlpha = pointerLocked ? 0.92 : 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14 * dpr, 0);
    ctx.lineTo(-6 * dpr, 0);
    ctx.moveTo(14 * dpr, 0);
    ctx.lineTo(6 * dpr, 0);
    ctx.moveTo(0, -14 * dpr);
    ctx.lineTo(0, -6 * dpr);
    ctx.moveTo(0, 14 * dpr);
    ctx.lineTo(0, 6 * dpr);
    ctx.stroke();
    ctx.restore();
};
const drawTarget = (t) => {
    if (!target)
        return;
    const age = t - target.born;
    const k = clamp(age / 180, 0, 1);
    const out = 1 - Math.pow(1 - k, 2);
    const fade = clamp(1 - age / target.life, 0, 1);
    const pul = 1 + Math.sin(t * 0.007 + target.pulse) * 0.05;
    const rr = target.r * pul * lerp(0.75, 1, out);
    ctx.save();
    ctx.globalAlpha = 0.92 * fade;
    const glow = ctx.createRadialGradient(target.x, target.y, rr * 0.2, target.x, target.y, rr * 1.9);
    glow.addColorStop(0, "rgba(0,212,255,0.26)");
    glow.addColorStop(0.5, "rgba(124,92,255,0.18)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(target.x, target.y, rr * 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();
    ctx.arc(target.x, target.y, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = 1.4 * dpr;
    ctx.beginPath();
    ctx.arc(target.x, target.y, rr * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
};
const tick = (t) => {
    const dt = Math.min(34, t - last);
    last = t;
    if (!pointerLocked) {
        aimX = lerp(aimX, w * 0.5, 0.05);
        aimY = lerp(aimY, h * 0.5, 0.05);
    }
    if (running) {
        if (!target) {
            if (t >= nextSpawnAt) {
                spawnTarget(t);
                nextSpawnAt = t + 60;
            }
        }
        else {
            const age = t - target.born;
            if (age >= target.life) {
                streak = 0;
                updateHud();
                spawnTarget(t);
            }
        }
    }
    ctx.save();
    drawBg(t);
    if (shakeT > 0.001) {
        shakeT = Math.max(0, shakeT - dt / 260);
        const s = shakeT * shakeT;
        const sx = (Math.random() - 0.5) * 2 * shakeMag * s;
        const sy = (Math.random() - 0.5) * 2 * shakeMag * s;
        ctx.translate(sx, sy);
    }
    drawTarget(t);
    drawCrosshair();
    ctx.restore();
    requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
stopGame();
