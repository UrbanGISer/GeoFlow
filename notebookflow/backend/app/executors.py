"""Execute user-provided Python node code in a controlled namespace."""

from __future__ import annotations

import hashlib
from types import CodeType
from typing import Any

import pandas as pd

# Copy-on-write makes shallow DataFrame copies cheap and prevents node code
# from mutating cached upstream results in place (pandas 3.x default behavior).
try:
    pd.set_option("mode.copy_on_write", True)
except Exception:  # noqa: BLE001 - older pandas without the option
    pass

# Node code is recompiled only when its source changes.
_CODE_CACHE: dict[str, CodeType] = {}
_CODE_CACHE_MAX = 256


def _compiled(code: str) -> CodeType:
    key = hashlib.sha1(code.encode("utf-8")).hexdigest()
    cached = _CODE_CACHE.get(key)
    if cached is not None:
        return cached
    compiled = compile(code, "<node>", "exec")
    if len(_CODE_CACHE) >= _CODE_CACHE_MAX:
        _CODE_CACHE.clear()
    _CODE_CACHE[key] = compiled
    return compiled


def execute_node_code(
    code: str,
    df_in: pd.DataFrame | None,
    params: dict[str, Any],
    extra_inputs: list[pd.DataFrame | None] | None = None,
    img_inputs: dict[str, str | None] | None = None,
) -> tuple[Any, Any, Any]:
    """
    Run node code with df_in, params. Returns (df_out, html_out, img_out).
    Any may be None if not set by the cell.

    Multi-input nodes additionally receive:
      df_in_2, df_in_3, ... — one variable per extra df input port
      df_ins — ordered list of ALL df inputs (df_in first), Nones included

    Image-input nodes additionally receive:
      img_in_path       — path to PNG for the first img_in port
      img_in_2_path, img_in_3_path, ... — additional img_in ports
      img_ins_paths     — ordered list of all img input paths
    """
    extras = extra_inputs or []
    imgs = img_inputs or {}

    # Collect img_in paths in port order: img_in → 1, img_in_2 → 2, ...
    def _img_index(handle: str) -> int:
        if handle == "img_in":
            return 1
        try:
            return int(handle.rsplit("_", 1)[1])
        except (ValueError, IndexError):
            return 1

    sorted_img = sorted(imgs.items(), key=lambda kv: _img_index(kv[0]))
    img_paths_list: list[str | None] = [v for _, v in sorted_img]

    local_ns: dict[str, Any] = {
        "pd": pd,
        "df_in": df_in,
        "params": params,
        "df_out": None,
        "html_out": None,
        "img_out": None,
        "df_ins": [df_in, *extras],
        "img_in_path": img_paths_list[0] if img_paths_list else None,
        "img_ins_paths": img_paths_list,
    }
    # df_in_2 always defined so node code can branch without NameError
    local_ns["df_in_2"] = extras[0] if len(extras) >= 1 else None
    for i, df in enumerate(extras[1:], start=3):
        local_ns[f"df_in_{i}"] = df
    # img_in_2_path, img_in_3_path, ...
    for idx, path in enumerate(img_paths_list[1:], start=2):
        local_ns[f"img_in_{idx}_path"] = path

    glob_ns: dict[str, Any] = {
        "__builtins__": __builtins__,
        "pd": pd,
    }
    exec(_compiled(code), glob_ns, local_ns)
    return local_ns.get("df_out"), local_ns.get("html_out"), local_ns.get("img_out")
