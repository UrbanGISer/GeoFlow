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
) -> tuple[Any, Any]:
    """
    Run node code with df_in, params. Returns (df_out, html_out).
    Either may be None if not set by the cell.
    """
    local_ns: dict[str, Any] = {
        "pd": pd,
        "df_in": df_in,
        "params": params,
        "df_out": None,
        "html_out": None,
    }
    glob_ns: dict[str, Any] = {
        "__builtins__": __builtins__,
        "pd": pd,
    }
    exec(_compiled(code), glob_ns, local_ns)
    return local_ns.get("df_out"), local_ns.get("html_out")
