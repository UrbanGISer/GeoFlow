# NotebookFlow: start backend (8000) + frontend (Vite)
# Backend uses conda env "geoflow" by default.
# Override: $env:NOTEBOOKFLOW_CONDA_ENV = "other_env"
# Optional: $env:CONDA_EXE = "C:\path\to\conda.exe"
# Optional: $env:NOTEBOOKFLOW_NPM = "C:\path\to\npm.cmd"  (if npm not on PATH)
# Optional: $env:NOTEBOOKFLOW_SKIP_FRONTEND = "1"  (backend only)
#
# Run from repo: cd notebookflow ; .\start-notebookflow.ps1
#
# NOTE: ASCII-only for Windows PowerShell 5.1 default encoding.

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Req = Join-Path $Backend "requirements.txt"

$CondaEnvName = if ($env:NOTEBOOKFLOW_CONDA_ENV) { $env:NOTEBOOKFLOW_CONDA_ENV.Trim() } else { "geoflow" }
$SkipFrontend =
    ($env:NOTEBOOKFLOW_SKIP_FRONTEND -eq "1") -or
    ($env:NOTEBOOKFLOW_SKIP_FRONTEND -eq "true") -or
    ($env:NOTEBOOKFLOW_SKIP_FRONTEND -eq "yes")

function Write-Info([string]$msg) {
    Write-Host $msg -ForegroundColor Cyan
}

function Find-CondaExe {
    if ($env:CONDA_EXE -and (Test-Path -LiteralPath $env:CONDA_EXE)) {
        return $env:CONDA_EXE
    }
    $cmd = Get-Command conda.exe -ErrorAction SilentlyContinue
    if ($cmd -and (Test-Path -LiteralPath $cmd.Source)) {
        return $cmd.Source
    }
    $userConda = Join-Path $env:USERPROFILE "miniconda3\Scripts\conda.exe"
    if (Test-Path -LiteralPath $userConda) { return $userConda }
    foreach ($base in @(
            (Join-Path $env:USERPROFILE "anaconda3"),
            (Join-Path $env:USERPROFILE "miniconda3"),
            (Join-Path $env:USERPROFILE "miniforge3"),
            (Join-Path $env:USERPROFILE "mambaforge"),
            (Join-Path $env:LOCALAPPDATA "anaconda3"),
            (Join-Path $env:LOCALAPPDATA "miniconda3"),
            "$env:ProgramData\anaconda3",
            "$env:ProgramData\miniconda3"
        )) {
        $exe = Join-Path $base "Scripts\conda.exe"
        if (Test-Path -LiteralPath $exe) { return $exe }
    }
    return $null
}

function Find-NpmCmd {
    if ($env:NOTEBOOKFLOW_NPM -and (Test-Path -LiteralPath $env:NOTEBOOKFLOW_NPM)) {
        return $env:NOTEBOOKFLOW_NPM
    }
    # Literal paths first (default Node installer on 64-bit Windows).
    foreach ($literal in @(
            "C:\Program Files\nodejs\npm.cmd",
            "C:\Program Files\nodejs\npm.exe",
            "C:\Program Files (x86)\nodejs\npm.cmd"
        )) {
        if (Test-Path -LiteralPath $literal) {
            return $literal
        }
    }
    # 64-bit Program Files even when PowerShell is 32-bit (WOW64).
    $w6432 = ${env:ProgramW6432}
    if ($w6432) {
        foreach ($name in @("npm.cmd", "npm.exe")) {
            $p = Join-Path $w6432 "nodejs\$name"
            if (Test-Path -LiteralPath $p) {
                return $p
            }
        }
    }
    $fromCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($fromCmd -and (Test-Path -LiteralPath $fromCmd.Source)) {
        return $fromCmd.Source
    }
    $fromNpm = Get-Command npm -ErrorAction SilentlyContinue
    if ($fromNpm -and (Test-Path -LiteralPath $fromNpm.Source)) {
        return $fromNpm.Source
    }
    try {
        $whereOut = & where.exe npm 2>$null
        if ($whereOut) {
            foreach ($line in $whereOut) {
                $t = $line.Trim()
                if ($t -and (Test-Path -LiteralPath $t)) {
                    return $t
                }
            }
        }
    } catch {}
    $candidates = @(
        (Join-Path $env:ProgramFiles "nodejs\npm.cmd"),
        (Join-Path $env:ProgramFiles "nodejs\npm.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\npm.cmd"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\npm.exe"),
        (Join-Path $env:USERPROFILE ".volta\bin\npm.cmd"),
        (Join-Path $env:USERPROFILE "scoop\apps\nodejs\current\npm.cmd"),
        (Join-Path $env:USERPROFILE "scoop\shims\npm.cmd")
    )
    $pf86 = ${env:ProgramFiles(x86)}
    if ($pf86) {
        $candidates += (Join-Path $pf86 "nodejs\npm.cmd")
    }
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p)) {
            return $p
        }
    }
    return $null
}

if (-not (Test-Path $Backend) -or -not (Test-Path $Frontend)) {
    Write-Error "Missing backend/ or frontend/. Run this script from the notebookflow folder."
    exit 1
}

$condaExe = Find-CondaExe
if (-not $condaExe) {
    Write-Error "conda.exe not found. Use Anaconda Prompt, add Scripts to PATH, or set CONDA_EXE."
    exit 1
}

Write-Info ("Conda: " + $condaExe)
Write-Info ("Env:  " + $CondaEnvName)

Write-Info ("Checking Python in conda env '" + $CondaEnvName + "'...")
& $condaExe run -n $CondaEnvName python --version
if ($LASTEXITCODE -ne 0) {
    Write-Error ("Conda env not runnable: " + $CondaEnvName + ". Try: conda env list")
    exit 1
}

Write-Info ("pip install (backend) into [" + $CondaEnvName + "]...")
& $condaExe run -n $CondaEnvName python -m pip install -r $Req
if ($LASTEXITCODE -ne 0) {
    Write-Error "pip install failed."
    exit 1
}

$npmCmd = $null
if (-not $SkipFrontend) {
    $npmCmd = Find-NpmCmd
    if (-not $npmCmd) {
        Write-Host ""
        Write-Host "npm was not found on PATH or in common install folders." -ForegroundColor Yellow
        Write-Host "Fix options:" -ForegroundColor Yellow
        Write-Host "  1) Install Node.js LTS: https://nodejs.org  (then reopen the terminal)" -ForegroundColor Yellow
        Write-Host "  2) Set full path: `$env:NOTEBOOKFLOW_NPM = 'C:\Program Files\nodejs\npm.cmd'" -ForegroundColor Yellow
        Write-Host "  3) Backend only: `$env:NOTEBOOKFLOW_SKIP_FRONTEND = '1'" -ForegroundColor Yellow
        Write-Host ""
        Write-Error "npm not found."
        exit 1
    }
    Write-Info ("npm: " + $npmCmd)

    if (-not (Test-Path (Join-Path $Frontend "node_modules"))) {
        Write-Info "First run: npm install..."
        Push-Location $Frontend
        try {
            & $npmCmd install
        } finally {
            Pop-Location
        }
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm install failed."
            exit 1
        }
    }
} else {
    Write-Info "Skipping frontend (NOTEBOOKFLOW_SKIP_FRONTEND)."
}

$condaQ = '"' + ($condaExe -replace '"', '""') + '"'
$beCmd = "title NotebookFlow Backend :8000 [" + $CondaEnvName + "] && cd /d `"$Backend`" && echo API http://127.0.0.1:8000 && " + $condaQ + " run -n `"$CondaEnvName`" python -m uvicorn app.main:app --reload --port 8000"
Start-Process cmd.exe -ArgumentList @("/k", $beCmd)

Start-Sleep -Seconds 2

if (-not $SkipFrontend -and $npmCmd) {
    $npmQ = '"' + ($npmCmd -replace '"', '""') + '"'
    $feCmd = "title NotebookFlow Frontend && cd /d `"$Frontend`" && " + $npmQ + " run dev"
    Start-Process cmd.exe -ArgumentList @("/k", $feCmd)
    Write-Info ""
    Write-Info "Started two windows: Backend (conda) and Frontend (Vite)."
    Write-Info ("Backend http://127.0.0.1:8000  |  Frontend: Vite URL (often http://localhost:5173)")
} else {
    Write-Info ""
    Write-Info "Started backend only. Open API docs: http://127.0.0.1:8000/docs"
    Write-Info "To run the UI later: cd frontend ; npm install ; npm run dev"
}

Write-Info ""
