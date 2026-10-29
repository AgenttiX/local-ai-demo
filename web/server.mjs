#!/usr/bin/env node
// Studio dashboard server — zero dependencies (Node >= 18).
// Serves the mission-control UI, the game, QA screenshots, and a live SSE feed
// of the studio bus (events.jsonl), the git commit feed, and new screenshots.
//
// Usage: node web/server.mjs        (PORT env, default 8790)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PORT || 8790);
const BUS = path.join(ROOT, "studio", "bus", "events.jsonl");
const SHOTS = path.join(ROOT, "studio", "shots");
const PROMPT = path.join(ROOT, "studio", "prompt.txt");
const PUB = path.join(ROOT, "web", "public");
const GAME = path.join(ROOT, "game");

const AGENTS = [
  { id: "architect", name: "ARCHITECT", model: "Qwen3.8-27B", gpu: "RTX 3090", host: "agx-z2e", ctx: 139264, speed: "128 tok/s" },
  { id: "engineer", name: "ENGINEER", model: "Qwen3.8-27B", gpu: "RTX 3090", host: "agx-z2e", ctx: 139264, speed: "128 tok/s" },
  { id: "qa", name: "QA", model: "Gemma 4 26B A4B", gpu: "Radeon VII", host: "agx-z2e", ctx: 88064, speed: "124 tok/s" },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
};

const promptText = () => {
  try { return fs.readFileSync(PROMPT, "utf8").trim(); } catch { return ""; }
};

// ---- studio bus (append-only JSONL, polled by mtime+size) -------------------
let busCache = { mtime: 0, size: -1, sig: "", events: [] };
function readBus() {
  try {
    const st = fs.statSync(BUS);
    if (st.mtimeMs === busCache.mtime && st.size === busCache.size) return busCache.events;
    const raw = fs.readFileSync(BUS, "utf8").split("\n").filter(Boolean);
    const events = raw
      .map((l) => { try { const e = JSON.parse(l); return e && e.t ? e : null; } catch { return null; } })
      .filter(Boolean);
    busCache = { mtime: st.mtimeMs, size: st.size, sig: `${st.mtimeMs}:${st.size}`, events };
    return events;
  } catch {
    return [];
  }
}

// ---- git commit feed ---------------------------------------------------------
let gitCache = { key: "", rows: [] };
function readGit() {
  return new Promise((res) => {
    execFile("git", ["-C", ROOT, "log", "-30", "--pretty=%h%x09%s%x09%at"], (err, out) => {
      if (!err && out.trim()) {
        gitCache = {
          key: out,
          rows: out.trim().split("\n").map((l) => {
            const [h, s, t] = l.split("\t");
            return { h, s, t: Number(t) * 1000 };
          }),
        };
      }
      res(gitCache.rows);
    });
  });
}

// ---- screenshots (newest first) ----------------------------------------------
let shotsCache = { key: "", rows: [] };
function listShots() {
  const out = [];
  (function walk(d, pre) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, pre + e.name + "/");
      else if (e.name.endsWith(".png")) {
        try { out.push({ path: "/" + pre + e.name, t: fs.statSync(p).mtimeMs }); } catch {}
      }
    }
  })(SHOTS, "shots/");
  out.sort((a, b) => b.t - a.t);
  const key = out.slice(0, 10).map((o) => o.path + o.t).join(",");
  if (key !== shotsCache.key) shotsCache = { key, rows: out.slice(0, 40) };
  return shotsCache.rows;
}

// ---- SSE ----------------------------------------------------------------------
const clients = new Set();
function sseAll(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch {} }
}
const lastSent = { bus: "", git: "", shots: "" };
async function poll() {
  const events = readBus();
  if (busCache.sig !== lastSent.bus) { lastSent.bus = busCache.sig; sseAll("bus", events); }
  const git = await readGit();
  const gSig = git.map((g) => g.h).join(",");
  if (gSig !== lastSent.git) { lastSent.git = gSig; sseAll("git", git); }
  const shots = listShots();
  const sSig = shots.map((s) => s.path).join(",");
  if (sSig !== lastSent.shots) { lastSent.shots = sSig; sseAll("shots", shots); }
}
setInterval(() => { poll().catch(() => {}); }, 600);
setInterval(() => { for (const c of clients) { try { c.write(": ping\n\n"); } catch {} } }, 20000);

// ---- static -------------------------------------------------------------------
function staticSend(res, base, rel) {
  let fp = path.normalize(path.join(base, rel));
  if (fp !== base && !fp.startsWith(base + path.sep)) { res.writeHead(403); return res.end("forbidden"); }
  if (fp === base || fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
    const idx = path.join(fp, "index.html");
    if (!fs.existsSync(idx) || !fs.statSync(idx).isFile()) { res.writeHead(404); return res.end("not found"); }
    fp = idx;
  }
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(fp).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const send = (code, type, body) => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    res.end(body);
  };
  try {
    if (p === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "Connection": "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      res.write(`event: bus\ndata: ${JSON.stringify(readBus())}\n\n`);
      res.write(`event: git\ndata: ${JSON.stringify(await readGit())}\n\n`);
      res.write(`event: shots\ndata: ${JSON.stringify(listShots())}\n\n`);
      res.write(`event: meta\ndata: ${JSON.stringify({ agents: AGENTS, prompt: promptText() })}\n\n`);
      return;
    }
    if (p === "/" || p === "/index.html") {
      return send(200, MIME[".html"], fs.readFileSync(path.join(PUB, "index.html")));
    }
    if (p === "/api/bus") return send(200, "application/json", JSON.stringify({ agents: AGENTS, prompt: promptText(), events: readBus() }));
    if (p === "/api/git") return send(200, "application/json", JSON.stringify(await readGit()));
    if (p === "/api/shots") return send(200, "application/json", JSON.stringify(listShots()));
    if (p === "/favicon.ico") { res.writeHead(204); return res.end(); }
    if (p === "/game") return staticSend(res, GAME, "index.html");
    if (p.startsWith("/game/")) return staticSend(res, GAME, p.slice(6));
    if (p.startsWith("/shots/")) return staticSend(res, SHOTS, p.slice(7));
    send(404, "text/plain", "not found");
  } catch (e) {
    send(500, "text/plain", String(e));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`studio dashboard: http://localhost:${PORT}`);
  console.log("sse: /events  |  game: /game  |  shots: /shots/<run>/...");
});
