#!/usr/bin/env bash
# Double-click launcher — opens Terminal and runs launch.sh (works in ~/Documents).
cd "$(cd "$(dirname "$0")" && pwd)"
export FLOWX_FROM_APP=1
exec ./launch.sh
