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

// Keep a local map of player states (server authority)
const players = new Map<string, PlayerState>();

// Render smoothing buffers for other players (prevents jitter)
type Smooth = { x: number; y: number; tx: number; ty: number };
const smooth = new Map<string, Smooth>();

// Server URL
const WS_URL =
  location.hostname === "localhost"
    ? "ws://localhost:8080"
    : "wss://snapaim.onrender.com";

// Heartbeat keeps server position fresh even if pointermove doesn't fire
let heartbeat: number | null = null;

// --- Join/Menu ---
nameInput.focus();

function startGame() {
  if (joined) return;
  joined = true;

  const clean = nameInput.value.trim().slice(0, 18);
  myName = clean.length ? clean : "Player";

  // Set an initial position so the server isn't stuck at (0,0)
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
    // Heartbeat sends move packets even when stationary
    heartbeat = window.setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
      }
    }, 50); // 20 Hz
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.t === "welcome") {
      myId = msg.id;
      hitRadius = msg.hitRadius ?? hitRadius;

      // Immediately set name on server
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "setName", name: myName }));
        // also send a move right away
        ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
      }
      return;
    }

    if (msg.t === "state") {
      const list = msg.players as PlayerState[];

      // Update players map
      for (const p of list) {
        players.set(p.id, p);

        // init smoothing for others
        if (p.id !== myId) {
          const s = smooth.get(p.id);
          if (!s) {
            smooth.set(p.id, { x: p.x, y: p.y, tx: p.x, ty: p.y });
          } else {
            s.tx = p.x;
            s.ty = p.y;
          }
        }
      }

      // Remove smoothing entries for players that no longer exist
      const alive = new Set(list.map((p) => p.id));
      for (const id of smooth.keys()) {
        if (!alive.has(id)) smooth.delete(id);
      }

      // Also remove players that vanished
      for (const id of players.keys()) {
        if (!alive.has(id)) players.delete(id);
      }

      return;
    }

    if (msg.t === "hit") {
      const target = players.get(msg.to);
      if (target) target.hp = msg.hp;
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

// Ensure close message reaches server quickly
window.addEventListener("beforeunload", () => {
  try {
    ws?.close();
  } catch {}
});

// --- Input ---
let lastMoveSend = 0;
const MOVE_SEND_MS = 50; // throttle pointermove sends (heartbeat already handles it)

window.addEventListener("pointermove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;

  const now = performance.now();
  if (ws && ws.readyState === WebSocket.OPEN && now - lastMoveSend >= MOVE_SEND_MS) {
    lastMoveSend = now;
    ws.send(JSON.stringify({ t: "move", x: mouseX, y: mouseY }));
  }
});

window.addEventListener("pointerdown", (e) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Send click position; server finds target within radius and applies damage = speed
  ws.send(JSON.stringify({ t: "click", x: e.clientX, y: e.clientY }));
});

// --- Rendering ---
  // HP number INSIDE the bar (centered)
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "10px Ubuntu, system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillText(
    Math.round(hp).toLocaleString(),
    bx + w / 2,
    by + h / 2
  );

  // reset alignment (important so other text isn't broken)
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";




function updateBottomHud() {
  if (!myId) return;

  const me = players.get(myId);
  if (!me) return;

  hudName.textContent = me.name || myName || "Player";
  hudHpText.textContent = `${Math.round(me.hp).toLocaleString()} / ${START_HP.toLocaleString()} HP`;

  const pct = Math.max(0, Math.min(1, me.hp / START_HP));
  hpBarInner.style.width = `${pct * 100}%`;

  // Smooth color fade: red -> green, but FORCE solid fill (no gradients/opacity)
  const hue = pct * 120;
  hpBarInner.style.backgroundImage = "none";
  hpBarInner.style.background = `hsl(${hue}, 85%, 55%)`;
  hpBarInner.style.opacity = "1";
}


function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Smooth other players toward their targets
  const SMOOTH = 0.18;
  for (const s of smooth.values()) {
    s.x += (s.tx - s.x) * SMOOTH;
    s.y += (s.ty - s.y) * SMOOTH;
  }

  // Draw everyone EXCEPT you
  for (const p of players.values()) {
    if (p.id === myId) continue;

    const s = smooth.get(p.id);
    const x = s ? s.x : p.x;
    const y = s ? s.y : p.y;

    // hitbox circle
    ctx.beginPath();
    ctx.arc(x, y, hitRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(90,240,150,0.95)";
    ctx.fill();

    // name underneath (only for others)
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "12px system-ui";
    const label = (p.name && p.name.trim().length) ? p.name : p.id.slice(0, 4);
    ctx.fillText(label, x - Math.min(30, label.length * 3), y + hitRadius + 14);

    // bar + hp number above
    drawOtherHealthBar(x, y, p.hp);
  }

  updateBottomHud();
  requestAnimationFrame(loop);
}
loop();
