"""Export a GeoFlow workflow as an equivalent Jupyter notebook (.ipynb).

Strategy
--------
- Nodes are emitted in topological order, one markdown + one code cell each.
- Top-level ``import``/``from`` lines are hoisted out of every node into a
  single deduplicated imports cell ("消除重复区域").
- The engine's variable convention is bridged explicitly: each cell receives
  ``df_in`` / ``df_in_2`` / … / ``df_ins`` from the upstream cells' outputs
  and publishes its result as ``df_<node>`` for downstream cells — running
  the notebook top-to-bottom reproduces the workflow.
- ``html_out`` views are rendered inline via ``IPython.display.HTML``.
"""

from __future__ import annotations

import re
from pprint import pformat
from typing import Any

from app.models import WorkflowEdge, WorkflowNode
from app.workflow_engine import _upstream_sources, topological_sort

_IMPORT_RE = re.compile(r"^(?:import\s+\S|from\s+\S+\s+import\s+)")


def _split_imports(code: str) -> tuple[list[str], str]:
    """Pull top-level import lines out of a cell body."""
    imports: list[str] = []
    body: list[str] = []
    for line in code.split("\n"):
        stripped = line.strip()
        if _IMPORT_RE.match(stripped) and not line.startswith((" ", "\t")):
            imports.append(stripped)
        else:
            body.append(line)
    return imports, "\n".join(body).strip("\n")


def _md_cell(source: str) -> dict[str, Any]:
    return {"cell_type": "markdown", "metadata": {}, "source": source}


def _code_cell(source: str) -> dict[str, Any]:
    return {
        "cell_type": "code",
        "metadata": {},
        "execution_count": None,
        "outputs": [],
        "source": source,
    }


def _safe_name(label: str, index: int) -> str:
    slug = re.sub(r"[^0-9a-zA-Z]+", "_", label).strip("_").lower()
    return f"{slug}_{index}" if slug else f"node_{index}"


def export_ipynb(nodes: list[WorkflowNode], edges: list[WorkflowEdge]) -> dict[str, Any]:
    """Build an nbformat-4 notebook dict equivalent to the workflow."""
    order = topological_sort(nodes, edges)
    node_map = {n.id: n for n in nodes}
    var_of = {nid: f"df_{_safe_name(node_map[nid].label, i + 1)}" for i, nid in enumerate(order)}

    # Hoist + dedupe imports across all node cells.
    seen_imports: set[str] = set()
    all_imports: list[str] = []
    bodies: dict[str, str] = {}
    for nid in order:
        imps, body = _split_imports(node_map[nid].code)
        for imp in imps:
            if imp not in seen_imports:
                seen_imports.add(imp)
                all_imports.append(imp)
        bodies[nid] = body
    # The engine injects pandas implicitly — the notebook must import it.
    if not any(i.startswith("import pandas") for i in all_imports):
        all_imports.insert(0, "import pandas as pd")

    cells: list[dict[str, Any]] = [
        _md_cell(
            "# GeoFlow workflow export\n\n"
            "Generated from a GeoFlow workflow — cells follow the node execution "
            "order; run top-to-bottom to reproduce the pipeline."
        ),
        _code_cell("\n".join(all_imports)),
    ]

    for i, nid in enumerate(order):
        node = node_map[nid]
        out_var = var_of[nid]

        md = f"## {i + 1}. {node.label}"
        sub = [f"type: `{node.type}`"]
        if node.annotation:
            sub.append(node.annotation)
        cells.append(_md_cell(md + "\n\n" + " — ".join(sub)))

        lines: list[str] = []
        if node.params:
            # Python literal (None/True/False), NOT JSON (null would NameError).
            lines.append(f"params = {pformat(node.params, indent=1, width=72, sort_dicts=False)}")
        else:
            lines.append("params = {}")

        sources = _upstream_sources(nid, edges)
        port_map = {idx: src for idx, src in sources}
        max_port = max(port_map, default=0)
        if max_port == 0:
            lines.append("df_in = None")
            in_vars = ["df_in"]
        else:
            in_vars = []
            for port in range(1, max_port + 1):
                var = "df_in" if port == 1 else f"df_in_{port}"
                src = port_map.get(port)
                if src:
                    lines.append(f"{var} = {var_of[src]}.copy()  # ← {node_map[src].label}")
                else:
                    lines.append(f"{var} = None")
                in_vars.append(var)
        lines.append(f"df_ins = [{', '.join(in_vars)}]")
        lines.append("df_out = None")
        lines.append("html_out = None")
        lines.append("")
        if bodies[nid]:
            lines.append(bodies[nid])
            lines.append("")

        mentions_df_out = "df_out" in bodies[nid]
        mentions_html_out = "html_out" in bodies[nid]
        if mentions_df_out:
            lines.append(f"{out_var} = df_out")
        if mentions_html_out:
            lines.append(
                "if html_out:\n"
                "    from IPython.display import HTML, display\n"
                "    display(HTML(html_out))"
            )
        if mentions_df_out:
            lines.append(f"{out_var}.head() if {out_var} is not None else None")

        cells.append(_code_cell("\n".join(lines)))

    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
