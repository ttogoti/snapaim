console.log("BUILD_MARKER_1");
const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const menu = document.getElementById("menu") as HTMLDivElement;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;

const hudBottom = document.getElementById("hudBottom") as HTMLDivElement;
const hudName = document.getElementById("hudName") as HTMLDivElement;
const hudHpText = document.getElementById("hudHpText") as HTMLDivElement;
const hpBarInner = document.getElementById("hpBarInner") as HTMLDivElement;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

type PlayerState = {
  id: string;
  name?: string;
  x: number;
  y: number;
  hp: number;
  maxHp?: number;
};

let myId: string | null = null;
let myName = "";
let hitRadius = 22;

let ws: WebSocket | null = null;
let joined = false;

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

const players = new Map<string, PlayerState>();

type Smooth = { x: number; y: number; tx: number; ty: number };
const smooth = new Map<string, Smooth>();

// Authoritative max HP (from server)
let myMaxHp = 0;

const WS_URL =
  location.hostname === "localhost"
    ? "ws://localhost:8080"
    : "wss://snapaim.onrender.com";

let heartbeat: number | null = null;

function msgType(msg: any): string | undefined {
  return msg?.t ?? msg?.type;
}

function wsSend(payload: any) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const out = { ...payload };
  if (out.t && !out.type) out.type = out.t;
  if (out.type && !out.t) out.t = out.type;
  ws.send(JSON.stringify(out));
}

// --- Join/Menu ---
nameInput.focus();

function startGame() {
  if (joined) return;
  joined = true;

  const clean = nameInput.value.trim().slice(0, 18);
  myName = clean.length ? clean : "Player";

  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;

  // immediate UI feedback
  hudName.textContent = myName;
  hudHpText.textContent = `Connecting...`;
  hpBarInner.style.width = `100%`;
  hpBarInner.style.backgroundImage = "none";
  hpBarInner.style.background = `hsl(120, 85%, 55%)`;
  hpBarInner.style.opacity = "1";

  menu.style.display = "none";
  hudBottom.style.display = "block";

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
    heartbeat = window.setInterval(() => {
      wsSend({ t: "move", x: mouseX, y: mouseY });
    }, 50);

    wsSend({ t: "setName", name: myName });
    wsSend({ t: "move", x: mouseX, y: mouseY });
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const t = msgType(msg);

    if (t === "welcome") {
      myId = msg.id ?? myId;
      hitRadius = msg.hitRadius ?? hitRadius;

      if (typeof msg.maxHp === "number") myMaxHp = msg.maxHp;
      else if (typeof msg.hp === "number") myMaxHp = Math.max(myMaxHp, msg.hp);

      wsSend({ t: "setName", name: myName });
      wsSend({ t: "move", x: mouseX, y: mouseY });
      return;
    }

    if (t === "state") {
      const list = msg.players as PlayerState[] | undefined;
      if (!Array.isArray(list)) return;

      for (const p of list) {
        players.set(p.id, p);

        if (p.id !== myId) {
          const s = smooth.get(p.id);
          if (!s) smooth.set(p.id, { x: p.x, y: p.y, tx: p.x, ty: p.y });
          else {
            s.tx = p.x;
            s.ty = p.y;
          }
        }
      }

      // If we missed welcome, infer myId from name + closeness
      if (joined && !myId && myName) {
        let bestId: string | null = null;
        let bestD = Infinity;

        for (const p of list) {
          if ((p.name || "").trim() !== myName) continue;
          const dx = p.x - mouseX;
          const dy = p.y - mouseY;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            bestId = p.id;
          }
        }

        if (bestId && bestD < (hitRadius * 6) * (hitRadius * 6)) {
          myId = bestId;
          wsSend({ t: "setName", name: myName });
        }
      }

      // lock myMaxHp from my own state (authoritative)
      if (myId) {
        const me = list.find((p) => p.id === myId);
        if (me) {
          if (typeof me.maxHp === "number") myMaxHp = me.maxHp;
          else if (myMaxHp === 0) myMaxHp = Math.max(1, me.hp);
        }
      }

      // cleanup
      const alive = new Set(list.map((p) => p.id));
      for (const id of smooth.keys()) if (!alive.has(id)) smooth.delete(id);
      for (const id of players.keys()) if (!alive.has(id)) players.delete(id);

      return;
    }

    if (t === "hit") {
      const to = msg.to ?? msg.target ?? msg.id;
      const hp = msg.hp ?? msg.newHp ?? msg.health;
      if (typeof to === "string" && typeof hp === "number") {
        const target = players.get(to);
        if (target) target.hp = hp;
      }
      return;
    }
  });

  ws.addEventListener("close", () => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
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
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  wsSend({ t: "click", x: e.clientX, y: e.clientY });
});

// --- Rendering helpers ---
function getMaxHpFor(p: PlayerState) {
  if (typeof p.maxHp === "number" && p.maxHp > 0) return p.maxHp;
  if (myId && p.id === myId && myMaxHp > 0) return myMaxHp;
  return myMaxHp > 0 ? myMaxHp : 1;
}

function drawOtherHealthBar(x: number, y: number, p: PlayerState) {
  ctx.save();

  const maxHp = getMaxHpFor(p);
  const w = 70;
  const h = 15;
  const pct = Math.max(0, Math.min(1, p.hp / maxHp));

  const bx = x - w / 2;
  const by = y - hitRadius - 24;

  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(bx, by, w, h);

  let color: string;
  if (pct > 0.6) color = "#3ddc84";
  else if (pct > 0.3) color = "#f5c542";
  else color = "#ff4d4d";

  ctx.fillStyle = color;
  ctx.fillRect(bx, by, w * pct, h);

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(55,55,55,0.95)";
  ctx.strokeRect(bx, by, w, h);

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
  if (!joined) return;

  if (!myId) {
    hudName.textContent = myName || "Loading...";
    hudHpText.textContent = `Connecting...`;
    return;
  }

  const me = players.get(myId);
  if (!me) return;

  const maxHp = getMaxHpFor(me);

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

  const SMOOTH = 0.18;
  for (const s of smooth.values()) {
    s.x += (s.tx - s.x) * SMOOTH;
    s.y += (s.ty - s.y) * SMOOTH;
  }

  for (const p of players.values()) {
    if (myId && p.id === myId) continue;

    const s = smooth.get(p.id);
    const x = s ? s.x : p.x;
    const y = s ? s.y : p.y;

    ctx.save();

    ctx.beginPath();
    ctx.arc(x, y, hitRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(90,240,150,0.95)";
    ctx.fill();

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

    drawOtherHealthBar(x, y, p);
  }

  updateBottomHud();
  requestAnimationFrame(loop);
}
loop();
