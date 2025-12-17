import http from "http";
import crypto from "crypto";
import { WebSocketServer } from "ws";

type Player = {
	id: string;
	name: string;
	x: number;
	y: number;
	hp: number;
	maxHp: number;
	level: number;
	killsInLevel: number;
	killsNeeded: number;
	damage: number;
	lastMoveT: number;
	lastMoveX: number;
	lastMoveY: number;
	speed: number;
	lastSpeedPenaltyT: number;
	lastSeen: number;
	comboBase: number;
	comboMult: number;
};

const PORT = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
	res.writeHead(200, { "content-type": "text/plain" });
	res.end("ok");
});

const wss = new WebSocketServer({ server });

const players = new Map<string, Player>();
const sockets = new Map<any, string>();

const HIT_RADIUS = 22;
const SPEED_MAX = 2000;

const SPEED_PENALTY_DMG = 4999;
const SPEED_PENALTY_COOLDOWN_MS = 2000;

const MAXHP_STEP = 5000;

const STALE_MS = 6000;

const LEVEL_DMG_START = 30000;

function now() {
	return Date.now();
}

function id4(id: string) {
	return id.slice(0, 4);
}

function safeName(n: any) {
	const s = typeof n === "string" ? n.trim() : "";
	const c = s.slice(0, 18);
	return c.length ? c : "Player";
}

function send(ws: any, obj: any) {
	if (!ws || ws.readyState !== 1) return;
	ws.send(JSON.stringify(obj));
}

function broadcast(obj: any) {
	const msg = JSON.stringify(obj);
	for (const client of wss.clients) {
		if ((client as any).readyState === 1) (client as any).send(msg);
	}
}

function leaderboardTop10() {
	const arr = Array.from(players.values()).map(p => ({
		id: p.id,
		name: p.name || id4(p.id),
		damage: p.damage
	}));
	arr.sort((a, b) => b.damage - a.damage);
	return arr.slice(0, 10);
}

function applyDamageProgress(attacker: Player, dealt: number) {
	attacker.killsInLevel += dealt;

	while (attacker.killsInLevel >= attacker.killsNeeded) {
		const pct = attacker.maxHp > 0 ? attacker.hp / attacker.maxHp : 1;

		attacker.killsInLevel -= attacker.killsNeeded;
		attacker.level += 1;
		attacker.killsNeeded = Math.max(1, Math.ceil(attacker.killsNeeded * 1.5));

		attacker.maxHp += MAXHP_STEP;
		attacker.hp = Math.max(1, Math.round(pct * attacker.maxHp));
	}
}

function applyDamage(attacker: Player, target: Player, dmg: number, combo: number, fromId?: string) {
	const before = target.hp;
	const applied = Math.max(0, Math.min(before, Math.floor(dmg)));
	if (applied <= 0) return;

	target.hp = Math.max(0, before - applied);
	attacker.damage += applied;

	applyDamageProgress(attacker, applied);

	broadcast({ t: "hit", from: fromId ?? attacker.id, to: target.id, hp: target.hp, maxHp: target.maxHp, dmg: applied, combo });

	if (target.hp <= 0) {
		broadcast({ t: "hit", from: attacker.id, to: attacker.id, hp: attacker.hp, maxHp: attacker.maxHp });

		const byName = attacker.name || id4(attacker.id);
		const toWs = Array.from(sockets.entries()).find(([, pid]) => pid === target.id)?.[0];
		if (toWs) send(toWs, { t: "dead", byName });
	}
}

function getPlayerFromWs(ws: any) {
	const id = sockets.get(ws);
	if (!id) return null;
	return players.get(id) || null;
}

function removeByWs(ws: any) {
	const pid = sockets.get(ws);
	if (!pid) return;
	sockets.delete(ws);
	players.delete(pid);
}

function rngInt(a: number, b: number) {
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	return lo + Math.floor(Math.random() * (hi - lo + 1));
}

wss.on("connection", (ws) => {
	const id = crypto.randomBytes(8).toString("hex");
	const t = now();

	const p: Player = {
		id,
		name: id4(id),
		x: 0,
		y: 0,
		hp: 10000,
		maxHp: 10000,
		level: 1,
		killsInLevel: 0,
		killsNeeded: LEVEL_DMG_START,
		damage: 0,
		lastMoveT: t,
		lastMoveX: 0,
		lastMoveY: 0,
		speed: 0,
		lastSpeedPenaltyT: 0,
		lastSeen: t,
		comboBase: 0,
		comboMult: 1
	};

	players.set(id, p);
	sockets.set(ws, id);

	send(ws, {
		t: "welcome",
		id,
		hitRadius: HIT_RADIUS,
		speedMax: SPEED_MAX,
		roomCount: players.size,
		hp: p.hp,
		maxHp: p.maxHp,
		level: p.level,
		killsInLevel: p.killsInLevel,
		killsNeeded: p.killsNeeded
	});

	ws.on("message", (buf) => {
		let msg: any;
		try { msg = JSON.parse(String(buf)); } catch { return; }

		const type = msg?.t ?? msg?.type;
		const me = getPlayerFromWs(ws);
		if (!me) return;

		me.lastSeen = now();

		if (type === "setName") {
			me.name = safeName(msg?.name);
			return;
		}

		if (type === "move") {
			const x = Number(msg?.x);
			const y = Number(msg?.y);
			if (!isFinite(x) || !isFinite(y)) return;

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
			if (tNow - me.lastSpeedPenaltyT < SPEED_PENALTY_COOLDOWN_MS) return;
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
			if (!isFinite(x) || !isFinite(y)) return;

			let best: Player | null = null;
			let bestD = Infinity;

			for (const other of players.values()) {
				if (other.id === me.id) continue;
				if (other.hp <= 0) continue;

				const d = Math.hypot(other.x - x, other.y - y);
				if (d <= HIT_RADIUS && d < bestD) {
					bestD = d;
					best = other;
				}
			}

			if (!best) {
				me.comboBase = 0;
				me.comboMult = 1;
				return;
			}

			if (me.comboBase <= 0) me.comboBase = rngInt(250, 300);
			me.comboMult = Math.max(2, me.comboMult * 2);

			const dmg = me.comboBase * me.comboMult;
			applyDamage(me, best, dmg, me.comboMult);

			return;
		}
	});

	ws.on("close", () => {
		removeByWs(ws);
	});

	ws.on("error", () => {
		removeByWs(ws);
	});
});

setInterval(() => {
	const list = Array.from(players.values()).map(p => ({
		id: p.id,
		name: p.name,
		x: p.x,
		y: p.y,
		hp: p.hp,
		maxHp: p.maxHp,
		level: p.level,
		killsInLevel: p.killsInLevel,
		killsNeeded: p.killsNeeded,
		damage: p.damage
	}));

	broadcast({
		t: "state",
		roomCount: players.size,
		players: list,
		leaderboard: leaderboardTop10()
	});
}, 50);

setInterval(() => {
	const tNow = now();

	for (const [ws, pid] of sockets.entries()) {
		const p = players.get(pid);
		if (!p) {
			try { ws.terminate?.(); } catch {}
			sockets.delete(ws);
			continue;
		}

		if (tNow - p.lastSeen > STALE_MS) {
			players.delete(pid);
			sockets.delete(ws);
			try { ws.terminate?.(); } catch {}
		}
	}
}, 1500);

server.listen(PORT);
