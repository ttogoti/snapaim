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

let myId: string | null = null;
let myName = "";
let hitRadius = 22;
const START_HP = 100_000;

const players = new Map<string, PlayerState>();

// Use your Render server for everyone (except local dev)
const WS_URL =
  location.hostname === "localhost"
    ? "ws://localhost:8080"
    : "wss://snapaim.onrender.com";

let ws: WebSocket | null = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener("open", () => {
    // nothing yet; we wait for welcome
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.t === "welcome") {
      myId = msg.id;
      hitRadius = msg.hitRadius ?? hitRadius;

      // send username immediately after welcome
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "setName", name: myName }));
      }
      return;
    }

    if (msg.t === "state") {
      for (const p of msg.players as PlayerState[]) {
        players.set(p.id, p);
      }
      return;
    }

    if (msg.t === "hit") {
      const target = players.get(msg.to);
      if (target) target.hp = msg.hp;
    }
  });

  ws.addEventListener("close", () => {
    // optional: could show menu again, but keep it simple
  });

  ws.addEventListener("error", () => {
    // optional: show some UI; keeping minimal
  });
}

// --- Join flow ---
nameInput.focus();

function startGame() {
  const clean = nameInput.value.trim().slice(0, 18);
  myName = clean.length ? clean : "Player";

  // hide menu, show HUD
  menu.style.display = "none";
  hudBottom.style.display = "block";

  // connect after you press enter
  connect();
}

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") startGame();
});

// --- Input + networking ---
let mouseX = 0;
let mouseY = 0;

let lastSent = 0;
const SEND_EVERY_MS = 20;

window.addEventListener("pointermove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;

  const now = performance.now();
  if (ws && ws.readyState === WebSocket.OPEN && now - lastSent >= SEND_EVERY_MS) {
    lastSent = now;
    ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
  }
});

window.addEventListener("pointerdown", (e) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ t: "click", x: e.clientX, y: e.clientY }));
});

// --- Rendering ---
function drawHealthBarOverPlayer(x: number, y: number, hp: number) {
  const w = 70;
  const h = 8;
  const pct = Math.max(0, Math.min(1, hp / START_HP));

  const bx = x - w / 2;
  const by = y - hitRadius - 18;

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.fillRect(bx, by, w, h);

  ctx.fillStyle = "rgba(255,80,80,0.95)";
  ctx.fillRect(bx, by, w * pct, h);
}

function updateBottomHud() {
  if (!myId) return;
  const me = players.get(myId);
  if (!me) return;

  hudName.textContent = me.name || myName || "Player";
  hudHpText.textContent = `${Math.round(me.hp).toLocaleString()} / ${START_HP.toLocaleString()} HP`;

  const pct = Math.max(0, Math.min(1, me.hp / START_HP));
  hpBarInner.style.width = `${pct * 100}%`;
}

function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const p of players.values()) {
    // hitbox circle
    ctx.beginPath();
    ctx.arc(p.x, p.y, hitRadius, 0, Math.PI * 2);
    ctx.fillStyle = p.id === myId ? "rgba(80,160,255,0.95)" : "rgba(90,240,150,0.95)";
    ctx.fill();

    // name (replace YOU with username)
    ctx.fillStyle = "white";
    ctx.font = "12px system-ui";
    const label = p.name || (p.id === myId ? myName : p.id.slice(0, 4));
    ctx.fillText(label, p.x - Math.min(30, label.length * 3), p.y + hitRadius + 14);

    // small bar above hitbox
    drawHealthBarOverPlayer(p.x, p.y, p.hp);
  }

  updateBottomHud();
  requestAnimationFrame(loop);
}
loop();
