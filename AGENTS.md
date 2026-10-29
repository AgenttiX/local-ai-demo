# AGENTS.md
This repository contains a demo of the capabilities of local AI agents.

## Project instructions
- The main agent may update this AGENTS.md as needed.

## Version control
- Commit your work automatically.
- Don't edit files outside of this repository.

## AI backends
OpenCode connects to a LiteLLM proxy (provider ID `litellm`) that fronts
three local LLM servers. Use them as subagents: call the `subagent` tool with
`model` set to one of the IDs below. Do not call the raw inference endpoints
(ports 9931/9932) directly, and never put API keys in this repo — the proxy
handles authentication.

| Subagent model ID | GPU (host) | Context | ~Speed | Good for |
| --- | --- | --- | --- | --- |
| `litellm/agx-z2e/Qwen/Qwen3.8-27B` | RTX 3090 (agx-z2e) | 139264 | 128 tok/s | Architect & engineer; strongest model, tuned for agentic coding |
| `litellm/agx-z2e/Qwen/Qwen3.8-Flash-Next` | RTX 3090 (agx-z2e) | 57344 | 55 tok/s | Lightweight model with native tool calling (`qwen3_coder`); slowest, keep its context small |
| `litellm/agx-z2e-rocm/google/gemma-4-26b-a4b-qat` | Radeon VII (agx-z2e) | 88064 | 124 tok/s | QA / second opinions; accepts image input (screenshots) |

Prefer to run one agent on each backend. You can run multiple agents per
backend, but that splits their available context. Inference is fully local
(no cloud, no per-token cost) but slow: a 1k-token answer takes ~8-20 s.
Run long subagent work in the background and keep prompts compact.

If a canonical GPU is busy, alternative placements exist on the proxy, e.g.
`litellm/big-machine/Qwen/Qwen3.8-27B`, `litellm/agx-ai/Qwen/Qwen3.8-Flash-Next`,
`litellm/agx-ai/google/gemma-4-26b-a4b-qat`.

## Studio demo
This repo is the "3-agent game studio" demo: architect/engineer/qa subagents
(defined in `.opencode/agents/*.md`, each pinned to its GPU) collaboratively build
`game/index.html` from a one-sentence brief (`studio/prompt.txt`) and are
monitored by the dashboard (`node web/server.mjs` → `:8790`).
- The shared filesystem *is* the bus: log with `studio/bus/append.sh <agent> <type> "<text>"`;
  per-agent inboxes are in `studio/bus/in/`; design in `studio/plan.md`; bugs in `studio/bugs.md`.
  Types: `start done info decision plan code fix bug test shot milestone verdict error`.
- Every agent session is **bracketed on the bus**: each subagent writes a `start`
  event as its first action and a `done` event as its last (protocol in
  `.opencode/agents/*.md`); `scripts/studio.sh` brackets each `opencode run` the same
  way. As orchestrator, when a subagent call returns, check that agent's last
  lifecycle event — if it's still `start` (session left open, e.g. the agent died),
  append `<agent> done "…"` yourself so the dashboard light resolves. The dashboard
  lights follow these events: fresh `start` → light on for the whole run, `done` →
  light off, `start` with no `done` after 30 min → steady amber (interrupted run).
- Subagents never run git (orchestrator commits at phase boundaries).
- QA's playtest driver: `node scripts/playtest.mjs` (headless Chrome over CDP, zero deps).
- Headless replay of the whole build: `scripts/studio.sh "<brief>"`.
- Dashboard: `node web/server.mjs` from the repo root — zero-dep Node (>= 18),
  listens on 127.0.0.1:8790 (override with PORT). UI at `/`, live SSE feed at
  `/events`, playable game at `/game`, QA screenshots at `/shots/`. Open
  http://localhost:8790 in the integrated browser to watch a run.
- Full protocol: README.md.
