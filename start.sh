#!/usr/bin/env bash
# GeoFlow / NotebookFlow one-click launcher (macOS / Linux).
# Creates backend venv + installs deps on first run, then starts
# backend (port 8000) and frontend (port 5173).
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

# Optional AI planner keys: create ai.env next to this script, e.g.
#   export AI_API_BASE_URL=https://your-gateway/v1
#   export AI_API_KEY=sk-...
#   export AI_MODEL=deepseek-chat
[ -f "$ROOT/ai.env" ] && source "$ROOT/ai.env"

cd "$ROOT/notebookflow/backend"
if [ ! -d .venv ]; then
    echo "[GeoFlow] Creating Python virtual environment..."
    python3 -m venv .venv
fi
source .venv/bin/activate
echo "[GeoFlow] Installing backend dependencies (fast if already installed)..."
pip install -r requirements.txt -q

uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!
trap 'kill $BACKEND_PID 2>/dev/null' EXIT

cd "$ROOT/notebookflow/frontend"
if [ ! -d node_modules ]; then
    echo "[GeoFlow] Installing frontend dependencies (first run only)..."
    npm install
fi

( sleep 5 && command -v open >/dev/null && open http://localhost:5173 ) &
npm run dev
