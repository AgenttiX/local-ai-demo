# AGENTS.md

## Project instructions
- The main agent may update this AGENTS.md as needed.

## Version control
- Commit your work automatically.
- Don't edit files outside of this repository.

## AI backends
You have access to three LLM backends.
Prefer to run one agent on each.
You can also run multiple agents per backend, but this splits their available context.
- Qwen3.8-27B: RTX 3090, context size 139264, 128 tokens/s
- Qwen3.8-Flash-Next: RTX 3070, context size 57344, 55 tokens/s
- Gemma 4 26B A4B QAT: Radeon VII, context size 88064, 124 tokens/s
