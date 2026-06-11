"""Topological workflow execution with incremental (fingerprint-cached) re-runs."""

from __future__ import annotations

import hashlib
import json
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from app.data_store import DataStore, ResultCache, write_html_artifact
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


def _handle_index(handle: str | None) -> int:
    """Port order: df_in → 1, df_in_2 → 2, df_in_3 → 3, …"""
    h = handle or "df_in"
    if h == "df_in":
        return 1
    if h.startswith("df_in_"):
        try:
            return int(h.rsplit("_", 1)[1])
        except ValueError:
            return 1
    return 1


def _upstream_sources(node_id: str, edges: list[WorkflowEdge]) -> list[tuple[int, str]]:
    """All incoming (port_index, source_id) pairs for a node, sorted by port."""
    ins = [
        (_handle_index(e.targetHandle), e.source)
        for e in edges
        if e.target == node_id
    ]
    ins.sort(key=lambda t: t[0])
    return ins


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


def _friendly_dtype(dtype: Any) -> str:
    """Pandas dtype → user-facing type name shown in table headers."""
    s = str(dtype)
    low = s.lower()
    if "geometry" in low:
        return "geometry"
    if "datetime" in low:
        return "datetime"
    if "timedelta" in low:
        return "duration"
    if "int" in low:
        return "integer"
    if "float" in low:
        return "float"
    if "bool" in low:
        return "boolean"
    if "category" in low:
        return "category"
    if low in ("object", "string", "str"):
        return "string"
    return s


def _column_dtypes(df: pd.DataFrame) -> dict[str, str]:
    out: dict[str, str] = {}
    for col in df.columns:
        try:
            out[str(col)] = _friendly_dtype(df[col].dtype)
        except Exception:
            out[str(col)] = "unknown"
    return out


def _file_stat_tokens(params: dict[str, Any]) -> list[str]:
    """File-typed params contribute mtime+size so editing an input file invalidates the cache."""
    tokens: list[str] = []
    for key, value in sorted(params.items()):
        if not isinstance(value, str) or not value:
            continue
        lowered = key.lower()
        if "path" not in lowered and "file" not in lowered:
            continue
        try:
            st = Path(value).stat()
            tokens.append(f"{key}={st.st_mtime_ns}:{st.st_size}")
        except OSError:
            tokens.append(f"{key}=missing")
    return tokens


def node_fingerprint(node: WorkflowNode, upstream_fingerprint: str | None) -> str:
    """Content hash of everything that determines this node's output."""
    try:
        params_token = json.dumps(node.params, sort_keys=True, default=str)
    except (TypeError, ValueError):
        params_token = str(sorted(node.params.items(), key=lambda kv: kv[0]))
    material = "\x1f".join(
        [
            node.type,
            node.code,
            params_token,
            upstream_fingerprint or "",
            *_file_stat_tokens(node.params),
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def run_workflow(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    store: DataStore,
    artifacts_dir: Path,
    cache: ResultCache | None = None,
    use_cache: bool = True,
) -> tuple[str, dict[str, Any], list[str], str | None, str | None]:
    """
    Execute full workflow. Returns (status, node_outputs, logs, error_node_id, error_message).

    When a cache is provided, nodes whose fingerprint (code + params + input
    files + upstream chain) is unchanged reuse the previous result instead of
    re-executing — KNIME-style incremental runs.
    """
    store.clear()
    node_outputs: dict[str, Any] = {}
    logs: list[str] = []
    fingerprints: dict[str, str] = {}
    run_started = time.perf_counter()
    cached_count = 0
    executed_count = 0

    try:
        order = topological_sort(nodes, edges)
    except ValueError as e:
        return "error", {}, [], None, str(e)

    node_map = {n.id: n for n in nodes}

    for nid in order:
        node = node_map[nid]
        spec = get_spec_by_type(node.type)
        label = node.label or (spec.label if spec else node.type)

        sources = _upstream_sources(nid, edges)

        def _df_for(source_id: str) -> pd.DataFrame | None:
            df = store.get_df_for_node(source_id)
            # Shallow copy (cheap under copy-on-write) shields cached
            # upstream results from in-place mutation by node code.
            return df.copy(deep=False) if df is not None else None

        # Port-indexed inputs: gaps (unconnected middle ports) stay None.
        max_port = max((idx for idx, _ in sources), default=0)
        port_dfs: list[pd.DataFrame | None] = [None] * max(1, max_port)
        for idx, source_id in sources:
            port_dfs[idx - 1] = _df_for(source_id)
        df_in = port_dfs[0]
        extra_inputs = port_dfs[1:]

        params = dict(node.params)
        upstream_fp = "|".join(
            f"{idx}:{fingerprints.get(source_id, '')}" for idx, source_id in sources
        )
        fingerprint = node_fingerprint(node, upstream_fp or None)
        fingerprints[nid] = fingerprint

        from_cache = False
        started = time.perf_counter()
        cached_entry = cache.get(fingerprint) if (cache is not None and use_cache) else None
        if cached_entry is not None:
            df_out, html_out = cached_entry
            from_cache = True
            cached_count += 1
        else:
            try:
                df_out, html_out = execute_node_code(node.code, df_in, params, extra_inputs)
            except Exception as exc:  # noqa: BLE001 - intentional (user-supplied code)
                return (
                    "error",
                    node_outputs,
                    logs,
                    nid,
                    f"[{label}] {exc.__class__.__name__}: {exc}",
                )
            executed_count += 1
        elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)

        out_entry: dict[str, Any] = {"cached": from_cache, "elapsed_ms": elapsed_ms}

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
                "dtypes": _column_dtypes(df_out),
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

        if cache is not None and not from_cache:
            cache.put(fingerprint, df_out if isinstance(df_out, pd.DataFrame) else None, html_out)

        if "df_out" in out_entry or "html_out" in out_entry:
            node_outputs[nid] = out_entry

        if from_cache:
            logs.append(f"[{label}] cached (reused previous result)")
        else:
            logs.append(f"[{label}] success in {elapsed_ms} ms")

    total_ms = round((time.perf_counter() - run_started) * 1000.0, 1)
    logs.append(
        f"Workflow finished in {total_ms} ms ({executed_count} executed, {cached_count} from cache)."
    )
    return "success", node_outputs, logs, None, None


def run_single_node(
    nodes: list[WorkflowNode],
    edges: list[WorkflowEdge],
    node_id: str,
    store: DataStore,
    artifacts_dir: Path,
    cache: ResultCache | None = None,
    use_cache: bool = True,
) -> tuple[str, dict[str, Any], list[str], str | None, str | None]:
    """Run upstream subgraph then the selected node (same engine as full workflow on subgraph)."""
    sub_nodes, sub_edges = subgraph_nodes_for_target(nodes, edges, node_id)
    if not any(n.id == node_id for n in sub_nodes):
        return "error", {}, [], node_id, f"Node not found: {node_id}"
    return run_workflow(sub_nodes, sub_edges, store, artifacts_dir, cache=cache, use_cache=use_cache)
