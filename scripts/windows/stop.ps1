# Stop FlowX dev servers on configured ports (8000 / 5173 by default).
# Kills uvicorn --reload orphans that can stack up on Windows and serve stale code.
$ErrorActionPreference = "SilentlyContinue"
$Here = $PSScriptRoot
$ConfigPath = Join-Path $Here "config.json"

$bePort = 8000
$fePort = 5173
if (Test-Path $ConfigPath) {
    $raw = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    if ($null -ne $raw.backend_port) { $bePort = [int]$raw.backend_port }
    if ($null -ne $raw.frontend_port) { $fePort = [int]$raw.frontend_port }
}

function Stop-ByCommandLine([string]$Pattern) {
    $n = 0
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -match $Pattern
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $n++
    }
    return $n
}

function Stop-PortListeners([int]$Port) {
    $killed = 0
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            if ($_.OwningProcess -gt 0) {
                Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
                $killed++
            }
        }
    return $killed
}

# uvicorn --reload spawns multiprocessing workers; they keep serving stale code after git pull.
$uv = Stop-ByCommandLine 'uvicorn app\.main:app'
$spawn = Stop-ByCommandLine 'multiprocessing\.spawn import spawn_main'
$vite = Stop-ByCommandLine ('vite.*--port[\s=]+' + $fePort)

$portKilled = 0
foreach ($round in 1..6) {
    $portKilled += Stop-PortListeners $bePort
    $portKilled += Stop-PortListeners $fePort
    Start-Sleep -Milliseconds 350
}

Write-Host ('[FlowX] Stopped uvicorn=' + $uv + ' spawn_workers=' + $spawn + ' vite=' + $vite + ' port listeners=' + $portKilled + '.')
Write-Host '[FlowX] Done.'
