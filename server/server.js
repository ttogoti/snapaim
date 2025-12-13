import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

const PORT = Number(process.env.PORT || 8080);

const START_HP = 100000;
const HIT_RADIUS = 22;
const HISTORY_MS = 250;
const SPEED_WINDOW_MS = 120;

const MAX_DAMAGE = 100000;

// if we haven't heard from a client in this long, kick them
const STALE_MS = 8000;

const players = new Map();

function now() { return Date.now(); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function pruneHistory(p, t) {
  const cutoff = t - HISTORY_MS;
  while (p.history.length && p.history[0].t < cutoff) p.history.shift();
}

function speedPxPerSec(p, tEnd) {
  const tStart = tEnd - SPEED_WINDOW_MS;
  let first = null, last = null;

  for (const s of p.history) {
    if (s.t >= tStart && !first) first = s;
    if (s.t <= tEnd) last = s;
  }
  if (!first || !last || last.t === first.t) return 0;

  const d = dist(first.p, last.p);
  const dt = (last.t - first.t) / 1000;
  return dt > 0 ? d / dt : 0;
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}

function snapshot() {
  return Array.from(players.values()).map(p => ({
    id: p.id,
    name: p.name,
    x: p.pos.x,
    y: p.pos.y,
    hp: p.hp
  }));
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  const id = randomUUID();
  const t = now();

  const p = {
    id,
    ws,
    name: "Player",
    pos: { x: 0, y: 0 },
    hp: START_HP,
    history: [{ t, p: { x: 0, y: 0 } }],
    lastSeen: t
  };

  players.set(id, p);

  ws.send(JSON.stringify({ t: "welcome", id, hp: START_HP, hitRadius: HIT_RADIUS }));
  broadcast({ t: "state", players: snapshot() });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }

    const tNow = now();
    p.lastSeen = tNow;

    if (msg.t === "setName") {
      if (typeof msg.name !== "string") return;
      const clean = msg.name.trim().slice(0, 18);
      p.name = clean.length ? clean : "Player";
      broadcast({ t: "state", players: snapshot() });
      return;
    }

    if (msg.t === "move") {
      if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
      p.pos = { x: msg.x, y: msg.y };
      p.history.push({ t: tNow, p: { x: msg.x, y: msg.y } });
      pruneHistory(p, tNow);
      return;
    }

    if (msg.t === "click") {
      const spd = speedPxPerSec(p, tNow);
      let dmg = Math.round(spd);
      dmg = clamp(dmg, 0, MAX_DAMAGE);

      const clickPos = (typeof msg.x === "number" && typeof msg.y === "number")
        ? { x: msg.x, y: msg.y }
        : p.pos;

      let target = null;
      let best = Infinity;

      for (const other of players.values()) {
        if (other.id === p.id || other.hp <= 0) continue;
        const d = dist(other.pos, clickPos);
        if (d <= HIT_RADIUS && d < best) {
          best = d;
          target = other;
        }
      }
      if (!target) return;

      target.hp = Math.max(0, target.hp - dmg);

      broadcast({ t: "hit", from: p.id, to: target.id, dmg, hp: target.hp });
    }
  });

  ws.on("close", () => {
    players.delete(id);
    broadcast({ t: "state", players: snapshot() });
  });
});

// state updates
setInterval(() => broadcast({ t: "state", players: snapshot() }), 1000 / 30);

// stale cleanup
setInterval(() => {
  const t = now();
  let changed = false;
  for (const [id, p] of players) {
    if (t - p.lastSeen > STALE_MS) {
      try { p.ws.terminate?.(); } catch {}
      players.delete(id);
      changed = true;
    }
  }
  if (changed) broadcast({ t: "state", players: snapshot() });
}, 1000);

console.log(`Server running on ws://localhost:${PORT}`);
