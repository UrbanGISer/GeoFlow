"""Execute user-provided Python node code in a controlled namespace."""

from __future__ import annotations

from typing import Any

import pandas as pd


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
    exec(code, glob_ns, local_ns)
    return local_ns.get("df_out"), local_ns.get("html_out")
