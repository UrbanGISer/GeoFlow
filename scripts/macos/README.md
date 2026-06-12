# FlowX — macOS launcher

Background backend + frontend, opens FlowX in a **Chrome/Edge app window**.  
**Closing the FlowX window automatically stops** servers (`auto_stop_on_close` in config).

## Quick start (recommended — no Terminal)

1. Copy `config.json.example` → `config.json` (optional).
2. First time only:
   ```bash
   cd scripts/macos
   chmod +x launch.sh stop.sh FlowX.app/Contents/MacOS/flowx "Launch FlowX.command"
   ```
3. In Finder, double-click **`FlowX.app`**.

No Terminal window. When you close the FlowX Chrome window, servers stop and the launcher exits.

**Gatekeeper:** If macOS blocks the app, right-click **FlowX.app** → **Open** once.

## Alternative: Terminal debug

```bash
./launch.sh --show-frontend-window   # Vite logs in this Terminal
./launch.sh --detach                 # return to prompt; stop with ./stop.sh
```

Legacy repo root `./start.sh` still works (Ctrl+C to stop).

## Stop manually

```bash
./stop.sh
```

## Config (`config.json`)

| Field | Default | Meaning |
|-------|---------|---------|
| `python` | `""` | Optional explicit python3 path |
| `window_mode` | `app` | `app` = app window; `browser` = default tab |
| `auto_stop_on_close` | `true` | Closing app window runs `stop.sh` |

Override: `NOTEBOOKFLOW_PYTHON`, `NOTEBOOKFLOW_NPM`.

## Logs

`~/Library/Logs/FlowX/backend.log`, `frontend.log`

## Files

| File | Purpose |
|------|---------|
| `FlowX.app` | **Double-click** — no Terminal (like Windows `.vbs`) |
| `Launch FlowX.command` | Opens `FlowX.app` (may flash Terminal briefly) |
| `launch.sh` / `stop.sh` | Core logic |
