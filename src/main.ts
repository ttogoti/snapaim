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

const START_HP = 100_000;

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

// --- Join/Menu ---
nameInput.focus();

function startGame() {
  if (joined) return;
  joined = true;

  const clean = nameInput.value.trim().slice(0, 18);
  myName = clean.length ? clean : "Player";

  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;

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
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
      }
    }, 50);
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.t === "welcome") {
      myId = msg.id;
      hitRadius = msg.hitRadius ?? hitRadius;

      ws?.send(JSON.stringify({ t: "setName", name: myName }));
      ws?.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
      return;
    }

    if (msg.t === "state") {
      const list = msg.players as PlayerState[];

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

      const alive = new Set(list.map(p => p.id));
      for (const id of smooth.keys()) if (!alive.has(id)) smooth.delete(id);
      for (const id of players.keys()) if (!alive.has(id)) players.delete(id);
    }
  });

  ws.addEventListener("close", () => {
    if (heartbeat !== null) clearInterval(heartbeat);
  });
}

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

  let color = pct > 0.6 ? "#3ddc84" : pct > 0.3 ? "#f5c542" : "#ff4d4d";
  ctx.fillStyle = color;
  ctx.fillRect(bx, by, w * pct, h);

  // outline bar
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(55,55,55,0.95)";
  ctx.strokeRect(bx, by, w, h);

  const text = Math.round(hp).toLocaleString();
  ctx.font = "9px Ubuntu, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.strokeText(text, bx + w / 2, by + h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(text, bx + w / 2, by + h / 2);

  ctx.restore();
}

function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const s of smooth.values()) {
    s.x += (s.tx - s.x) * 0.18;
    s.y += (s.ty - s.y) * 0.18;
  }

  for (const p of players.values()) {
    if (p.id === myId) continue;

    ctx.save();

    const s = smooth.get(p.id);
    const x = s ? s.x : p.x;
    const y = s ? s.y : p.y;

    ctx.beginPath();
    ctx.arc(x, y, hitRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(90,240,150,0.95)";
    ctx.fill();

    const label = p.name || p.id.slice(0, 4);
    ctx.font = "12px Ubuntu, system-ui";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(55,55,55,0.95)";
    ctx.strokeText(label, x, y + hitRadius + 14);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(label, x, y + hitRadius + 14);

    drawOtherHealthBar(x, y, p.hp);

    ctx.restore();
  }

  requestAnimationFrame(loop);
}
loop();
