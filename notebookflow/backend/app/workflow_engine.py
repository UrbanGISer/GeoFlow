"""Topological workflow execution."""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.data_store import DataStore, write_html_artifact
from app.executors import execute_node_code
from app.models import WorkflowEdge, WorkflowNode
from app.node_specs import get_spec_by_type


def _node_ids(nodes: list[WorkflowNode]) -> list[str]:
    return [n.id for n in nodes]


def topological_sort(nodes: list[WorkflowNode], edges: list[WorkflowEdge]) -> list[str]:
    ids = _node_ids(nodes)
    id_set = set(ids)
    in_degree: dict[str, int] = {i: 0 for i in ids}
    children: dict[str, list[str]] = {i: [] for i in ids}

    for e in edges:
        if e.source in id_set and e.target in id_set:
            children[e.source].append(e.target)
            in_degree[e.target] += 1

    queue = [n for n in ids if in_degree[n] == 0]
    order: list[str] = []
    while queue:
        n = queue.pop(0)
        order.append(n)
        for m in children[n]:
            in_degree[m] -= 1
            if in_degree[m] == 0:
                queue.append(m)

    if len(order) != len(ids):
        raise ValueError("Workflow graph has a cycle or disconnected nodes prevent sorting.")
    return order


def _upstream_source_id(node_id: str, edges: list[WorkflowEdge]) -> str | None:
    for e in edges:
        if e.target == node_id and (e.targetHandle or "df_in") == "df_in":
            return e.source
    return None


def _ancestors(node_id: str, edges: list[WorkflowEdge]) -> set[str]:
    """All nodes that can reach node_id via incoming edges (transitive upstream)."""
    rev: dict[str, list[str]] = {}
    for e in edges:
        rev.setdefault(e.target, []).append(e.source)

    seen: set[str] = set()
    stack = [node_id]
    while stack:
        cur = stack.pop()
        for p in rev.get(cur, []):
            if p not in seen:
                seen.add(p)
                stack.append(p)
    seen.discard(node_id)
    return seen


def subgraph_nodes_for_target(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    target_id: str,
) -> tuple[list[WorkflowNode], list[WorkflowEdge]]:
    """Nodes and edges required to run target_id (upstream closure + target)."""
    anc = _ancestors(target_id, edges)
    keep_ids = anc | {target_id}
    sub_nodes = [n for n in nodes if n.id in keep_ids]
    sub_edges = [e for e in edges if e.source in keep_ids and e.target in keep_ids]
    return sub_nodes, sub_edges


def _preview_cell_value(val: Any) -> Any:
    """Single cell → JSON-friendly value (GeoDataFrame / Shapely, numpy, Arrow-backed columns, etc.)."""
    if val is None:
        return None
    # Shapely geometry: must not rely on DataFrame.to_json (often fails); serialize as WKT.
    if hasattr(val, "wkt"):
        try:
            w = val.wkt
            return w if isinstance(w, str) else str(val)
        except Exception:
            return str(val)
    try:
        if pd.isna(val) and not isinstance(val, (bytes, bytearray, str)):
            return None
    except (ValueError, TypeError):
        pass
    if isinstance(val, pd.Timestamp):
        return val.isoformat()
    if isinstance(val, datetime):
        return val.isoformat()
    if isinstance(val, date):
        return val.isoformat()
    if isinstance(val, bool):
        return val
    if isinstance(val, np.bool_):
        return bool(val)
    if isinstance(val, (int, np.integer)):
        return int(val)
    if isinstance(val, (float, np.floating)):
        try:
            if pd.isna(val):
                return None
        except Exception:
            pass
        return float(val)
    if isinstance(val, bytes):
        return val.decode("utf-8", errors="replace")
    if isinstance(val, str):
        return val
    if isinstance(val, (dict, list)):
        try:
            json.dumps(val, default=str)
            return val
        except (TypeError, ValueError):
            return str(val)
    try:
        json.dumps(val, default=str)
        return val
    except (TypeError, ValueError):
        return str(val)


def _preview_records(df: pd.DataFrame, limit: int = 20) -> list[dict[str, Any]]:
    """Tabular preview for API/UI. Built row-by-row so GeoDataFrame / PyArrow dtypes always serialize."""
    head = df.head(limit)
    n, m = head.shape
    if n == 0 or m == 0:
        return []
    rows: list[dict[str, Any]] = []
    for i in range(n):
        rec: dict[str, Any] = {}
        for j in range(m):
            col = head.columns[j]
            key = str(col)
            try:
                val = head.iloc[i, j]
            except Exception:
                val = None
            if isinstance(val, pd.Series):
                val = val.iloc[0] if len(val) > 0 else None
            rec[key] = _preview_cell_value(val)
        rows.append(rec)
    return rows


def run_workflow(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    store: DataStore,
    artifacts_dir: Path,
) -> tuple[str, dict[str, Any], list[str], str | None, str | None]:
    """
    Execute full workflow. Returns (status, node_outputs, logs, error_node_id, error_message).
    """
    store.clear()
    node_outputs: dict[str, Any] = {}
    logs: list[str] = []

    try:
        order = topological_sort(nodes, edges)
    except ValueError as e:
        return "error", {}, [], None, str(e)

    node_map = {n.id: n for n in nodes}

    for nid in order:
        node = node_map[nid]
        spec = get_spec_by_type(node.type)
        label = node.label or (spec.label if spec else node.type)

        upstream_id = _upstream_source_id(nid, edges)
        df_in: pd.DataFrame | None = None
        if upstream_id:
            df_in = store.get_df_for_node(upstream_id)

        params = dict(node.params)

        try:
            df_out, html_out = execute_node_code(node.code, df_in, params)
        except Exception as exc:  # noqa: BLE001 - intentional (user-supplied code)
            return (
                "error",
                node_outputs,
                logs,
                nid,
                f"[{label}] {exc.__class__.__name__}: {exc}",
            )

        out_entry: dict[str, Any] = {}

        if df_out is not None:
            if not isinstance(df_out, pd.DataFrame):
                return (
                    "error",
                    node_outputs,
                    logs,
                    nid,
                    f"[{label}] df_out must be a pandas DataFrame, got {type(df_out).__name__}",
                )
            store.put_df(nid, df_out)
            out_entry["df_out"] = {
                "type": "DataFrame",
                "rows": int(len(df_out)),
                "columns": list(df_out.columns.astype(str)),
                "preview": _preview_records(df_out),
            }

        if html_out is not None:
            if not isinstance(html_out, str):
                return (
                    "error",
                    node_outputs,
                    logs,
                    nid,
                    f"[{label}] html_out must be str, got {type(html_out).__name__}",
                )
            write_html_artifact(artifacts_dir, nid, html_out)
            fname = f"{nid}_html.html"
            out_entry["html_out"] = {
                "type": "HTML",
                "artifact_url": f"/api/artifacts/{fname}",
            }

        if out_entry:
            node_outputs[nid] = out_entry

        logs.append(f"[{label}] success")

    return "success", node_outputs, logs, None, None


def run_single_node(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    node_id: str,
    store: DataStore,
    artifacts_dir: Path,
) -> tuple[str, dict[str, Any], list[str], str | None, str | None]:
    """Run upstream subgraph then the selected node (same engine as full workflow on subgraph)."""
    sub_nodes, sub_edges = subgraph_nodes_for_target(nodes, edges, node_id)
    if not any(n.id == node_id for n in sub_nodes):
        return "error", {}, [], node_id, f"Node not found: {node_id}"
    return run_workflow(sub_nodes, sub_edges, store, artifacts_dir)
