const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const menu = document.getElementById("menu") as HTMLDivElement;
const nameInput = document.getElementById("nameInput") as HTMLInputElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;

const hudBottom = document.getElementById("hudBottom") as HTMLDivElement;
const hudName = document.getElementById("hudName") as HTMLDivElement;
const hudHpText = document.getElementById("hudHpText") as HTMLDivElement;
const hpBarInner = document.getElementById("hpBarInner") as HTMLDivElement;

const speedBarInner = document.getElementById("speedBarInner") as HTMLDivElement;
const hudSpeedText = document.getElementById("hudSpeedText") as HTMLDivElement;

const deathScreen = document.getElementById("deathScreen") as HTMLDivElement;
const deathBig = document.getElementById("deathBig") as HTMLDivElement;
const continueBtn = document.getElementById("continueBtn") as HTMLButtonElement;

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

let myMaxHp: number | null = null;

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

const SPEED_MAX = 2000;
let lastSpeedT = performance.now();
let lastSpeedX = mouseX;
let lastSpeedY = mouseY;
let smoothSpeed = 0;

let joinTimeMs = performance.now();
const SPEED_GRACE_MS = 650;

function resetSpeedSampler() {
  lastSpeedT = performance.now();
  lastSpeedX = mouseX;
  lastSpeedY = mouseY;
  smoothSpeed = 0;

  speedBarInner.style.width = "0%";
  speedBarInner.style.backgroundImage = "none";
  speedBarInner.style.background = "hsl(60, 95%, 55%)";
  speedBarInner.style.opacity = "1";
  hudSpeedText.textContent = `Speed: 0/${SPEED_MAX}`;
}

function updateSpeedFromMouse() {
  const tNow = performance.now();
  const dt = tNow - lastSpeedT;
  if (dt <= 0) return;

  const dx = mouseX - lastSpeedX;
  const dy = mouseY - lastSpeedY;
  const d = Math.hypot(dx, dy);

  const instant = (d / dt) * 1000;

  const alpha = 0.18;
  smoothSpeed += (instant - smoothSpeed) * alpha;

  lastSpeedT = tNow;
  lastSpeedX = mouseX;
  lastSpeedY = mouseY;

  const clamped = Math.max(0, Math.min(SPEED_MAX, smoothSpeed));
  const pct = clamped / SPEED_MAX;

  speedBarInner.style.width = `${pct * 100}%`;

  const hue = 60 - pct * 60;
  speedBarInner.style.background = `hsl(${hue}, 95%, 55%)`;

  hudSpeedText.textContent = `Speed: ${Math.round(clamped)}/${SPEED_MAX}`;

  if (joined && tNow - joinTimeMs > SPEED_GRACE_MS && smoothSpeed >= SPEED_MAX) {
    showDeathScreen("Speed");
  }
}

let lastKillerName: string | null = null;

function stopConnection() {
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  try {
    ws?.close();
  } catch {}
  ws = null;
}

function showDeathScreen(killedBy: string) {
  stopConnection();

  hudBottom.style.display = "none";
  menu.style.display = "none";

  deathBig.textContent = killedBy;
  deathScreen.style.display = "flex";
}

function resetToMenu() {
  stopConnection();

  joined = false;
  myId = null;
  myMaxHp = null;
  lastKillerName = null;
  players.clear();
  smooth.clear();

  resetSpeedSampler();

  deathScreen.style.display = "none";
  hudBottom.style.display = "none";
  menu.style.display = "flex";

  hudName.textContent = "";
  hudHpText.textContent = "";
  hpBarInner.style.width = "0%";

  nameInput.value = "";
  nameInput.focus();
}

continueBtn.addEventListener("click", () => {
  resetToMenu();
});

nameInput.focus();

function startGame() {
  if (joined) return;
  joined = true;

  const clean = nameInput.value.trim().slice(0, 18);
  myName = clean.length ? clean : "Player";

  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;

  joinTimeMs = performance.now();
  resetSpeedSampler();

  deathScreen.style.display = "none";
  menu.style.display = "none";
  hudBottom.style.display = "flex";

  hudName.textContent = myName || "Loading...";
  hudHpText.textContent = "Connecting/Finding a server...";
  hpBarInner.style.width = "100%";
  hpBarInner.style.backgroundImage = "none";
  hpBarInner.style.background = "hsl(120, 85%, 55%)";
  hpBarInner.style.opacity = "1";

  connect();
}

playBtn.addEventListener("click", () => startGame());

nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    startGame();
  }
});

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

    if (t === "dead") {
      const byName = typeof msg.byName === "string" ? msg.byName : null;
      showDeathScreen(byName ?? lastKillerName ?? "Unknown");
      return;
    }

    if (t === "welcome") {
      myId = typeof msg.id === "string" ? msg.id : myId;
      hitRadius = typeof msg.hitRadius === "number" ? msg.hitRadius : hitRadius;

      if (typeof msg.maxHp === "number" && msg.maxHp > 0) {
        myMaxHp = msg.maxHp;
      } else if (typeof msg.hp === "number" && msg.hp > 0 && myMaxHp === null) {
        myMaxHp = msg.hp;
      }

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

      if (myId) {
        const meFromList = list.find((p) => p.id === myId);
        if (meFromList) {
          if (typeof meFromList.maxHp === "number" && meFromList.maxHp > 0) {
            myMaxHp = meFromList.maxHp;
          } else if (
            myMaxHp === null &&
            typeof meFromList.hp === "number" &&
            meFromList.hp > 0
          ) {
            myMaxHp = meFromList.hp;
          }
        }
      }

      const alive = new Set(list.map((p) => p.id));
      for (const id of smooth.keys()) if (!alive.has(id)) smooth.delete(id);
      for (const id of players.keys()) if (!alive.has(id)) players.delete(id);

      if (myId) {
        const me = players.get(myId);
        if (!me || me.hp <= 0) {
          showDeathScreen(lastKillerName ?? "Unknown");
          return;
        }
      }

      return;
    }

    if (t === "hit") {
      const to = msg.to ?? msg.target ?? msg.id;
      const hp = msg.hp ?? msg.newHp ?? msg.health;

      if (typeof to === "string" && typeof hp === "number") {
        const target = players.get(to);
        if (target) target.hp = hp;
      }

      if (myId && to === myId) {
        const from = msg.from;
        if (typeof from === "string") {
          const killer = players.get(from);
          lastKillerName =
            killer?.name && killer.name.trim().length ? killer.name : from.slice(0, 4);
        }
        if (typeof hp === "number" && hp <= 0) {
          showDeathScreen(lastKillerName ?? "Unknown");
        }
      }

      return;
    }
  });

  ws.addEventListener("close", () => {
    if (heartbeat !== null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (joined && deathScreen.style.display !== "flex") {
      resetToMenu();
    }
  });

  ws.addEventListener("error", () => {
    if (joined && deathScreen.style.display !== "flex") resetToMenu();
  });
}

let lastMoveSend = 0;
const MOVE_SEND_MS = 50;

window.addEventListener("pointermove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;

  updateSpeedFromMouse();

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

function maxHpForPlayer(p: PlayerState) {
  if (typeof p.maxHp === "number" && p.maxHp > 0) return p.maxHp;
  if (myMaxHp !== null && myMaxHp > 0) return myMaxHp;
  return 1;
}

function drawOtherHealthBar(x: number, y: number, p: PlayerState) {
  ctx.save();

  const maxHp = maxHpForPlayer(p);
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
    hudHpText.textContent = "Connecting/Finding a server...";
    return;
  }

  const me = players.get(myId);
  if (!me) return;

  const maxHp = myMaxHp !== null && myMaxHp > 0 ? myMaxHp : maxHpForPlayer(me);

  hudName.textContent = me.name || myName || "Player";
  hudHpText.textContent = `${Math.round(me.hp).toLocaleString()} / ${Math.round(
    maxHp
  ).toLocaleString()} HP`;

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

    const label = p.name && p.name.trim().length ? p.name : p.id.slice(0, 4);

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
