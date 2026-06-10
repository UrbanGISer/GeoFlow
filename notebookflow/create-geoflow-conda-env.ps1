# Create conda env "geoflow": Python 3.11+, pandas, numpy, geopandas, matplotlib (conda-forge)
# Usage: cd notebookflow ; .\create-geoflow-conda-env.ps1
# Optional: $env:GEOFLOW_CONDA_ENV ; $env:GEOFLOW_PYTHON ; $env:CONDA_EXE
#
# NOTE: ASCII-only for Windows PowerShell 5.1 default encoding.

$ErrorActionPreference = "Stop"

$EnvName = if ($env:GEOFLOW_CONDA_ENV) { $env:GEOFLOW_CONDA_ENV.Trim() } else { "geoflow" }
$PyVer = if ($env:GEOFLOW_PYTHON) { $env:GEOFLOW_PYTHON.Trim() } else { "3.11" }

function Find-CondaExe {
    if ($env:CONDA_EXE -and (Test-Path -LiteralPath $env:CONDA_EXE)) {
        return $env:CONDA_EXE
    }
    $cmd = Get-Command conda.exe -ErrorAction SilentlyContinue
    if ($cmd -and (Test-Path -LiteralPath $cmd.Source)) {
        return $cmd.Source
    }
    foreach ($base in @(
            "$env:USERPROFILE\anaconda3",
            "$env:USERPROFILE\miniconda3",
            "$env:USERPROFILE\miniforge3",
            "$env:USERPROFILE\mambaforge"
        )) {
        $exe = Join-Path $base "Scripts\conda.exe"
        if (Test-Path -LiteralPath $exe) { return $exe }
    }
    return $null
}

$conda = Find-CondaExe
if (-not $conda) {
    Write-Error "conda.exe not found. Use Anaconda Prompt or set CONDA_EXE."
    exit 1
}

Write-Host ("Conda: " + $conda) -ForegroundColor Cyan
Write-Host ("Creating env " + $EnvName + " Python " + $PyVer + " (channel conda-forge)") -ForegroundColor Cyan

& $conda create -n $EnvName python=$PyVer pandas numpy geopandas matplotlib -c conda-forge -y

if ($LASTEXITCODE -ne 0) {
    Write-Error "conda create failed."
    exit 1
}

Write-Host ""
Write-Host "Done. Activate and verify:" -ForegroundColor Green
Write-Host ("  conda activate " + $EnvName)
Write-Host "  python --version"
Write-Host "  python -c `"import pandas, numpy, geopandas, matplotlib; print('ok')`""
Write-Host ""
Write-Host "For NotebookFlow start script, default env name is already geoflow. Override with:" -ForegroundColor Yellow
Write-Host ("  `$env:NOTEBOOKFLOW_CONDA_ENV = '" + $EnvName + "'")
