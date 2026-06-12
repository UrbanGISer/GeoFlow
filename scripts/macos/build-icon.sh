#!/usr/bin/env bash
# Regenerate FlowX.app/Contents/Resources/FlowX.icns (squircle + transparent corners).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${NOTEBOOKFLOW_PYTHON:-}"
if [[ -z "$PY" && -x "$HERE/../../notebookflow/backend/.venv/bin/python" ]]; then
  PY="$HERE/../../notebookflow/backend/.venv/bin/python"
fi
PY="${PY:-python3}"
exec "$PY" "$HERE/build-icon.py"
