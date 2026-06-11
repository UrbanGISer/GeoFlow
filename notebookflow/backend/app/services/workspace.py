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
