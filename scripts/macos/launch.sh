#!/usr/bin/env bash
# FlowX macOS launcher — background backend/frontend + Chrome/Edge app window.
# Closing the FlowX app window stops servers (unless --detach or browser mode).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
BACKEND="$REPO_ROOT/notebookflow/backend"
FRONTEND="$REPO_ROOT/notebookflow/frontend"
CONFIG="$HERE/config.json"
LOG_DIR="$HOME/Library/Logs/FlowX"
FLOWX_PROFILE="$HOME/Library/Application Support/FlowX/app-shell"

SHOW_FE=false
SKIP_BROWSER=false
USE_BROWSER=false
DETACH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --show-frontend-window) SHOW_FE=true; shift ;;
    --skip-browser) SKIP_BROWSER=true; shift ;;
    --use-browser) USE_BROWSER=true; shift ;;
    --detach) DETACH=true; shift ;;
    -h|--help)
      echo "Usage: ./launch.sh [--show-frontend-window] [--skip-browser] [--use-browser] [--detach]"
      exit 0
      ;;
    *) echo "[FlowX] Unknown option: $1" >&2; exit 1 ;;
  esac
done

BE_PORT=8000
FE_PORT=5173
OPEN_BROWSER=true
WINDOW_MODE="app"
AUTO_STOP=true

if [[ -f "$CONFIG" ]]; then
  # Avoid eval/repr — macOS bash 3.2 chokes on WINDOW_MODE='app' from Python !r.
  # shellcheck disable=SC1090
  source <(python3 - "$CONFIG" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    c = json.load(f)
wm = c.get("window_mode", "app")
if wm not in ("app", "browser", "none"):
    wm = "app"
print("BE_PORT=%d" % int(c.get("backend_port", 8000)))
print("FE_PORT=%d" % int(c.get("frontend_port", 5173)))
print("OPEN_BROWSER=%s" % str(bool(c.get("open_browser", True))).lower())
print("WINDOW_MODE=%s" % wm)
print("AUTO_STOP=%s" % str(bool(c.get("auto_stop_on_close", True))).lower())
PY
  )
fi

UI_URL="http://127.0.0.1:${FE_PORT}"

info() { echo "[FlowX] $*"; }

find_python() {
  if [[ -n "${NOTEBOOKFLOW_PYTHON:-}" && -x "$NOTEBOOKFLOW_PYTHON" ]]; then
    echo "$NOTEBOOKFLOW_PYTHON"
    return 0
  fi
  local cfg_py=""
  if [[ -f "$CONFIG" ]]; then
    cfg_py="$(python3 - "$CONFIG" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f).get("python") or "")
PY
)"
  fi
  if [[ -n "$cfg_py" && -x "$cfg_py" ]]; then
    echo "$cfg_py"
    return 0
  fi
  local candidate
  for candidate in \
    /opt/homebrew/bin/python3 \
    /usr/local/bin/python3 \
    "$(command -v python3 2>/dev/null || true)"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

find_npm() {
  if [[ -n "${NOTEBOOKFLOW_NPM:-}" && -x "$NOTEBOOKFLOW_NPM" ]]; then
    echo "$NOTEBOOKFLOW_NPM"
    return 0
  fi
  local candidate
  for candidate in \
    /opt/homebrew/bin/npm \
    /usr/local/bin/npm \
    "$(command -v npm 2>/dev/null || true)"; do
    [[ -n "$candidate" && -x "$candidate" ]] && echo "$candidate" && return 0
  done
  return 1
}

wait_url() {
  local url="$1"
  local seconds="${2:-45}"
  local i=0
  while (( i < seconds * 2 )); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
    ((i++)) || true
  done
  return 1
}

is_flowx_app_running() {
  # Match Chromium using FlowX profile + app URL
  ps aux 2>/dev/null | grep -E '[F]lowX/app-shell' | grep -q -- "--app=${UI_URL}"
}

wait_flowx_app_closed() {
  info "Close the FlowX window to stop backend and frontend."
  sleep 2
  local gone=0
  while true; do
    if is_flowx_app_running; then
      gone=0
    else
      ((gone++)) || true
      if (( gone >= 3 )); then
        break
      fi
    fi
    sleep 2
  done
}

open_flowx_app() {
  mkdir -p "$FLOWX_PROFILE"
  local chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  local edge="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  local args=(--new-window "--app=${UI_URL}" "--user-data-dir=${FLOWX_PROFILE}" --no-first-run --disable-extensions)
  if [[ -x "$chrome" ]]; then
    "$chrome" "${args[@]}" >/dev/null 2>&1 &
    info "Opened app window via Google Chrome at ${UI_URL}"
    return 0
  fi
  if [[ -x "$edge" ]]; then
    "$edge" "${args[@]}" >/dev/null 2>&1 &
    info "Opened app window via Microsoft Edge at ${UI_URL}"
    return 0
  fi
  info "Chrome/Edge not found — opening default browser (no auto-stop)."
  open "$UI_URL"
  return 1
}

cleanup_servers() {
  info "Stopping servers..."
  "$HERE/stop.sh"
}

[[ -f "$REPO_ROOT/ai.env" ]] && source "$REPO_ROOT/ai.env"

PY="$(find_python)" || {
  info "ERROR: Python 3.10+ not found. brew install python or set NOTEBOOKFLOW_PYTHON."
  exit 1
}
NPM="$(find_npm)" || {
  info "ERROR: npm not found. brew install node"
  exit 1
}

export PATH="$(dirname "$NPM"):$PATH"

info "Repo:     $REPO_ROOT"
info "Python:   $PY"
info "Backend:  http://127.0.0.1:${BE_PORT}"
info "Frontend: ${UI_URL}"

mkdir -p "$LOG_DIR"

"$HERE/stop.sh" >/dev/null 2>&1 || true
sleep 1

cd "$BACKEND"
if [[ ! -d .venv ]]; then
  info "Creating Python virtual environment..."
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
info "Installing backend dependencies..."
python -m pip install -r requirements.txt -q

info "Starting backend..."
nohup python -m uvicorn app.main:app --reload --host 127.0.0.1 --port "$BE_PORT" \
  >"$LOG_DIR/backend.log" 2>&1 &
echo $! >"$LOG_DIR/backend.pid"

cd "$FRONTEND"
if [[ ! -d node_modules ]]; then
  info "First run: npm install..."
  "$NPM" install
fi

info "Starting frontend..."
if [[ "$SHOW_FE" == true ]]; then
  "$NPM" run dev -- --port "$FE_PORT" --host 127.0.0.1 --strictPort &
  echo $! >"$LOG_DIR/frontend.pid"
else
  nohup "$NPM" run dev -- --port "$FE_PORT" --host 127.0.0.1 --strictPort \
    >"$LOG_DIR/frontend.log" 2>&1 &
  echo $! >"$LOG_DIR/frontend.pid"
fi

info "Waiting for servers..."
wait_url "http://127.0.0.1:${BE_PORT}/api/health" 45 || {
  info "ERROR: Backend did not start. See $LOG_DIR/backend.log"
  cleanup_servers
  exit 1
}
wait_url "http://127.0.0.1:${FE_PORT}/api/health" 60 || {
  info "ERROR: Frontend proxy not ready. See $LOG_DIR/frontend.log"
  cleanup_servers
  exit 1
}
wait_url "$UI_URL" 30 || {
  info "ERROR: Frontend did not start. See $LOG_DIR/frontend.log"
  cleanup_servers
  exit 1
}

NODE_COUNT="$(curl -fsS "http://127.0.0.1:${BE_PORT}/api/nodes" 2>/dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo "?")"
info "Ready - ${NODE_COUNT} nodes in library."

WATCH_APP=false
if [[ "$OPEN_BROWSER" == true && "$SKIP_BROWSER" == false ]]; then
  sleep 1
  if [[ "$USE_BROWSER" == true || "$WINDOW_MODE" == "browser" ]]; then
    open "$UI_URL"
    info "Opened in default browser. Use ./stop.sh to stop servers."
  elif [[ "$WINDOW_MODE" != "none" ]]; then
    if open_flowx_app; then
      if [[ "$AUTO_STOP" == true && "$DETACH" == false ]]; then
        WATCH_APP=true
      fi
    fi
  fi
fi

if [[ "$WATCH_APP" == true ]]; then
  trap cleanup_servers EXIT INT TERM
  wait_flowx_app_closed
  cleanup_servers
elif [[ "$DETACH" == true || "$SKIP_BROWSER" == true ]]; then
  info "Servers running in background. Stop: ./stop.sh"
else
  info "Servers running. Stop: ./stop.sh"
fi
