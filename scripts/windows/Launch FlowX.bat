@echo off
REM FlowX launcher with console (errors visible). Silent: Launch FlowX.vbs
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
if errorlevel 1 (
    echo.
    echo [FlowX] Launch failed. See messages above.
    pause
    exit /b 1
)
echo.
echo [FlowX] Stopped.
pause
