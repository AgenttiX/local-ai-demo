# 3 GPUs, One Playable Game

A **3-agent game studio** that turns a *one-sentence brief* into a *playable browser
game*, built entirely on local consumer GPUs — **zero cloud calls, zero API keys in
this repo, zero npm dependencies**.

| Agent | Model | GPU | Speed | Job |
| --- | --- | --- | --- | --- |
| **ARCHITECT** | Qwen3.8-27B | RTX 3090 (agx-z2e) | 128 tok/s | designs the game from the brief |
| **ENGINEER** | Qwen3.8-27B | RTX 3090 (agx-z2e) | 128 tok/s | implements `game/index.html` and fixes QA's bugs |
| **QA** | Gemma 4 26B A4B (QAT) | Radeon VII (agx-z2e) | 124 tok/s | *plays* the game in a headless browser, sees its own screenshots, files bugs |

All three models are served locally and reached through the LiteLLM proxy as
OpenCode subagents (see `AGENTS.md` for exact model IDs). The agents coordinate
over the **shared filesystem** — a git repo with a little "studio bus" — while a
live mission-control dashboard shows the work happen.

```
 one sentence ──▶ ARCHITECT ──▶ plan.md ──▶ ENGINEER ──▶ game/index.html
   (prompt.txt)    (3090)                    (3090)          │
                                                             ▼
   commit ──▶ dashboard ◀── studio/bus ◀── QA ◀── headless Chrome (CDP) playtest
        ▲                                    (Radeon VII)   + screenshots QA can see
        └──────── fix loop until QA passes ────────────────────────────────────────┘
```

## The demo

### Live (the good one)

Open OpenCode in this repo and tell it:

```
Run the 3-agent studio demo. The brief is in studio/prompt.txt.
```

The main agent acts as **studio manager**: it spawns the three subagents
(`.opencode/agents/*.md` pins each role to its model), watches the bus, and
runs the QA → fix → QA loop until the game passes. Meanwhile:

```
node web/server.mjs        # → http://localhost:8790
```

opens the **mission-control dashboard**: the three agents (model, GPU, live
activity), the event stream from the studio bus, the git commit feed, the
playable game in an iframe, and QA's screenshots — everything streaming live over
SSE.

### Replay (fully headless)

```
scripts/studio.sh "a one-sentence game brief"     # or omit: uses studio/prompt.txt
```

Re-runs the whole pipeline with `opencode run` (architect → engineer → playtest →
QA → fix, up to `MAX_ROUNDS` rounds) and commits the result. `MAX_ROUNDS=3` by
default; `PORT` changes the dashboard port.

### The money shot

QA doesn't just parse numbers — after the playtest driver (`scripts/playtest.mjs`,
a zero-dep CDP client for Node's built-in WebSocket) drives a **real headless
Chrome** through the game, Gemma **reads the screenshots with the `read` tool**
and reports what it sees. A local GPU literally looking at a game another local
GPU built is the screenshot to keep.

## How it works

### The studio bus (`studio/`)

The repo *is* the studio's shared memory:

| Path | Owner | What |
| --- | --- | --- |
| `studio/prompt.txt` | you | the one-sentence brief |
| `studio/plan.md` | architect | the game design (engineer builds exactly this) |
| `studio/bugs.md` | qa / engineer | open bugs `[ ]`, closed with fix notes `[x]` |
| `studio/bus/events.jsonl` | everyone | append-only event log → the dashboard's live feed |
| `studio/bus/in/<agent>.md` | everyone | per-agent inboxes |
| `studio/shots/<run>/` | playtest | screenshots + `report.json` per playtest |

Append events with the flock-serialized helper (safe across concurrent agents):

```
studio/bus/append.sh <architect|engineer|qa|studio> <type> "<text>"
# types: info decision plan code fix bug test shot milestone verdict error
```

**Only the orchestrator runs git** — subagents never commit (avoids index-lock
races); commits happen at phase boundaries, which also drives the dashboard's
git feed.

### Agents (`.opencode/agents/*.md`)

Markdown agents with frontmatter (`description`, `mode: subagent`, `model`,
`permissions`). Permissions start from OpenCode's allow-all base policy; each
studio agent narrows itself (no web; architect and QA can't touch `game/`). The
`window.__studio = { start(), state() }` hook in the game is the contract the
playtest driver and the agents all rely on.

### Dashboard (`web/`)

One zero-dependency Node server (`web/server.mjs`, Node ≥ 18): serves the UI
(`web/public/index.html`), the game (`/game`), and screenshots (`/shots/...`),
and broadcasts bus events, git commits, and new screenshots over SSE
(`/events`). No npm install, no build step.

### Playtest (`scripts/playtest.mjs`)

Zero-dependency CDP driver (Node ≥ 22 `WebSocket`): launches
`google-chrome-stable` headless (`--no-sandbox` fallback if the user sandbox
refuses), PUTs a new tab to the game, listens for page errors/console errors,
calls `__studio.start()`, cycles synthetic key input, samples `__studio.state()`
once a second, takes three screenshots, and prints a JSON verdict
(`PASS`/`FAIL`, checks, errors, states, shot paths) — exit code 0/1.

## Layout

```
.opencode/agents/   architect.md  engineer.md  qa.md     ← role + model + permissions
studio/             prompt.txt  plan.md  bugs.md  bus/  shots/
game/               index.html                          ← the product (one file, canvas 2d)
web/                server.mjs  public/index.html       ← dashboard
scripts/            playtest.mjs  studio.sh             ← CDP driver, replay orchestrator
```

## Notes & trade-offs

- **Local = slow-ish.** A 1k-token answer costs ~8–20 s of wall time; a full
  build + QA loop runs minutes. That slowness *is* the demo — you can watch it.
- **One agent per GPU** is the default (multiple per GPU would split its
  context); the studio runs architect and engineer on the same RTX 3090,
  which is fine because they run sequentially. Alternative placements exist
  on the proxy if a GPU is busy — see `AGENTS.md`.
- The dashboard binds `127.0.0.1` only. The game is a single self-contained HTML
  file; anything the engineer adds must stay library-free and asset-free (the
  QA playtest and the "0 cloud calls" promise depend on it).
- `studio/bus/.lock` and replay screenshot dirs are gitignored; live-run
  screenshots, the bus, plans, and bugs are all committed — the repo *is* the
  studio's memory.
