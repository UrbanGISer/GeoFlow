@echo off
REM GeoFlow / NotebookFlow launcher — default conda env: geoxai
setlocal EnableExtensions

if exist "%~dp0ai.env.bat" call "%~dp0ai.env.bat"

if not defined NOTEBOOKFLOW_CONDA_ENV set "NOTEBOOKFLOW_CONDA_ENV=geoxai"
set "PY=%USERPROFILE%\.conda\envs\%NOTEBOOKFLOW_CONDA_ENV%\python.exe"
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "BACKEND=%ROOT%\notebookflow\backend"
set "FRONTEND=%ROOT%\notebookflow\frontend"

if not exist "%PY%" (
    echo [GeoFlow] ERROR: conda env "%NOTEBOOKFLOW_CONDA_ENV%" not found at:
    echo   %PY%
    pause
    exit /b 1
)

echo [GeoFlow] Using conda env: %NOTEBOOKFLOW_CONDA_ENV%
echo [GeoFlow] Python: %PY%

"%PY%" -c "import sys; assert sys.version_info>=(3,10); import pandas" >nul 2>&1
if errorlevel 1 (
    echo [GeoFlow] ERROR: %NOTEBOOKFLOW_CONDA_ENV% cannot import pandas.
    pause
    exit /b 1
)

cd /d "%BACKEND%"
echo [GeoFlow] Installing backend dependencies
"%PY%" -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo [GeoFlow] ERROR: pip install failed.
    pause
    exit /b 1
)

start "NotebookFlow Backend 8000" cmd /k "cd /d \"%BACKEND%\" && \"%PY%\" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

cd /d "%FRONTEND%"
if not exist node_modules (
    echo [GeoFlow] Installing frontend dependencies - first run only
    call npm install
    if errorlevel 1 (
        echo [GeoFlow] ERROR: npm install failed.
        pause
        exit /b 1
    )
)

start "NotebookFlow Frontend 5173" cmd /k "cd /d \"%FRONTEND%\" && npm run dev"

echo [GeoFlow] Waiting for dev servers to boot
timeout /t 6 /nobreak >nul
start http://localhost:5173

echo [GeoFlow] Launched. Close the two server windows to stop.
echo [GeoFlow] Verify nodes: http://127.0.0.1:8000/api/nodes
endlocal
exit /b 0
