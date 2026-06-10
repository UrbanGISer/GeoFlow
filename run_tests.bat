@echo off
REM Run NotebookFlow backend smoke tests (engine cache, AI planner, notebook import).
setlocal
cd /d "%~dp0notebookflow\backend"

if exist .venv (
    call .venv\Scripts\activate.bat
)

python tests\test_smoke.py
echo.
pause
endlocal
