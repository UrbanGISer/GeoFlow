@echo off
REM Full browser tab — servers do NOT auto-stop when tab closes. Use stop.ps1.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" -UseBrowser -Detach
if errorlevel 1 pause
