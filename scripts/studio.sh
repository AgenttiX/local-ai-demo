#!/bin/bash
# Replay the whole 3-agent studio build, headless:
#   architect (27B/3090) designs -> engineer (27B/3090) implements
#   -> QA (Gemma-4-26B/RadeonVII) playtests in a real headless browser
#   -> fix loop until QA passes or MAX_ROUNDS is exhausted -> commit.
#
# Usage: scripts/studio.sh ["one-sentence brief"]
# Env:   PORT (dashboard, default 8790)  MAX_ROUNDS (default 3)
set -uo pipefail
cd "$(dirname -- "$0")/.."
# make sure a usable node is on PATH (nvm default), even from a stale environment
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
command -v node >/dev/null 2>&1 || nvm use --silent default >/dev/null 2>&1
command -v node >/dev/null 2>&1 || { echo "error: node not found (nvm default?)" >&2; exit 1; }

BRIEF="${1:-$(cat studio/prompt.txt)}"
PORT="${PORT:-8790}"
MAX_ROUNDS="${MAX_ROUNDS:-3}"
ARCH="litellm/agx-z2e/Qwen/Qwen3.8-27B"
ENG="litellm/agx-z2e/Qwen/Qwen3.8-27B"
QA="litellm/agx-z2e-rocm/google/gemma-4-26b-a4b-qat"

say() { printf '\n\033[1;36m━━ %s\033[0m\n' "$*"; }
role() { awk 'BEGIN{n=0} /^---[ \t]*$/{n++; next} n==1' "$1"; }
# Run one studio agent session, bracketed by `start`/`done` bus events so the
# dashboard lights reflect the session: on while the agent runs (no matter how
# quiet it is), off when it ends — even if it fails.
run_agent() {
  local a="$1" m="$2" rc=0
  studio/bus/append.sh "$a" start "session start: $a ($m)"
  opencode run -m "$m" --auto "$(role ".opencode/agents/$a.md")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    studio/bus/append.sh "$a" done "session end: $a"
  else
    studio/bus/append.sh "$a" done "session end: $a (opencode run failed, rc=$rc)"
  fi
  return "$rc"
}

echo "brief: $BRIEF"
echo "dashboard: http://localhost:$PORT"
PORT="$PORT" node web/server.mjs &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 0.5

say "1/5  ARCHITECT  ($ARCH) — design the game"
run_agent architect "$ARCH"

say "2/5  ENGINEER   ($ENG) — first implementation"
run_agent engineer "$ENG"

PASS=""
for round in $(seq 1 "$MAX_ROUNDS"); do
  say "3/5  QA         ($QA) — playtest round $round"
  mkdir -p /tmp/opencode
  node scripts/playtest.mjs --url "http://localhost:$PORT/game/" --out "studio/shots/replay-$round" > /tmp/opencode/pt-$round.json 2>&1
  pt_rc=$?
  run_agent qa "$QA"
  if [ "$pt_rc" -eq 0 ]; then
    PASS=$round
    break
  fi
  say "4/5  ENGINEER   — bug-fix round $round"
  run_agent engineer "$ENG"
done

say "5/5  finalize"
if [ -n "$PASS" ]; then
  studio/bus/append.sh studio milestone "replay finished: QA PASS on round $PASS"
else
  studio/bus/append.sh studio error "replay finished without a clean pass in $MAX_ROUNDS rounds — see studio/bugs.md"
fi
git add -A
git commit -q -m "studio(replay): $BRIEF"

echo
if [ -n "$PASS" ]; then
  echo "✔ QA PASS on round $PASS — the game at game/index.html is playable"
else
  echo "✘ no clean pass in $MAX_ROUNDS rounds — read studio/bugs.md"
fi
