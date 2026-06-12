# FlowX platform launchers

ComfyUI-style local dev launchers (hidden servers + app window).  
**Closing the FlowX window stops backend and frontend** in default `app` mode.

| Platform | Folder | Double-click |
|----------|--------|--------------|
| Windows | [windows/](windows/) | `Launch FlowX.vbs` |
| macOS | [macos/](macos/) | **`FlowX.app`** (no Terminal) |

Legacy debug launchers (visible Terminal): repo root `start.bat` / `start.sh`.

## First-time setup

1. Copy `config.json.example` → `config.json` in your platform folder.
2. Windows: conda env `geoxai` (or set `python` in config).
3. macOS: `brew install python node` (or set `NOTEBOOKFLOW_PYTHON`).

## Manual stop

- Windows: `scripts\windows\stop.ps1`
- macOS: `scripts/macos/stop.sh`
