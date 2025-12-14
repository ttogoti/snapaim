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

type PlayerState = { id: string; name: string; x: number; y: number; hp: number };

const START_HP = 10_000;

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

  hudName.textContent = myName;

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
      myId = msg.id;
      hitRadius = msg.hitRadius ?? hitRadius;

      wsSend({ t: "setName", name: myName });
      wsSend({ t: "move", x: mouseX, y: mouseY });
      return;
    }

    if (t === "state") {
      const list = (msg.players ?? msg.state ?? msg.data) as PlayerState[] | undefined;
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

      if (joined && !myId) {
        let best: { id: string; d2: number } | null = null;

        for (const p of list) {
          if ((p.name || "").trim() !== myName) continue;
          const dx = p.x - mouseX;
          const dy = p.y - mouseY;
          const d2 = dx * dx + dy * dy;
          if (!best || d2 < best.d2) best = { id: p.id, d2 };
        }

        if (best && best.d2 < (hitRadius * 6) * (hitRadius * 6)) {
          myId = best.id;
          wsSend({ t: "setName", name: myName });
        }
      }

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

  ws.addEventListener("error", () => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  });
}

window.addEventListener("beforeunload", () => {
  try {
    ws?.close();
  } catch {}
});

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

// --- Rendering ---
function drawOtherHealthBar(x: number, y: number, hp: number) {
  ctx.save();

  const w = 70;
  const h = 15;
  const pct = Math.max(0, Math.min(1, hp / START_HP));

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

  const text = Math.round(hp).toLocaleString();

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
    hudHpText.textContent = `${START_HP.toLocaleString()} / ${START_HP.toLocaleString()} HP`;
    hpBarInner.style.width = "100%";
    hpBarInner.style.backgroundImage = "none";
    hpBarInner.style.background = "hsl(120, 85%, 55%)";
    hpBarInner.style.opacity = "1";
    return;
  }

  const me = players.get(myId);
  if (!me) return;

  hudName.textContent = me.name || myName || "Player";
  hudHpText.textContent = `${Math.round(me.hp).toLocaleString()} / ${START_HP.toLocaleString()} HP`;

  const pct = Math.max(0, Math.min(1, me.hp / START_HP));
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

    drawOtherHealthBar(x, y, p.hp);
  }

  updateBottomHud();
  requestAnimationFrame(loop);
}
loop();
