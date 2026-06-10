@echo off
REM ============================================================
REM  GeoFlow / NotebookFlow one-click launcher (Windows)
REM  - creates backend venv + installs deps on first run
REM  - starts backend (port 8000) and frontend (port 5173)
REM  - opens the app in your browser
REM ============================================================
setlocal

REM Optional: put your AI planner keys in ai.env.bat next to this file, e.g.
REM   set AI_API_BASE_URL=https://your-gateway/v1
REM   set AI_API_KEY=sk-...
REM   set AI_MODEL=deepseek-chat
if exist "%~dp0ai.env.bat" call "%~dp0ai.env.bat"

REM ---------- backend ----------
cd /d "%~dp0notebookflow\backend"

if not exist .venv (
    echo [GeoFlow] Creating Python virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo [GeoFlow] ERROR: failed to create venv. Is Python 3.10+ on PATH?
        pause
        exit /b 1
    )
)

call .venv\Scripts\activate.bat
echo [GeoFlow] Installing backend dependencies (fast if already installed)...
pip install -r requirements.txt -q

start "NotebookFlow Backend (port 8000)" cmd /k "cd /d %~dp0notebookflow\backend && call .venv\Scripts\activate.bat && uvicorn app.main:app --reload --port 8000"

REM ---------- frontend ----------
cd /d "%~dp0notebookflow\frontend"

if not exist node_modules (
    echo [GeoFlow] Installing frontend dependencies (first run only)...
    call npm install
    if errorlevel 1 (
        echo [GeoFlow] ERROR: npm install failed. Is Node.js installed?
        pause
        exit /b 1
    )
)

start "NotebookFlow Frontend (port 5173)" cmd /k "cd /d %~dp0notebookflow\frontend && npm run dev"

REM ---------- open browser ----------
echo [GeoFlow] Waiting for dev servers to boot...
timeout /t 5 /nobreak >nul
start http://localhost:5173

echo [GeoFlow] Launched. Close the two server windows to stop.
endlocal
