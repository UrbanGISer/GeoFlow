# FlowX — macOS launcher

Background backend + frontend, opens FlowX in a **native window** (FlowX icon in Dock) or Chrome app window.

## Quick start

1. Copy `config.json.example` → `config.json` (optional).
2. First time only:
   ```bash
   cd scripts/macos
   chmod +x launch.sh stop.sh "Launch FlowX.command" FlowX.app/Contents/MacOS/flowx
   ```
3. Double-click **`Launch FlowX.command`** or **`FlowX.app`**.

Both open a **Terminal window** briefly, start servers, then open the FlowX UI window.  
Closing the UI window stops servers (default).

### About `FlowX.app`

macOS blocks unsigned `.app` bundles from running scripts directly inside `~/Documents` (`Operation not permitted`).  
So **`FlowX.app` is a launcher**: it opens `Launch FlowX.command` → Terminal runs `launch.sh`.  
It **can** start FlowX, but not silently without Terminal.

The **FlowX icon** in Finder comes from `FlowX.app/Contents/Resources/FlowX.icns`.

### Window icon (Dock)

| `window_mode` in `config.json` | Dock / window icon |
|-------------------------------|---------------------|
| **`native`** (default) | **FlowX** — uses built-in WKWebView (`pywebview`) |
| `app` | Chrome / Edge icon |
| `browser` | Default browser tab |
| `none` | No window (servers only) |

First `native` launch installs `pywebview` into the backend venv.

**Gatekeeper:** If blocked, right-click → **Open** once.

## Alternative: Terminal debug

```bash
./launch.sh --show-frontend-window
./launch.sh --detach
```

## Stop manually

```bash
./stop.sh
```

## Config (`config.json`)

| Field | Default | Meaning |
|-------|---------|---------|
| `python` | `""` | Optional explicit python3 path |
| `window_mode` | `native` | `native` / `app` / `browser` / `none` |
| `auto_stop_on_close` | `true` | Closing window runs `stop.sh` |

## Logs

`~/Library/Logs/FlowX/backend.log`, `frontend.log`, `launcher.log`

## Files

| File | Purpose |
|------|---------|
| `Launch FlowX.command` | **Recommended** double-click launcher |
| `FlowX.app` | Same (opens `.command`); custom Finder icon |
| `native_window.py` | Native macOS window shell |
| `build-icon.sh` | Regenerate `FlowX.icns` from `icons/flowx-dock.svg` |
