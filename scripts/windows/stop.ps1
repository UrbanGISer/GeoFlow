# Stop FlowX dev servers on configured ports (8000 / 5173 by default).
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

foreach ($port in @($bePort, $fePort)) {
    $killed = 0
    foreach ($round in 1..2) {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            if ($c.OwningProcess -gt 0) {
                Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
                $killed++
            }
        }
        if ($round -eq 1) { Start-Sleep -Milliseconds 400 }
    }
    Write-Host ('[FlowX] Port ' + $port + ' - stopped ' + $killed + ' process(es).')
}

Write-Host '[FlowX] Done.'
