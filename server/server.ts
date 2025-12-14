import { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

type Vec2 = { x: number; y: number };
type Sample = { t: number; p: Vec2 };

type Player = {
  id: string;
  ws: WebSocket;
  pos: Vec2;
  hp: number;
  history: Sample[]; // rolling window for speed
};

type WebSocket = import("ws").WebSocket;

const PORT = Number(process.env.PORT ?? 8080);

// Gameplay constants
const START_HP = 10_000;
const HIT_RADIUS = 22;            // cursor hitbox radius (px)
const HISTORY_MS = 250;           // keep ~250ms of movement samples
const SPEED_WINDOW_MS = 120;      // compute speed over last ~120ms
const MAX_REPORTED_COORD = 100000;

// Safety: if you truly want unlimited damage, set this very high.
// Keeping a cap prevents trivial cheating (client can spam teleports).
const MAX_SPEED_FOR_DAMAGE = 50_000; // px/s

const wss = new WebSocketServer({ port: PORT });
const players = new Map<string, Player>();

function nowMs() { return Date.now(); }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function dist(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.y - b.y); }

function pruneHistory(p: Player, t: number) {
  const cutoff = t - HISTORY_MS;
  while (p.history.length && p.history[0].t < cutoff) p.history.shift();
}

function computeSpeedPxPerSec(p: Player, tEnd: number) {
  const tStart = tEnd - SPEED_WINDOW_MS;

  // pick first sample >= tStart and last sample <= tEnd
  let first: Sample | null = null;
  let last: Sample | null = null;

  for (const s of p.history) {
    if (s.t >= tStart && !first) first = s;
    if (s.t <= tEnd) last = s;
  }
  if (!first || !last || last.t === first.t) return 0;

  const d = dist(first.p, last.p);
  const dt = (last.t - first.t) / 1000;
  return dt > 0 ? d / dt : 0;
}

function send(ws: WebSocket, obj: any) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(obj: any) {
  const msg = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(msg);
  }
}

function snapshot() {
  return Array.from(players.values()).map(p => ({
    id: p.id,
    x: p.pos.x,
    y: p.pos.y,
    hp: p.hp
  }));
}

wss.on("connection", (ws) => {
  const id = randomUUID();
  const t = nowMs();

  const p: Player = {
    id,
    ws,
    pos: { x: 0, y: 0 },
    hp: START_HP,
    history: [{ t, p: { x: 0, y: 0 } }]
  };

  players.set(id, p);
  send(ws, { t: "welcome", id, hp: START_HP, hitRadius: HIT_RADIUS });

  // Tell everyone someone joined
  broadcast({ t: "state", players: snapshot() });

  ws.on("message", (raw: Buffer) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString("utf8")); } catch { return; }

    const tNow = nowMs();

    if (msg.t === "move") {
      if (typeof msg.x !== "number" || typeof msg.y !== "number") return;

      const x = clamp(msg.x, -MAX_REPORTED_COORD, MAX_REPORTED_COORD);
      const y = clamp(msg.y, -MAX_REPORTED_COORD, MAX_REPORTED_COORD);

      p.pos = { x, y };
      p.history.push({ t: tNow, p: { x, y } });
      pruneHistory(p, tNow);
      return;
    }

    if (msg.t === "click") {
      // On click, server computes damage from server-tracked speed.
      const spd = computeSpeedPxPerSec(p, tNow);
      const dmg = Math.round(clamp(spd, 0, MAX_SPEED_FOR_DAMAGE)); // damage = speed

      // find a target whose hitbox contains the click point (or attacker pos if no click coords)
      let clickPos: Vec2 = p.pos;
      if (typeof msg.x === "number" && typeof msg.y === "number") {
        clickPos = {
          x: clamp(msg.x, -MAX_REPORTED_COORD, MAX_REPORTED_COORD),
          y: clamp(msg.y, -MAX_REPORTED_COORD, MAX_REPORTED_COORD)
        };
      }

      // pick nearest target within HIT_RADIUS of clickPos
      let target: Player | null = null;
      let best = Infinity;

      for (const other of players.values()) {
        if (other.id === p.id) continue;
        if (other.hp <= 0) continue;

        const d = dist(other.pos, clickPos);
        if (d <= HIT_RADIUS && d < best) {
          best = d;
          target = other;
        }
      }

      if (!target) return;

      target.hp = Math.max(0, target.hp - dmg);

      broadcast({
        t: "hit",
        from: p.id,
        to: target.id,
        dmg,
        hp: target.hp
      });

      return;
    }
  });

  ws.on("close", () => {
    players.delete(id);
    broadcast({ t: "state", players: snapshot() });
  });
});

setInterval(() => {
  broadcast({ t: "state", players: snapshot() });
}, 1000 / 30);

console.log(`Server running on ws://localhost:${PORT}`);
