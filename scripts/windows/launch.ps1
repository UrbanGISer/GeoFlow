# FlowX Windows launcher — hidden backend/frontend + app window (Edge/Chrome --app).
# Closing the FlowX app window stops servers automatically (unless -Detach).
# Usage: .\launch.ps1
#   -ShowFrontendWindow   show Vite in a minimized window
#   -SkipBrowser          start servers only, no UI
#   -UseBrowser           full browser tab (no auto-stop on tab close)
#   -Detach               leave servers running after launch script exits
param(
    [switch]$ShowFrontendWindow,
    [switch]$SkipBrowser,
    [switch]$UseBrowser,
    [switch]$Detach
)

$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $Here "..\..")).Path
$Backend = Join-Path $RepoRoot "notebookflow\backend"
$Frontend = Join-Path $RepoRoot "notebookflow\frontend"
$ConfigPath = Join-Path $Here "config.json"
$FlowXProfileDir = Join-Path $env:LOCALAPPDATA "FlowX\app-shell"

function Write-Info([string]$msg) {
    Write-Host ('[FlowX] ' + $msg) -ForegroundColor Cyan
}

function Read-Config {
    $cfg = @{
        conda_env           = "geoxai"
        python              = ""
        backend_port        = 8000
        frontend_port       = 5173
        open_browser        = $true
        window_mode         = "app"
        auto_stop_on_close  = $true
    }
    if (Test-Path $ConfigPath) {
        $raw = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($raw.conda_env) { $cfg.conda_env = [string]$raw.conda_env }
        if ($raw.python) { $cfg.python = [string]$raw.python }
        if ($null -ne $raw.backend_port) { $cfg.backend_port = [int]$raw.backend_port }
        if ($null -ne $raw.frontend_port) { $cfg.frontend_port = [int]$raw.frontend_port }
        if ($null -ne $raw.open_browser) { $cfg.open_browser = [bool]$raw.open_browser }
        if ($raw.window_mode) { $cfg.window_mode = [string]$raw.window_mode }
        if ($null -ne $raw.auto_stop_on_close) { $cfg.auto_stop_on_close = [bool]$raw.auto_stop_on_close }
    }
    return $cfg
}

function Find-AppHost {
    foreach ($p in @(
            "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
            ${env:ProgramFiles(x86)} + "\Microsoft\Edge\Application\msedge.exe",
            "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            ${env:ProgramFiles(x86)} + "\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )) {
        if (-not $p) { continue }
        if ((Test-Path -LiteralPath $p) -and -not (Test-Path -LiteralPath $p -PathType Container)) {
            return (Resolve-Path -LiteralPath $p).Path
        }
    }
    return $null
}

function Open-FlowXAppWindow([string]$Url) {
    $appExe = Find-AppHost
    if (-not $appExe) {
        Write-Info 'Edge/Chrome not found - falling back to default browser (no auto-stop).'
        Start-Process $Url
        return $false
    }
    $leaf = Split-Path $appExe -Leaf
    New-Item -ItemType Directory -Force -Path $FlowXProfileDir | Out-Null
    $args = '--new-window --app=' + $Url +
        ' --user-data-dir="' + $FlowXProfileDir + '" --no-first-run --no-default-browser-check --disable-extensions'
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $appExe
    $psi.Arguments = $args
    $psi.UseShellExecute = $true
    [void][System.Diagnostics.Process]::Start($psi)
    Write-Info ('Opened app window via ' + $leaf + ' at ' + $Url)
    return $true
}

function Test-FlowXAppRunning([string]$AppUrl) {
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(msedge|chrome)\.exe$' }
    foreach ($p in $procs) {
        $cmd = $p.CommandLine
        if (-not $cmd) { continue }
        if ($cmd -like ('*' + $FlowXProfileDir + '*') -and $cmd -like ('*--app=' + $AppUrl + '*')) {
            return $true
        }
    }
    return $false
}

function Wait-FlowXAppClosed([string]$AppUrl) {
    Write-Info 'Close the FlowX window to stop backend and frontend.'
    Start-Sleep -Seconds 2
    $gonePolls = 0
    while ($true) {
        if (Test-FlowXAppRunning $AppUrl) {
            $gonePolls = 0
        } else {
            $gonePolls++
            if ($gonePolls -ge 3) { break }
        }
        Start-Sleep -Seconds 2
    }
}

function Find-Python([hashtable]$cfg) {
    if ($cfg.python -and (Test-Path -LiteralPath $cfg.python)) {
        return $cfg.python
    }
    $candidate = Join-Path $env:USERPROFILE ".conda\envs\$($cfg.conda_env)\python.exe"
    if (Test-Path -LiteralPath $candidate) {
        return $candidate
    }
    throw "Python not found. Set config.json python path or create conda env '$($cfg.conda_env)'."
}

function Find-Npm {
    foreach ($p in @(
            "C:\Program Files\nodejs\npm.cmd",
            (Join-Path $env:ProgramFiles "nodejs\npm.cmd")
        )) {
        if ($p -and (Test-Path -LiteralPath $p)) { return $p }
    }
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "npm.cmd not found. Install Node.js LTS from https://nodejs.org"
}

function Stop-Port([int]$Port) {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        if ($c.OwningProcess -gt 0) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

function Wait-Url([string]$Url, [int]$Seconds = 45) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    return $false
}

$aiBat = Join-Path $RepoRoot "ai.env.bat"
if (Test-Path $aiBat) {
    Write-Info "Loading ai.env.bat"
    cmd /c "call `"$aiBat`" && set" | ForEach-Object {
        if ($_ -match "^(AI_[^=]+)=(.*)$") {
            Set-Item -Path "env:$($Matches[1])" -Value $Matches[2]
        }
    }
}

$cfg = Read-Config
$py = Find-Python $cfg
$npm = Find-Npm
$bePort = $cfg.backend_port
$fePort = $cfg.frontend_port
$uiUrl = "http://127.0.0.1:$fePort"

Write-Info "Repo:     $RepoRoot"
Write-Info "Python:   $py"
Write-Info "Backend:  http://127.0.0.1:$bePort"
Write-Info "Frontend: $uiUrl"

& $py -c "import sys; assert sys.version_info>=(3,10); import pandas" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Python env cannot import pandas. Try another conda env in config.json."
}

Write-Info "Stopping listeners on ports $bePort and $fePort (if any)..."
Stop-Port $bePort
Stop-Port $fePort
Start-Sleep -Seconds 1

Write-Info "Installing backend dependencies..."
Push-Location $Backend
try {
    & $py -m pip install -r requirements.txt -q
    if ($LASTEXITCODE -ne 0) { throw "pip install failed." }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
    Write-Info "First run: npm install..."
    Push-Location $Frontend
    try {
        & $npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    } finally {
        Pop-Location
    }
}

$beArgs = "-m uvicorn app.main:app --reload --host 127.0.0.1 --port $bePort"
Write-Info "Starting backend (hidden)..."
Start-Process -FilePath $py -ArgumentList $beArgs.Split(" ") `
    -WorkingDirectory $Backend -WindowStyle Hidden

$feStyle = if ($ShowFrontendWindow) { "Minimized" } else { "Hidden" }
Write-Info "Starting frontend ($feStyle)..."
$feCmd = "npm run dev -- --port $fePort --host 127.0.0.1 --strictPort"
Start-Process -FilePath "cmd.exe" `
    -ArgumentList @("/c", $feCmd) `
    -WorkingDirectory $Frontend -WindowStyle $feStyle

Write-Info "Waiting for servers..."
if (-not (Wait-Url "http://127.0.0.1:$bePort/api/health")) {
    throw "Backend did not start on port $bePort. Run .\stop.ps1 and check conda / pip deps."
}
if (-not (Wait-Url "http://127.0.0.1:$fePort/api/health" 60)) {
    throw "Frontend proxy not ready on port $fePort. Try .\launch.ps1 -ShowFrontendWindow"
}
if (-not (Wait-Url $uiUrl)) {
    throw "Frontend did not start on port $fePort. Check Node.js."
}

try {
    $nodes = (Invoke-WebRequest -Uri "http://127.0.0.1:$bePort/api/nodes" -UseBasicParsing).Content | ConvertFrom-Json
    Write-Info ('Ready - ' + $nodes.Count + ' nodes in library.')
} catch {
    Write-Info 'Ready - backend health OK.'
}

$watchApp = $false
if ($cfg.open_browser -and -not $SkipBrowser) {
    Start-Sleep -Seconds 1
    if ($UseBrowser -or $cfg.window_mode -eq "browser") {
        Start-Process $uiUrl
        Write-Info ('Opened in default browser: ' + $uiUrl)
        Write-Info 'Browser tab mode: servers keep running. Use .\stop.ps1 or -Detach.'
    } elseif ($cfg.window_mode -ne "none") {
        $opened = Open-FlowXAppWindow $uiUrl
        $watchApp = $opened -and $cfg.auto_stop_on_close -and -not $Detach
    }
}

if ($watchApp) {
    try {
        Wait-FlowXAppClosed $uiUrl
    } finally {
        Write-Info 'FlowX window closed — stopping servers...'
        & (Join-Path $Here "stop.ps1")
    }
} elseif (-not $Detach -and -not $SkipBrowser) {
    Write-Info ""
    Write-Info "Servers running in background. Stop manually: .\stop.ps1"
    Write-Info "Or re-launch without -UseBrowser for auto-stop when the app window closes."
} elseif ($Detach -or $SkipBrowser) {
    Write-Info ""
    Write-Info "Servers running in background (-Detach / -SkipBrowser). Stop: .\stop.ps1"
}
