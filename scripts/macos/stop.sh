#!/usr/bin/env bash
# Stop FlowX dev servers on configured ports.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$HERE/config.json"
BE_PORT=8000
FE_PORT=5173
LOG_DIR="$HOME/Library/Logs/FlowX"

if [[ -f "$CONFIG" ]]; then
  eval "$(python3 - "$CONFIG" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    c = json.load(f)
print("BE_PORT=%d" % int(c.get("backend_port", 8000)))
print("FE_PORT=%d" % int(c.get("frontend_port", 5173)))
PY
  )"
fi

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    echo "[FlowX] Port $port - stopped."
  else
    echo "[FlowX] Port $port - nothing listening."
  fi
}

# Chromium helpers can outlive the --app window.
pkill -f "FlowX/app-shell" 2>/dev/null || true

kill_port "$BE_PORT"
kill_port "$FE_PORT"

for pidfile in "$LOG_DIR/backend.pid" "$LOG_DIR/frontend.pid"; do
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]]; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
done

echo "[FlowX] Done."
