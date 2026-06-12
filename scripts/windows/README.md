# FlowX — Windows launcher

Hidden backend + frontend, opens FlowX in an Edge/Chrome **app window** (no tabs).  
**Closing the FlowX window automatically stops** servers (`auto_stop_on_close` in config).

## Quick start

1. Copy `config.json.example` → `config.json` (default conda env: `geoxai`).
2. Double-click **`Launch FlowX.vbs`** (silent) or **`Launch FlowX.bat`** (console).

## Stop manually

```powershell
.\stop.ps1
```

Use this if you launched with **browser tab** mode or `-Detach`.

## Config (`config.json`)

| Field | Default | Meaning |
|-------|---------|---------|
| `conda_env` | `geoxai` | Conda env name when `python` is empty |
| `window_mode` | `app` | `app` = app window; `browser` = system browser tab |
| `auto_stop_on_close` | `true` | When `app` mode: closing window runs `stop.ps1` |

## Flags

| Flag | Effect |
|------|--------|
| `-UseBrowser` | Normal browser tab; no auto-stop |
| `-Detach` | Leave servers running after script exits |
| `-SkipBrowser` | Servers only |
| `-ShowFrontendWindow` | Show Vite log window |

## Debug

```powershell
.\launch.ps1 -ShowFrontendWindow
```

Fallback browser: **`Launch FlowX (browser).bat`**
