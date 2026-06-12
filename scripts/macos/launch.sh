#!/usr/bin/env bash
# FlowX macOS launcher — background backend/frontend + Chrome/Edge app window.
# Closing the FlowX app window stops servers (unless --detach or browser mode).
set -euo pipefail

HERE="$(cd "${FLOWX_MACOS_DIR:-$(dirname "$0")}" && pwd)"
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
WINDOW_MODE="native"
AUTO_STOP=true

if [[ -f "$CONFIG" ]]; then
  # eval, not source <(...) — process substitution breaks config load on macOS bash.
  # shellcheck disable=SC1090
  eval "$(python3 - "$CONFIG" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    c = json.load(f)
wm = c.get("window_mode", "native")
if wm not in ("native", "app", "browser", "none"):
    wm = "native"
print("BE_PORT=%d" % int(c.get("backend_port", 8000)))
print("FE_PORT=%d" % int(c.get("frontend_port", 5173)))
print("OPEN_BROWSER=%s" % str(bool(c.get("open_browser", True))).lower())
print("WINDOW_MODE=%s" % wm)
print("AUTO_STOP=%s" % str(bool(c.get("auto_stop_on_close", True))).lower())
PY
  )"
fi

UI_URL="http://127.0.0.1:${FE_PORT}"

info() { echo "[FlowX] $*"; }

info "Window mode: $WINDOW_MODE"

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
  # .app double-click has no shell profile — check venv + conda before system python3.
  for candidate in \
    "$BACKEND/.venv/bin/python" \
    /opt/anaconda3/bin/python3 \
    /opt/anaconda3/bin/python \
    "${CONDA_PREFIX:+$CONDA_PREFIX/bin/python3}" \
    "${CONDA_PREFIX:+$CONDA_PREFIX/bin/python}" \
    "$HOME/anaconda3/bin/python3" \
    "$HOME/miniconda3/bin/python3" \
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
  # Main Chrome process: --app= and FlowX profile (order varies by launch path).
  pgrep -f "Google Chrome --.*FlowX/app-shell" >/dev/null 2>&1
}

stop_flowx_chromium() {
  pkill -f "FlowX/app-shell" 2>/dev/null || true
}

wait_flowx_app_closed() {
  info "Close the FlowX window to stop backend and frontend."
  local i=0
  while (( i < 15 )); do
    is_flowx_app_running && break
    sleep 2
    ((i++)) || true
  done
  if ! is_flowx_app_running; then
    info "WARNING: App window not detected — servers stay up. Stop: ./stop.sh"
    return 1
  fi
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
  stop_flowx_chromium
  return 0
}

open_flowx_app() {
  mkdir -p "$FLOWX_PROFILE"
  local args=(--new-window "--app=${UI_URL}" "--user-data-dir=${FLOWX_PROFILE}" --no-first-run --disable-extensions)
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    open -na "Google Chrome" --args "${args[@]}"
    info "Opening app window via Google Chrome at ${UI_URL}"
  elif [[ -d "/Applications/Microsoft Edge.app" ]]; then
    open -na "Microsoft Edge" --args "${args[@]}"
    info "Opening app window via Microsoft Edge at ${UI_URL}"
  else
    info "Chrome/Edge not found — opening default browser (no auto-stop)."
    open "$UI_URL"
    return 1
  fi
  local i=0
  while (( i < 20 )); do
    if is_flowx_app_running; then
      info "FlowX app window is open."
      return 0
    fi
    sleep 0.5
    ((i++)) || true
  done
  info "App window not confirmed — opening ${UI_URL} in default browser."
  open "$UI_URL"
  return 1
}

open_flowx_native() {
  local icon="$HERE/FlowX.app/Contents/Resources/FlowX.icns"
  [[ -f "$icon" ]] || icon=""
  info "Opening native FlowX window (mode=$WINDOW_MODE) at ${UI_URL}"
  python -c "import webview" 2>/dev/null || {
    info "Installing pywebview (first run)..."
    python -m pip install "pywebview>=6.2" pyobjc-framework-Cocoa pyobjc-framework-WebKit -q
  }
  if ! python -c "import webview" 2>/dev/null; then
    info "ERROR: pywebview install failed — falling back to Chrome app window."
    open_flowx_app
    return $?
  fi
  python "$HERE/native_window.py" "$UI_URL" "${icon:-}"
}

_CLEANUP_DONE=false
cleanup_servers() {
  if [[ "$_CLEANUP_DONE" == true ]]; then
    return 0
  fi
  _CLEANUP_DONE=true
  info "Stopping servers..."
  stop_flowx_chromium
  "$HERE/stop.sh"
}

[[ -f "$REPO_ROOT/ai.env" ]] && source "$REPO_ROOT/ai.env"

PY="$(find_python)" || {
  info "ERROR: Python 3.10+ not found. brew install python or set NOTEBOOKFLOW_PYTHON."
  [[ "${FLOWX_FROM_APP:-}" == "1" ]] && osascript -e 'display alert "FlowX: Python 3.10+ not found" message "Install Python or set python in scripts/macos/config.json" as warning' 2>/dev/null || true
  exit 1
}
NPM="$(find_npm)" || {
  info "ERROR: npm not found. brew install node"
  [[ "${FLOWX_FROM_APP:-}" == "1" ]] && osascript -e 'display alert "FlowX: npm not found" message "Install Node.js: brew install node" as warning' 2>/dev/null || true
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
NATIVE_BLOCK=false
if [[ "$OPEN_BROWSER" == true && "$SKIP_BROWSER" == false ]]; then
  sleep 1
  if [[ "$USE_BROWSER" == true || "$WINDOW_MODE" == "browser" ]]; then
    open "$UI_URL"
    info "Opened in default browser. Use ./stop.sh to stop servers."
  elif [[ "$WINDOW_MODE" == "native" ]]; then
    if [[ "$AUTO_STOP" == true && "$DETACH" == false ]]; then
      NATIVE_BLOCK=true
    else
      open_flowx_native &
      info "Native window opened in background. Stop: ./stop.sh"
    fi
  elif [[ "$WINDOW_MODE" != "none" ]]; then
    if open_flowx_app; then
      if [[ "$AUTO_STOP" == true && "$DETACH" == false ]]; then
        WATCH_APP=true
      fi
    fi
  fi
fi

if [[ "$NATIVE_BLOCK" == true ]]; then
  open_flowx_native
  cleanup_servers
  info "FlowX stopped."
elif [[ "$WATCH_APP" == true ]]; then
  if wait_flowx_app_closed; then
    cleanup_servers
    info "FlowX stopped."
  else
    info "FlowX servers still running. Stop: ./stop.sh"
  fi
elif [[ "$DETACH" == true || "$SKIP_BROWSER" == true ]]; then
  info "Servers running in background. Stop: ./stop.sh"
else
  info "Servers running. Stop: ./stop.sh"
fi

exit 0
