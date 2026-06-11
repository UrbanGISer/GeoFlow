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
) -> tuple[Any, Any]:
    """
    Run node code with df_in, params. Returns (df_out, html_out).
    Either may be None if not set by the cell.

    Multi-input nodes additionally receive:
      df_in_2, df_in_3, ... — one variable per extra input port
      df_ins — ordered list of ALL inputs (df_in first), Nones included
    """
    extras = extra_inputs or []
    local_ns: dict[str, Any] = {
        "pd": pd,
        "df_in": df_in,
        "params": params,
        "df_out": None,
        "html_out": None,
        "df_ins": [df_in, *extras],
    }
    # df_in_2 is always defined (None when port unconnected) so node code can
    # branch on it without NameError; higher ports defined only when present.
    local_ns["df_in_2"] = extras[0] if len(extras) >= 1 else None
    for i, df in enumerate(extras[1:], start=3):
        local_ns[f"df_in_{i}"] = df
    glob_ns: dict[str, Any] = {
        "__builtins__": __builtins__,
        "pd": pd,
    }
    exec(_compiled(code), glob_ns, local_ns)
    return local_ns.get("df_out"), local_ns.get("html_out")
