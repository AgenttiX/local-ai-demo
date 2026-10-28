#!/usr/bin/env node
// Studio QA playtest — drives a headless Chrome over CDP. Zero dependencies
// (Node >= 22 global WebSocket). Launches a real browser, plays the game with
// synthetic key input, samples the game's window.__studio state, takes
// screenshots, and prints a JSON verdict report to stdout.
//
// Usage: node scripts/playtest.mjs [--url <url>] [--out <dir>] [--ms <ms>] [--keys a,b]
//   --url   default: file://<repo>/game/index.html (or an http:// URL)
//   --out   default: studio/shots/run-<timestamp>
//   --ms    play duration in ms (default 7000)
//   --keys  comma list from: ArrowUp ArrowDown ArrowLeft ArrowRight Space Enter KeyW KeyA KeyS KeyD
// Exit code: 0 = PASS, 1 = FAIL. Also appends a `qa / test` event to the studio bus.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUS = path.join(ROOT, "studio", "bus", "events.jsonl");
const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const URL_ = arg("url", "file://" + path.join(ROOT, "game", "index.html"));
const OUT = path.isAbsolute(arg("out", ""))
  ? arg("out")
  : path.join(ROOT, arg("out", "studio/shots/run-" + new Date().toISOString().replace(/[:.]/g, "-")));
const MS = Number(arg("ms", "7000"));
const KEYS = arg("keys", "ArrowUp,ArrowRight,Space,ArrowLeft,ArrowDown,KeyW,KeyA,KeyS,KeyD")
  .split(",").map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// ---- find a Chrome/Chromium binary -------------------------------------------
const BINS = [process.env.CHROME, "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium", "/snap/bin/chromium"].filter(Boolean);
const bin = BINS.find((b) => { try { fs.accessSync(b); return true; } catch { return false; } }) || null;
if (!bin) {
  console.log(JSON.stringify({ verdict: "FAIL", checks: [{ name: "chrome available", pass: false, detail: "no chrome/chromium found" }], errors: [], states: [], shots: [], out: OUT }));
  process.exit(1);
}

// ---- launch headless chrome, grab the CDP ws url ------------------------------
function launch(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-pt-"));
  const p = spawn(
    bin,
    [
      "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--disable-background-networking", "--remote-debugging-port=0",
      `--user-data-dir=${dir}`, "--window-size=1280,720", "--autoplay-policy=no-user-gesture-required",
      ...extra, "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return { p, dir, ws: null, buf: "" };
}
function waitForWs(l) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error("chrome did not report devtools ws in 8s: " + l.buf.slice(-300))), 8000);
    l.p.stderr.on("data", (d) => {
      l.buf += d;
      const m = l.buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) { clearTimeout(to); res(m[1]); }
    });
    l.p.on("exit", (c) => { clearTimeout(to); rej(new Error("chrome exited early (code " + c + "): " + l.buf.slice(-400))); });
  });
}

let chrome = launch([]);
try {
  chrome.ws = await waitForWs(chrome);
} catch (e) {
  chrome.p.kill();
  chrome = launch(["--no-sandbox"]);
  chrome.ws = await waitForWs(chrome);
}
const httpBase = chrome.ws.replace(/^ws:\/\//, "http://").replace(/\/devtools\/.*$/, "");

// ---- open a tab at the game ---------------------------------------------------
let newTab;
try {
  newTab = await (await fetch(`${httpBase}/json/new?${encodeURIComponent(URL_)}`, { method: "PUT" })).json();
} catch (e) {
  console.log(JSON.stringify({ verdict: "FAIL", checks: [{ name: "open tab", pass: false, detail: String(e) }], errors: [String(e)], states: [], shots: [], out: OUT }));
  chrome.p.kill();
  process.exit(1);
}

// ---- minimal CDP client --------------------------------------------------------
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", () => rej(new Error("cdp websocket error")), { once: true });
      this.ws.addEventListener("message", (m) => this._on(JSON.parse(m.data)));
    });
  }
  _on(m) {
    if (m.id && this.pending.has(m.id)) {
      const { res, rej, method } = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) rej(new Error(method + ": " + m.error.message));
      else res(m.result ?? {});
    } else if (m.method) {
      for (const h of this.handlers) h(m);
    }
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, { res, rej, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(h) { this.handlers.push(h); }
  close() { try { this.ws.close(); } catch {} }
}

const KEYMAP = {
  ArrowUp: { code: "ArrowUp", key: "ArrowUp" },
  ArrowDown: { code: "ArrowDown", key: "ArrowDown" },
  ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft" },
  ArrowRight: { code: "ArrowRight", key: "ArrowRight" },
  Space: { code: "Space", key: " " },
  Enter: { code: "Enter", key: "Enter" },
  KeyW: { code: "KeyW", key: "w" },
  KeyA: { code: "KeyA", key: "a" },
  KeyS: { code: "KeyS", key: "s" },
  KeyD: { code: "KeyD", key: "d" },
};

const cdp = new CDP(newTab.webSocketDebuggerUrl);
let shotPaths = [];
async function shot(n) {
  try {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    const p = path.join(OUT, `qa-${n}.png`);
    fs.writeFileSync(p, Buffer.from(r.data, "base64"));
    shotPaths.push(p);
  } catch (e) {
    shotPaths.push(null);
  }
}

const errors = [];
const states = [];
const report = { verdict: "FAIL", url: URL_, out: OUT, ms: MS, checks: [], errors, states, shots: [], ts: new Date().toISOString() };
try {
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  cdp.on((m) => {
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails || {};
      errors.push("EXCEPTION: " + ((d.exception && d.exception.description) || d.text || "unknown").split("\n")[0].slice(0, 300));
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push("CONSOLE: " + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 300));
    } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      const txt = String(m.params.entry.text);
      if (txt.includes("favicon")) return; // browser noise, not a game bug
      errors.push("PAGE: " + txt.slice(0, 300));
    }
  });

  const loaded = new Promise((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
  await cdp.send("Page.navigate", { url: URL_ });
  await Promise.race([loaded, sleep(12000)]);
  await sleep(400);

  // 1 — the test hook must exist
  const hook = await cdp.send("Runtime.evaluate", { expression: "typeof window.__studio", returnByValue: true });
  const hookOk = hook.result && hook.result.value === "object";
  report.checks.push({ name: "studio hook present", pass: hookOk, detail: "window.__studio = " + (hook.result && hook.result.value) });

  // 2 — start the game through the hook
  const started = await cdp.send("Runtime.evaluate", {
    expression: "window.__studio && typeof window.__studio.start === 'function' ? (window.__studio.start(), 'started') : 'no-start-fn'",
    returnByValue: true,
  });
  report.checks.push({ name: "game starts via __studio.start()", pass: started.result && started.result.value === "started", detail: String(started.result && started.result.value) });
  await sleep(200);
  await shot(0);

  // 3 — play: cycle keys, sample state once a second
  const t0 = Date.now();
  let i = 0, lastSample = 0;
  const sample = async () => {
    try {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "window.__studio && typeof window.__studio.state === 'function' ? window.__studio.state() : null",
        returnByValue: true,
      });
      if (r.result && r.result.value) states.push(r.result.value);
    } catch {}
  };
  await sample();
  while (Date.now() - t0 < MS) {
    const k = KEYMAP[KEYS[i % KEYS.length]];
    i++;
    if (k) {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...k }).catch(() => {});
      await sleep(90);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...k }).catch(() => {});
    }
    await sleep(90);
    if (Date.now() - t0 - lastSample > 1000) {
      lastSample = Date.now() - t0;
      await sample();
    }
  }
  await sample();
  await shot(1);
  // one more after a short settle, in case of a late crash
  await sleep(500);
  await sample();
  await shot(2);

  const runningSeen = states.some((s) => s && s.running === true);
  const overSeen = states.some((s) => s && s.over === true);
  report.checks.push({
    name: "game runs and responds to input",
    pass: runningSeen,
    detail: `states: ${JSON.stringify(states.slice(0, 8))} (over seen: ${overSeen})`,
  });
  report.checks.push({ name: "no page errors", pass: errors.length === 0, detail: errors.slice(0, 5).join(" | ") || "clean" });
  report.states = states;
  report.shots = shotPaths.filter(Boolean);
  report.verdict = report.checks.every((c) => c.pass) ? "PASS" : "FAIL";
} catch (e) {
  report.checks.push({ name: "playtest executed", pass: false, detail: String(e) });
  report.errors.push("PLAYTEST CRASH: " + String(e));
  report.shots = shotPaths.filter(Boolean);
}

const fs2 = fs;
fs2.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

// leave a trail on the studio bus
try {
  const fails = report.checks.filter((c) => !c.pass).map((c) => c.name).join("; ");
  fs2.appendFileSync(BUS, JSON.stringify({
    t: Date.now(), agent: "qa", type: "test",
    text: `playtest ${report.verdict} — ${fails || "all checks passed"} (shots: ${report.shots.length})`,
  }) + "\n");
} catch {}

cdp.close();
try { chrome.p.kill(); } catch {}
try { fs.rmSync(chrome.dir, { recursive: true, force: true }); } catch {}
process.exit(report.verdict === "PASS" ? 0 : 1);
