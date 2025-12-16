import http from "http";
import crypto from "crypto";
import { WebSocketServer } from "ws";
const PORT = Number(process.env.PORT || 8080);
const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
});
const wss = new WebSocketServer({ server });
const players = new Map();
const sockets = new Map();
const lastPong = new Map();
const HIT_RADIUS = 22;
const SPEED_MAX = 2000;
const SPEED_MAX_CAP = 3500;
const SPEED_PENALTY_DMG = 4999;
const SPEED_PENALTY_COOLDOWN_MS = 2000;
const MAXHP_STEP = 5000;
function now() {
    return Date.now();
}
function id4(id) {
    return id.slice(0, 4);
}
function safeName(n) {
    const s = typeof n === "string" ? n.trim() : "";
    const c = s.slice(0, 18);
    return c.length ? c : "Player";
}
function send(ws, obj) {
    if (ws.readyState !== 1)
        return;
    ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const client of wss.clients) {
        if (client.readyState === 1)
            client.send(msg);
    }
}
function leaderboardTop10() {
    const arr = Array.from(players.values()).map(p => ({
        name: p.name || id4(p.id),
        damage: p.damage
    }));
    arr.sort((a, b) => b.damage - a.damage);
    return arr.slice(0, 10);
}
function killsNeededForLevel(level) {
    if (level <= 1)
        return 3;
    let need = 3;
    for (let l = 2; l <= level; l++)
        need = Math.floor(need * 1.5);
    return Math.max(1, need);
}
function applyLevelUp(p) {
    const pct = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    p.maxHp += MAXHP_STEP;
    p.hp = Math.max(1, Math.round(pct * p.maxHp));
}
function applyDamage(attacker, target, dmg) {
    const before = target.hp;
    const applied = Math.max(0, Math.min(before, Math.floor(dmg)));
    if (applied <= 0)
        return;
    target.hp = Math.max(0, before - applied);
    attacker.damage += applied;
    broadcast({ t: "hit", from: attacker.id, to: target.id, hp: target.hp, maxHp: target.maxHp });
    if (target.hp > 0)
        return;
    attacker.kills += 1;
    attacker.killsInLevel += 1;
    if (attacker.killsInLevel >= attacker.killsNeeded) {
        attacker.killsInLevel = 0;
        attacker.level += 1;
        attacker.killsNeeded = killsNeededForLevel(attacker.level);
        applyLevelUp(attacker);
        broadcast({ t: "hit", from: attacker.id, to: attacker.id, hp: attacker.hp, maxHp: attacker.maxHp });
    }
    const byName = attacker.name || id4(attacker.id);
    const toWs = Array.from(sockets.entries()).find(([, pid]) => pid === target.id)?.[0];
    if (toWs)
        send(toWs, { t: "dead", byName });
}
function getPlayerFromWs(ws) {
    const id = sockets.get(ws);
    if (!id)
        return null;
    return players.get(id) || null;
}
wss.on("connection", (ws) => {
    const id = crypto.randomBytes(8).toString("hex");
    const t = now();
    const p = {
        id,
        name: id4(id),
        x: 0,
        y: 0,
        hp: 10000,
        maxHp: 10000,
        kills: 0,
        damage: 0,
        level: 1,
        killsInLevel: 0,
        killsNeeded: 3,
        lastMoveT: t,
        lastMoveX: 0,
        lastMoveY: 0,
        speed: 0,
        lastSpeedPenaltyT: 0,
        lastSeen: t
    };
    players.set(id, p);
    sockets.set(ws, id);
    lastPong.set(ws, t);
    try {
        ws.on("pong", () => {
            lastPong.set(ws, now());
        });
    }
    catch { }
    send(ws, { t: "welcome", id, hitRadius: HIT_RADIUS, speedMax: SPEED_MAX, roomCount: players.size });
    ws.on("message", (buf) => {
        let msg;
        try {
            msg = JSON.parse(String(buf));
        }
        catch {
            return;
        }
        const type = msg?.t ?? msg?.type;
        const me = getPlayerFromWs(ws);
        if (!me)
            return;
        me.lastSeen = now();
        if (type === "setName") {
            me.name = safeName(msg?.name);
            return;
        }
        if (type === "move") {
            const x = Number(msg?.x);
            const y = Number(msg?.y);
            if (!isFinite(x) || !isFinite(y))
                return;
            const tNow = now();
            const dt = Math.max(1, tNow - me.lastMoveT);
            const dx = x - me.lastMoveX;
            const dy = y - me.lastMoveY;
            const dist = Math.hypot(dx, dy);
            me.speed = (dist / dt) * 1000;
            me.lastMoveT = tNow;
            me.lastMoveX = x;
            me.lastMoveY = y;
            me.x = x;
            me.y = y;
            return;
        }
        if (type === "speeding") {
            const tNow = now();
            if (tNow - me.lastSpeedPenaltyT < SPEED_PENALTY_COOLDOWN_MS)
                return;
            me.lastSpeedPenaltyT = tNow;
            me.hp = Math.max(0, me.hp - SPEED_PENALTY_DMG);
            broadcast({ t: "hit", from: "speed", to: me.id, hp: me.hp, maxHp: me.maxHp });
            if (me.hp <= 0) {
                send(ws, { t: "dead", byName: "Speed" });
            }
            return;
        }
        if (type === "click") {
            const x = Number(msg?.x);
            const y = Number(msg?.y);
            if (!isFinite(x) || !isFinite(y))
                return;
            let best = null;
            let bestD = Infinity;
            for (const other of players.values()) {
                if (other.id === me.id)
                    continue;
                if (other.hp <= 0)
                    continue;
                const d = Math.hypot(other.x - x, other.y - y);
                if (d <= HIT_RADIUS && d < bestD) {
                    bestD = d;
                    best = other;
                }
            }
            if (!best)
                return;
            const dmg = Math.max(1, Math.floor(Math.min(me.speed, SPEED_MAX_CAP)));
            applyDamage(me, best, dmg);
            return;
        }
    });
    ws.on("close", () => {
        const pid = sockets.get(ws);
        if (pid)
            players.delete(pid);
        sockets.delete(ws);
        lastPong.delete(ws);
    });
    ws.on("error", () => { });
});
setInterval(() => {
    const t = now();
    for (const ws of Array.from(lastPong.keys())) {
        const lp = lastPong.get(ws) ?? 0;
        if (t - lp > 12000) {
            try {
                ws.terminate();
            }
            catch { }
            const pid = sockets.get(ws);
            if (pid)
                players.delete(pid);
            sockets.delete(ws);
            lastPong.delete(ws);
        }
        else {
            try {
                ws.ping();
            }
            catch { }
        }
    }
}, 3000);
setInterval(() => {
    const list = Array.from(players.values()).map(p => ({
        id: p.id,
        name: p.name,
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: p.maxHp,
        kills: p.kills,
        damage: p.damage,
        level: p.level,
        killsInLevel: p.killsInLevel,
        killsNeeded: p.killsNeeded
    }));
    broadcast({
        t: "state",
        roomCount: players.size,
        players: list,
        leaderboard: leaderboardTop10()
    });
}, 50);
server.listen(PORT);
