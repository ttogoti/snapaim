import http from "http";
import path from "path";
import fs from "fs";
import { WebSocketServer } from "ws";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(process.cwd(), "public");
const mime = (p) => {
    const ext = path.extname(p).toLowerCase();
    if (ext === ".html")
        return "text/html; charset=utf-8";
    if (ext === ".js")
        return "text/javascript; charset=utf-8";
    if (ext === ".css")
        return "text/css; charset=utf-8";
    if (ext === ".png")
        return "image/png";
    if (ext === ".jpg" || ext === ".jpeg")
        return "image/jpeg";
    if (ext === ".svg")
        return "image/svg+xml";
    if (ext === ".map")
        return "application/json; charset=utf-8";
    return "application/octet-stream";
};
const safeJoin = (base, target) => {
    const resolved = path.normalize(path.join(base, target));
    if (!resolved.startsWith(base))
        return base;
    return resolved;
};
const server = http.createServer((req, res) => {
    try {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        let p = url.pathname;
        if (p === "/")
            p = "/index.html";
        const filePath = safeJoin(PUBLIC_DIR, p);
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
        }
        res.writeHead(200, {
            "Content-Type": mime(filePath),
            "Cache-Control": "no-store"
        });
        fs.createReadStream(filePath).pipe(res);
    }
    catch {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Server error");
    }
});
const wss = new WebSocketServer({ noServer: true });
const clients = new Map();
const presence = new Map();
const bumpPresence = (region, delta) => {
    const cur = presence.get(region) || 0;
    const nxt = Math.max(0, cur + delta);
    presence.set(region, nxt);
    broadcastPresence(region);
};
const broadcastPresence = (region) => {
    const n = presence.get(region) || 0;
    for (const [ws, meta] of clients.entries()) {
        if (meta.region === region && ws.readyState === 1) {
            ws.send(JSON.stringify({ t: "presence", region, n }));
        }
    }
};
server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws") {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
    });
});
wss.on("connection", (ws) => {
    clients.set(ws, { region: null, name: null });
    ws.on("message", (buf) => {
        let msg = null;
        try {
            msg = JSON.parse(buf.toString());
        }
        catch {
            return;
        }
        if (!msg || typeof msg.t !== "string")
            return;
        if (msg.t === "ping") {
            ws.send(JSON.stringify({ t: "pong", ts: msg.ts ?? null }));
            return;
        }
        if (msg.t === "hello") {
            ws.send(JSON.stringify({ t: "hello", ok: true }));
            return;
        }
        if (msg.t === "join") {
            const region = String(msg.region || "").slice(0, 12).toLowerCase();
            const name = String(msg.name || "").slice(0, 16);
            const meta = clients.get(ws);
            if (!meta)
                return;
            if (meta.region && meta.region !== region)
                bumpPresence(meta.region, -1);
            meta.region = region || null;
            meta.name = name || null;
            clients.set(ws, meta);
            if (meta.region)
                bumpPresence(meta.region, 1);
            if (meta.region)
                ws.send(JSON.stringify({ t: "presence", region: meta.region, n: presence.get(meta.region) || 0 }));
            return;
        }
    });
    ws.on("close", () => {
        const meta = clients.get(ws);
        if (meta?.region)
            bumpPresence(meta.region, -1);
        clients.delete(ws);
    });
    ws.on("error", () => { });
});
server.listen(PORT, () => {
    console.log(`snapaim server on http://localhost:${PORT}`);
});
