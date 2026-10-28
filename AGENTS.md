# AGENTS.md

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
| `litellm/agx-z2e/Qwen/Qwen3.8-27B` | RTX 3090 (agx-z2e) | 139264 | 128 tok/s | Architect / lead coder; strongest model, tuned for agentic coding |
| `litellm/agx-ai/Qwen/Qwen3.8-Flash-Next` | RTX 3070 (agx-ai) | 57344 | 55 tok/s | Implementation with native tool calling (`qwen3_coder`); slowest, keep its context small |
| `litellm/agx-z2e-rocm/google/gemma-4-26b-a4b-qat` | Radeon VII (agx-z2e) | 88064 | 124 tok/s | QA / second opinions; accepts image input (screenshots) |

Prefer to run one agent on each backend. You can run multiple agents per
backend, but that splits their available context. Inference is fully local
(no cloud, no per-token cost) but slow: a 1k-token answer takes ~8-20 s.
Run long subagent work in the background and keep prompts compact.

If a canonical GPU is busy, alternative placements exist on the proxy, e.g.
`litellm/big-machine/Qwen/Qwen3.8-27B`, `litellm/agx-z2e/Qwen/Qwen3.8-Flash-Next`,
`litellm/agx-ai/google/gemma-4-26b-a4b-qat`.
