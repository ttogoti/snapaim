import http from "http";
import { WebSocketServer, WebSocket } from "ws";

type Player = {
   id: string;
   name: string;
   x: number;
   y: number;
   hp: number;
   maxHp: number;
   roomId: string;
   lastClickT: number;
};

type Room = {
   id: string;
   players: Map<string, Player>;
};

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const CAPACITY = 8;

const MAX_HP = 100000;
const HIT_RADIUS = 22;

const STATE_TICK_MS = 50;

const server = http.createServer();
const wss = new WebSocketServer({ server });

const rooms = new Map<string, Room>();
let nextRoomN = 1;

function rid() {
   const r = nextRoomN++;
   return `room-${r}`;
}

function pid() {
   return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

function now() {
   return Date.now();
}

function msgType(m: any) {
   return m?.t ?? m?.type;
}

function wsSend(ws: WebSocket, payload: any) {
   if (ws.readyState !== WebSocket.OPEN) return;
   const out = { ...payload };
   if (out.t && !out.type) out.type = out.t;
   if (out.type && !out.t) out.t = out.type;
   ws.send(JSON.stringify(out));
}

function getOrCreateRoom(): Room {
   for (const r of rooms.values()) {
      if (r.players.size < CAPACITY) return r;
   }
   const id = rid();
   const room: Room = { id, players: new Map() };
   rooms.set(id, room);
   return room;
}

function roomCountBroadcast(room: Room) {
   const count = room.players.size;
   for (const p of room.players.values()) {
      const ws = sockets.get(p.id);
      if (ws) wsSend(ws, { t: "room", roomId: room.id, roomCount: count });
   }
}

function stateBroadcast(room: Room) {
   const list = Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      hp: p.hp,
      maxHp: p.maxHp
   }));
   for (const p of room.players.values()) {
      const ws = sockets.get(p.id);
      if (ws) wsSend(ws, { t: "state", roomId: room.id, roomCount: room.players.size, players: list });
   }
}

const sockets = new Map<string, WebSocket>();

function removePlayer(p: Player) {
   const room = rooms.get(p.roomId);
   sockets.delete(p.id);
   if (!room) return;
   room.players.delete(p.id);
   if (room.players.size === 0) rooms.delete(room.id);
   else roomCountBroadcast(room);
}

function applyHit(attacker: Player, target: Player, damage: number) {
   target.hp = Math.max(0, target.hp - damage);
   const room = rooms.get(attacker.roomId);
   if (!room) return;

   for (const p of room.players.values()) {
      const ws = sockets.get(p.id);
      if (!ws) continue;
      wsSend(ws, { t: "hit", from: attacker.id, to: target.id, hp: target.hp });
   }

   if (target.hp <= 0) {
      const wsDead = sockets.get(target.id);
      if (wsDead) wsSend(wsDead, { t: "dead", byName: attacker.name });
      removePlayer(target);
   }
}

function findPlayerAt(room: Room, x: number, y: number, excludeId: string) {
   let best: Player | null = null;
   let bestD = Infinity;
   for (const p of room.players.values()) {
      if (p.id === excludeId) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= HIT_RADIUS && d < bestD) {
         best = p;
         bestD = d;
      }
   }
   return best;
}

wss.on("connection", (ws) => {
   const room = getOrCreateRoom();
   const id = pid();

   const player: Player = {
      id,
      name: id.slice(0, 4),
      x: 0,
      y: 0,
      hp: MAX_HP,
      maxHp: MAX_HP,
      roomId: room.id,
      lastClickT: 0
   };

   room.players.set(id, player);
   sockets.set(id, ws);

   wsSend(ws, {
      t: "welcome",
      id,
      hitRadius: HIT_RADIUS,
      hp: player.hp,
      maxHp: player.maxHp,
      roomId: room.id,
      roomCount: room.players.size
   });

   roomCountBroadcast(room);

   ws.on("message", (buf) => {
      let msg: any;
      try {
         msg = JSON.parse(buf.toString());
      } catch {
         return;
      }

      const t = msgType(msg);
      const me = rooms.get(player.roomId)?.players.get(player.id);
      if (!me) return;

      if (t === "setName") {
         const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 18) : "";
         if (name.length) me.name = name;
         return;
      }

      if (t === "move") {
         const x = typeof msg.x === "number" ? msg.x : me.x;
         const y = typeof msg.y === "number" ? msg.y : me.y;
         me.x = x;
         me.y = y;
         return;
      }

      if (t === "click") {
         const roomNow = rooms.get(me.roomId);
         if (!roomNow) return;

         const x = typeof msg.x === "number" ? msg.x : me.x;
         const y = typeof msg.y === "number" ? msg.y : me.y;

         const speed = typeof msg.speed === "number" ? Math.max(0, msg.speed) : 0;
         const damage = Math.floor(speed);

         const tNow = now();
         if (tNow - me.lastClickT < 80) return;
         me.lastClickT = tNow;

         if (damage <= 0) return;

         const target = findPlayerAt(roomNow, x, y, me.id);
         if (!target) return;

         applyHit(me, target, damage);
         return;
      }
   });

   ws.on("close", () => {
      const me = rooms.get(player.roomId)?.players.get(player.id);
      if (me) removePlayer(me);
   });

   ws.on("error", () => {
      const me = rooms.get(player.roomId)?.players.get(player.id);
      if (me) removePlayer(me);
   });
});

setInterval(() => {
   for (const room of rooms.values()) stateBroadcast(room);
}, STATE_TICK_MS);

server.listen(PORT);
