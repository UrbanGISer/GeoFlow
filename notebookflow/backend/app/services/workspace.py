"""Workspace file browser — list / create / delete files and folders.

GeoFlow is a local-first single-user tool, so the browser may navigate any
readable directory the user points it at. Destructive operations carry
minimal guards (no filesystem root, no home directory itself).
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

# Default workspace lives next to the backend: notebookflow/backend/workspace/
DEFAULT_WORKSPACE = Path(__file__).resolve().parent.parent.parent / "workspace"


def default_workspace() -> Path:
    DEFAULT_WORKSPACE.mkdir(parents=True, exist_ok=True)
    return DEFAULT_WORKSPACE


def _resolve(path: str | None) -> Path:
    if not path:
        return default_workspace()
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = default_workspace() / p
    return p.resolve()


def list_dir(path: str | None) -> dict[str, Any]:
    """Directory listing: dirs first, then files, both alphabetical."""
    root = _resolve(path)
    if not root.exists():
        raise FileNotFoundError(f"Folder not found: {root}")
    if not root.is_dir():
        raise NotADirectoryError(f"Not a folder: {root}")

    entries: list[dict[str, Any]] = []
    try:
        children = sorted(root.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower()))
    except PermissionError as exc:
        raise PermissionError(f"Permission denied: {root}") from exc

    for child in children:
        if child.name.startswith("."):
            continue
        try:
            st = child.stat()
            entries.append({
                "name": child.name,
                "path": str(child),
                "is_dir": child.is_dir(),
                "size": 0 if child.is_dir() else st.st_size,
                "mtime": st.st_mtime,
            })
        except OSError:
            continue

    return {
        "path": str(root),
        "parent": str(root.parent) if root.parent != root else None,
        "entries": entries,
    }


def make_dir(parent: str | None, name: str) -> dict[str, str]:
    name = Path(name).name  # strip any path components
    if not name:
        raise ValueError("Folder name is required.")
    target = _resolve(parent) / name
    if target.exists():
        raise FileExistsError(f"Already exists: {target}")
    target.mkdir(parents=True)
    return {"path": str(target)}


def create_file(parent: str | None, name: str, content: str = "") -> dict[str, str]:
    name = Path(name).name
    if not name:
        raise ValueError("File name is required.")
    target = _resolve(parent) / name
    if target.exists():
        raise FileExistsError(f"Already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {"path": str(target)}


def save_file(parent: str | None, name: str, content: str, overwrite: bool = True) -> dict[str, str]:
    """Write a text file (workflow JSON, exports, …). Overwrites by default."""
    name = Path(name).name
    if not name:
        raise ValueError("File name is required.")
    target = _resolve(parent) / name
    if target.exists() and target.is_dir():
        raise ValueError(f"Target is a folder: {target}")
    if target.exists() and not overwrite:
        raise FileExistsError(f"Already exists: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return {"path": str(target)}


_MAX_READ_BYTES = 20 * 1024 * 1024


def read_file(path: str) -> dict[str, str]:
    """Read a text file (e.g. a saved workflow JSON) back from the workspace."""
    if not path:
        raise ValueError("Path is required.")
    target = _resolve(path)
    if not target.exists() or not target.is_file():
        raise FileNotFoundError(f"File not found: {target}")
    if target.stat().st_size > _MAX_READ_BYTES:
        raise ValueError(f"File too large to open here (> {_MAX_READ_BYTES // 1024 // 1024} MB).")
    return {"path": str(target), "content": target.read_text(encoding="utf-8", errors="replace")}


# Last-resort picker (Linux without zenity): tkinter in its own process.
_TK_PICKER_SCRIPT = """\
import sys
import tkinter as tk
from tkinter import filedialog
root = tk.Tk()
root.withdraw()
try:
    root.attributes('-topmost', True)
except Exception:
    pass
kwargs = {}
if len(sys.argv) > 1 and sys.argv[1]:
    kwargs['initialdir'] = sys.argv[1]
path = filedialog.askdirectory(title='Choose folder', **kwargs)
root.destroy()
sys.stdout.write(path or '')
"""


def pick_folder_native(initial: str | None = None) -> dict[str, str]:
    """Open the OS folder dialog on the local machine (backend == local).

    Uses the platform's own dialog so no "Python" app appears:
      macOS   → osascript `choose folder` (standard system sheet)
      Windows → PowerShell FolderBrowserDialog (Explorer-style, topmost,
                no console flash)
      Linux   → zenity, then tkinter as last resort
    Returns {"path": ""} when cancelled. Raises RuntimeError when no GUI
    is available — callers fall back to the in-app folder browser.
    """
    import platform
    import shutil
    import subprocess
    import sys
    from pathlib import Path as _P

    system = platform.system()
    init = initial if initial and _P(initial).is_dir() else None

    try:
        if system == "Darwin":
            esc = (init or "").replace("\\", "\\\\").replace('"', '\\"')
            script = 'POSIX path of (choose folder with prompt "Choose folder")'
            if init:
                script = (
                    f'POSIX path of (choose folder with prompt "Choose folder" '
                    f'default location POSIX file "{esc}")'
                )
            proc = subprocess.run(
                ["osascript", "-e", script], capture_output=True, text=True, timeout=300,
            )
            if proc.returncode != 0:
                err = proc.stderr.lower()
                if "cancel" in err:  # "User canceled." → not an error
                    return {"path": ""}
                raise RuntimeError(proc.stderr.strip()[:300])
            return {"path": proc.stdout.strip().rstrip("/")}

        if system == "Windows":
            init_ps = (init or "").replace("'", "''")
            ps = (
                "Add-Type -AssemblyName System.Windows.Forms; "
                "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
                "$d.Description = 'Choose folder'; "
                + (f"$d.SelectedPath = '{init_ps}'; " if init else "")
                + "$o = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}; "
                "if ($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) "
                "{ Write-Output $d.SelectedPath }"
            )
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            proc = subprocess.run(
                ["powershell", "-NoProfile", "-STA", "-Command", ps],
                capture_output=True, text=True, timeout=300, creationflags=flags,
            )
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.strip()[:300])
            return {"path": proc.stdout.strip()}

        # Linux / other
        if shutil.which("zenity"):
            cmd = ["zenity", "--file-selection", "--directory", "--title=Choose folder"]
            if init:
                cmd.append(f"--filename={init.rstrip('/')}/")
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if proc.returncode == 1:  # cancelled
                return {"path": ""}
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.strip()[:300])
            return {"path": proc.stdout.strip()}

        proc = subprocess.run(
            [sys.executable, "-c", _TK_PICKER_SCRIPT, init or ""],
            capture_output=True, text=True, timeout=300,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip()[:300])
        return {"path": proc.stdout.strip()}
    except RuntimeError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Native folder dialog unavailable: {exc}") from exc


def rename_path(path: str, new_name: str) -> dict[str, str]:
    """Rename a file or folder within its current directory."""
    if not path:
        raise ValueError("Path is required.")
    if not new_name or not new_name.strip():
        raise ValueError("New name is required.")
    new_name = Path(new_name).name  # strip any path separators
    target = _resolve(path)
    if not target.exists():
        raise FileNotFoundError(f"Not found: {target}")
    dest = target.parent / new_name
    if dest.exists():
        raise FileExistsError(f"Already exists: {dest}")
    target.rename(dest)
    return {"path": str(dest)}


def copy_path(path: str) -> dict[str, str]:
    """Copy a file or folder, appending '_copy' to the name."""
    if not path:
        raise ValueError("Path is required.")
    target = _resolve(path)
    if not target.exists():
        raise FileNotFoundError(f"Not found: {target}")
    stem = target.stem if target.is_file() else target.name
    suffix = target.suffix if target.is_file() else ""
    dest = target.parent / f"{stem}_copy{suffix}"
    # Ensure unique name
    counter = 2
    while dest.exists():
        dest = target.parent / f"{stem}_copy{counter}{suffix}"
        counter += 1
    if target.is_dir():
        shutil.copytree(target, dest)
    else:
        shutil.copy2(target, dest)
    return {"path": str(dest)}


def reveal_path(path: str) -> dict[str, str]:
    """Open a file or folder in the system file manager (Finder/Explorer)."""
    import subprocess, sys
    target = Path(path).resolve()
    if not target.exists():
        raise FileNotFoundError(f"Not found: {target}")
    try:
        if sys.platform == "darwin":
            if target.is_file():
                subprocess.Popen(["open", "-R", str(target)])
            else:
                subprocess.Popen(["open", str(target)])
        elif sys.platform == "win32":
            if target.is_file():
                subprocess.Popen(["explorer", f"/select,{target}"])
            else:
                subprocess.Popen(["explorer", str(target)])
        else:
            # Linux: open parent directory
            folder = target.parent if target.is_file() else target
            subprocess.Popen(["xdg-open", str(folder)])
    except Exception as exc:
        raise RuntimeError(f"Could not open file manager: {exc}") from exc
    return {"path": str(target)}


def delete_path(path: str) -> dict[str, str]:
    if not path:
        raise ValueError("Path is required.")
    target = _resolve(path)
    home = Path.home().resolve()
    if target == target.anchor or target == Path(target.anchor) or target == home:
        raise PermissionError("Refusing to delete filesystem root or home directory.")
    if not target.exists():
        raise FileNotFoundError(f"Not found: {target}")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"deleted": str(target)}
