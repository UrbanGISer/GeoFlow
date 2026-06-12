#!/usr/bin/env bash
# GeoFlow / NotebookFlow one-click launcher (macOS / Linux).
# macOS: prefers Homebrew python3 (/opt/homebrew or /usr/local) and npm.
# Override: export NOTEBOOKFLOW_PYTHON=/path/to/python3
#           export NOTEBOOKFLOW_NPM=/path/to/npm
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/notebookflow/backend"
FRONTEND="$ROOT/notebookflow/frontend"

# Optional AI planner keys: create ai.env next to this script, e.g.
#   export AI_API_BASE_URL=https://your-gateway/v1
#   export AI_API_KEY=sk-...
#   export AI_MODEL=deepseek-chat
[ -f "$ROOT/ai.env" ] && source "$ROOT/ai.env"

find_python() {
  local candidate
  if [ -n "${NOTEBOOKFLOW_PYTHON:-}" ] && [ -x "$NOTEBOOKFLOW_PYTHON" ]; then
    echo "$NOTEBOOKFLOW_PYTHON"
    return 0
  fi
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
    [ -n "$candidate" ] || continue
    [ -x "$candidate" ] || continue
    if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

find_npm() {
  local candidate
  if [ -n "${NOTEBOOKFLOW_NPM:-}" ] && [ -x "$NOTEBOOKFLOW_NPM" ]; then
    echo "$NOTEBOOKFLOW_NPM"
    return 0
  fi
  for candidate in \
    /opt/homebrew/bin/npm \
    /usr/local/bin/npm \
    "$(command -v npm 2>/dev/null || true)"; do
    [ -n "$candidate" ] || continue
    [ -x "$candidate" ] && echo "$candidate" && return 0
  done
  return 1
}

PY="$(find_python)" || {
  echo "[GeoFlow] ERROR: Python 3.10+ not found."
  echo "macOS with Homebrew: brew install python"
  echo "Or set NOTEBOOKFLOW_PYTHON to your python3 path."
  exit 1
}

NPM="$(find_npm)" || {
  echo "[GeoFlow] ERROR: node/npm not found."
  echo "macOS with Homebrew (recommended):"
  echo "  brew install node"
  echo "Then close Terminal, reopen, and run ./start.sh again."
  echo "Check: node -v && npm -v"
  exit 1
}

NODE_DIR="$(cd "$(dirname "$NPM")" && pwd)"
export PATH="$NODE_DIR:$PATH"

echo "[GeoFlow] Python: $PY ($("$PY" --version 2>&1))"
echo "[GeoFlow] npm:    $NPM ($("$NPM" --version 2>&1))"
command -v node >/dev/null 2>&1 && echo "[GeoFlow] node:   $(command -v node) ($(node --version 2>&1))"

cd "$BACKEND"
if [ ! -d .venv ]; then
  echo "[GeoFlow] Creating Python virtual environment..."
  "$PY" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
echo "[GeoFlow] Installing backend dependencies..."
python -m pip install -r requirements.txt -q

echo "[GeoFlow] Starting backend on http://127.0.0.1:8000"
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
cleanup() {
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$FRONTEND"
if [ ! -d node_modules ]; then
  echo "[GeoFlow] Installing frontend dependencies - first run only"
  "$NPM" install
fi

( sleep 6 && command -v open >/dev/null && open "http://localhost:5173" ) &
echo "[GeoFlow] Starting frontend on http://localhost:5173"
echo "[GeoFlow] Verify nodes: http://127.0.0.1:8000/api/nodes"
echo "[GeoFlow] Press Ctrl+C to stop both servers."
"$NPM" run dev
