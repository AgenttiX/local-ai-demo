#!/bin/sh
# Studio bus: append one event to studio/bus/events.jsonl (flock-serialized, JSON-safe).
# Usage: studio/bus/append.sh <agent> <type> <text>
#   agent: architect | engineer | qa | studio
#   type:  info | decision | plan | code | fix | bug | test | shot | milestone | verdict | error
set -eu
[ "$#" -ge 3 ] || { echo "usage: $0 <agent> <type> <text>" >&2; exit 2; }
a="$1" t="$2"; shift 2
case "$a" in
  architect|engineer|qa|studio) ;;
  *) echo "unknown agent: $a (want architect|engineer|qa|studio)" >&2; exit 2 ;;
esac
d=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
flock "$d/.lock" node -e '
  const fs = require("node:fs");
  const [, p, agent, type, text] = process.argv; // argv[0] is the node binary itself
  const ev = { t: Date.now(), agent, type, text: String(text).slice(0, 400) };
  fs.appendFileSync(p, JSON.stringify(ev) + "\n");
  console.log("bus: " + agent + " / " + type + " / " + ev.text);
' "$d/events.jsonl" "$a" "$t" "$*"
