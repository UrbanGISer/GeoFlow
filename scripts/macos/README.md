# FlowX — macOS launcher

Background backend + frontend, opens FlowX in a **Chrome/Edge app window**.  
**Closing the FlowX window automatically stops** servers (`auto_stop_on_close` in config).

## Quick start

1. Copy `config.json.example` → `config.json`.
2. Make scripts executable (first time only):
   ```bash
   chmod +x launch.sh stop.sh "Launch FlowX.command"
   ```
3. Double-click **`Launch FlowX.command`** or run `./launch.sh`.

Requires Homebrew **Python 3.10+** and **Node.js** (same as repo `start.sh`).

## Stop manually

```bash
./stop.sh
```

## Config (`config.json`)

| Field | Default | Meaning |
|-------|---------|---------|
| `python` | `""` | Optional explicit python3 path |
| `window_mode` | `app` | `app` = app window; `browser` = Safari/default tab |
| `auto_stop_on_close` | `true` | Closing app window runs `stop.sh` |

Override Python/npm via env: `NOTEBOOKFLOW_PYTHON`, `NOTEBOOKFLOW_NPM`.

## Flags

```bash
./launch.sh --show-frontend-window   # Vite logs in Terminal
./launch.sh --use-browser --detach   # normal tab, no auto-stop
./launch.sh --skip-browser           # servers only
```

Logs: `~/Library/Logs/FlowX/backend.log`, `frontend.log`

## Debug

`start.sh` at repo root still works (foreground Terminal + Ctrl+C).
