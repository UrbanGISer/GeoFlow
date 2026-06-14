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

from app.data_store import DataStore, ResultCache, artifact_img_path, write_html_artifact, write_img_artifact
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


def _is_img_handle(handle: str | None) -> bool:
    """True for img_in, img_in_2, img_in_3, … (image-port edges)."""
    h = handle or ""
    return h == "img_in" or h.startswith("img_in_")


def _img_handle_index(handle: str | None) -> int:
    h = handle or "img_in"
    if h == "img_in":
        return 1
    try:
        return int(h.rsplit("_", 1)[1])
    except (ValueError, IndexError):
        return 1


def _upstream_sources(node_id: str, edges: list[WorkflowEdge]) -> list[tuple[int, str, str]]:
    """All incoming (port_index, source_id, source_handle) tuples for df input ports, sorted by port."""
    ins = [
        (_handle_index(e.targetHandle), e.source, e.sourceHandle or "df_out")
        for e in edges
        if e.target == node_id and not _is_img_handle(e.targetHandle)
    ]
    ins.sort(key=lambda t: t[0])
    return ins


def _img_upstream_sources(node_id: str, edges: list[WorkflowEdge]) -> list[tuple[str, str]]:
    """All incoming (handle_id, source_id) pairs for img_in ports."""
    return [
        (e.targetHandle or "img_in", e.source)
        for e in edges
        if e.target == node_id and _is_img_handle(e.targetHandle)
    ]


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
    port_overrides: dict[str, "pd.DataFrame | None"] | None = None,
    bar_data: "dict[str, dict[str, pd.DataFrame]] | None" = None,
    no_clear: bool = False,
) -> tuple[str, dict[str, Any], list[str], str | None, str | None]:
    """
    Execute full workflow. Returns (status, node_outputs, logs, error_node_id, error_message).

    When a cache is provided, nodes whose fingerprint (code + params + input
    files + upstream chain) is unchanged reuse the previous result instead of
    re-executing — KNIME-style incremental runs.

    When no_clear=True the store is NOT wiped first — callers that have already
    seeded bar/upstream data can reuse it (e.g. run-single-node inside a group).
    """
    if not no_clear:
        store.clear()
    # Re-populate bar node data AFTER clear (bar_data keyed by node_id → {handle: df})
    if bar_data:
        for node_id, handles in bar_data.items():
            for handle, df in handles.items():
                store.put_df(node_id, df, handle)
    # Pre-populate port_in boundary nodes (used when executing a group subflow)
    if port_overrides:
        for node_id, df in port_overrides.items():
            if df is not None:
                store.put_df(node_id, df)
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

        # port_in boundary nodes are pre-populated via port_overrides; skip execution.
        if port_overrides and nid in port_overrides:
            df_v = store.get_df_for_node(nid)
            out_entry: dict[str, Any] = {"cached": False, "elapsed_ms": 0}
            if df_v is not None:
                out_entry["df_out"] = {
                    "type": "DataFrame",
                    "rows": int(len(df_v)),
                    "columns": list(df_v.columns.astype(str)),
                    "dtypes": _column_dtypes(df_v),
                    "preview": _preview_records(df_v),
                }
            fingerprints[nid] = node_fingerprint(node, None)
            node_outputs[nid] = out_entry
            logs.append(f"[{label}] port injected (boundary node)")
            continue

        sources = _upstream_sources(nid, edges)

        def _df_for(source_id: str, source_handle: str = "df_out") -> pd.DataFrame | None:
            df = store.get_df_for_source(source_id, source_handle)
            # Shallow copy (cheap under copy-on-write) shields cached
            # upstream results from in-place mutation by node code.
            return df.copy(deep=False) if df is not None else None

        # Port-indexed inputs: gaps (unconnected middle ports) stay None.
        max_port = max((idx for idx, _, _h in sources), default=0)
        port_dfs: list[pd.DataFrame | None] = [None] * max(1, max_port)
        for idx, source_id, source_handle in sources:
            port_dfs[idx - 1] = _df_for(source_id, source_handle)
        df_in = port_dfs[0]
        extra_inputs = port_dfs[1:]

        params = dict(node.params)
        upstream_fp = "|".join(
            f"{idx}:{fingerprints.get(source_id, '')}" for idx, source_id, _h in sources
        )
        fingerprint = node_fingerprint(node, upstream_fp or None)
        fingerprints[nid] = fingerprint

        # Collect img_in inputs for this node
        img_srcs = _img_upstream_sources(nid, edges)
        img_inputs: dict[str, str | None] = {}
        for img_handle, img_source_id in img_srcs:
            artifact = artifact_img_path(artifacts_dir, img_source_id)
            img_inputs[img_handle] = str(artifact) if artifact.exists() else None

        from_cache = False
        started = time.perf_counter()

        # ── Group / Component: execute subflow ───────────────────────────────
        if node.type in ("group", "component") and node.subflow:
            sub_raw_nodes = node.subflow.get("nodes", [])
            sub_raw_edges = node.subflow.get("edges", [])
            input_map = node.subflow.get("input_map", [])   # [{groupHandle, nodeId, nodeHandle}]
            output_map = node.subflow.get("output_map", []) # [{groupHandle, nodeId, nodeHandle}]
            sub_nodes = [WorkflowNode(**n) for n in sub_raw_nodes]
            sub_edges = [WorkflowEdge(**e) for e in sub_raw_edges]

            # Build bar_data: per-handle DataFrames for bar nodes (populated AFTER store.clear)
            sub_store = DataStore()
            bar_node_ids: set[str] = set()
            sub_bar_data: dict[str, dict[str, pd.DataFrame]] = {}
            for mapping in input_map:
                g_handle = mapping.get("groupHandle", "df_in")
                bar_id = mapping.get("nodeId", "")
                bar_handle = mapping.get("nodeHandle", "df_out")
                handle_idx = 0
                if g_handle == "df_in":
                    handle_idx = 0
                elif g_handle.startswith("df_in_"):
                    try:
                        handle_idx = int(g_handle.split("_")[-1]) - 1
                    except ValueError:
                        handle_idx = 0
                df_val = port_dfs[handle_idx] if handle_idx < len(port_dfs) else None
                if df_val is not None:
                    sub_bar_data.setdefault(bar_id, {})[bar_handle] = df_val
                    bar_node_ids.add(bar_id)

            # Also mark output bar nodes so the engine skips their execution
            for mapping in output_map:
                bar_node_ids.add(mapping.get("nodeId", ""))

            # port_overrides: maps bar node IDs to skip execution (values unused)
            sub_overrides: dict[str, pd.DataFrame | None] = {bid: None for bid in bar_node_ids}

            sub_status, sub_outputs, sub_logs, sub_err_id, sub_err_msg = run_workflow(
                sub_nodes, sub_edges, sub_store, artifacts_dir,
                cache=cache, use_cache=use_cache, port_overrides=sub_overrides,
                bar_data=sub_bar_data,
            )
            logs.extend(f"  {l}" for l in sub_logs[:-1])  # indent subflow logs, skip summary

            if sub_status == "error":
                return "error", node_outputs, logs, nid, f"[{label}] {sub_err_msg}"

            # Collect outputs: follow sub_edges backwards from each output_map entry.
            # Each entry maps a group output handle (df_out, df_out_2, …) to the gob
            # target handle that receives the subflow result.
            elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)
            out_entry: dict[str, Any] = {"cached": False, "elapsed_ms": elapsed_ms}
            primary_df: pd.DataFrame | None = None
            for om in output_map:
                g_handle = om.get("groupHandle", "df_out")   # outer handle: df_out, df_out_2, …
                gob_id   = om.get("nodeId", "")
                gob_handle = om.get("nodeHandle", "df_in")   # which gob input port
                # Find the subflow edge feeding this gob input handle
                df_val: pd.DataFrame | None = None
                for se in sub_edges:
                    if se.target == gob_id and (se.targetHandle or "df_in") == gob_handle:
                        df_val = sub_store.get_df_for_source(se.source, se.sourceHandle or "df_out")
                        break
                if df_val is None:
                    df_val = sub_store.get_df_for_node(gob_id)
                if df_val is not None and isinstance(df_val, pd.DataFrame):
                    store.put_df(nid, df_val, g_handle)
                    summary = {
                        "type": "DataFrame",
                        "rows": int(len(df_val)),
                        "columns": list(df_val.columns.astype(str)),
                        "dtypes": _column_dtypes(df_val),
                        "preview": _preview_records(df_val),
                    }
                    if g_handle == "df_out":
                        out_entry["df_out"] = summary
                        primary_df = df_val
                    else:
                        out_entry.setdefault("extra_dfs", {})[g_handle] = summary
            node_outputs[nid] = out_entry
            # Surface inner subflow node outputs (unique IDs) so the UI can show
            # per-node results when the user drills into the group.
            node_outputs.update(sub_outputs)
            logs.append(f"[{label}] group executed in {elapsed_ms} ms")
            executed_count += 1
            continue
        # ────────────────────────────────────────────────────────────────────

        cached_entry = cache.get(fingerprint) if (cache is not None and use_cache) else None
        if cached_entry is not None:
            df_out, html_out, img_out_cached = cached_entry
            img_out: bytes | None = img_out_cached
            # Restore img artifact from cache bytes if the file is gone
            if img_out is not None and not artifact_img_path(artifacts_dir, nid).exists():
                write_img_artifact(artifacts_dir, nid, img_out)
            from_cache = True
            cached_count += 1
        else:
            try:
                df_out, html_out, img_out = execute_node_code(
                    node.code, df_in, params, extra_inputs, img_inputs
                )
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

        if img_out is not None:
            if not isinstance(img_out, (bytes, bytearray)):
                return (
                    "error",
                    node_outputs,
                    logs,
                    nid,
                    f"[{label}] img_out must be bytes, got {type(img_out).__name__}",
                )
            img_bytes = bytes(img_out)
            write_img_artifact(artifacts_dir, nid, img_bytes)
            fname_img = f"{nid}_img.png"
            out_entry["img_out"] = {
                "type": "Image",
                "artifact_url": f"/api/artifacts/{fname_img}",
            }

        if cache is not None and not from_cache:
            cache.put(
                fingerprint,
                df_out if isinstance(df_out, pd.DataFrame) else None,
                html_out,
                bytes(img_out) if isinstance(img_out, (bytes, bytearray)) else None,
            )

        if "df_out" in out_entry or "html_out" in out_entry or "img_out" in out_entry:
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
    no_clear: bool = False,
) -> tuple[str, dict[str, Any], list[str], str | None, str | None]:
    """Run upstream subgraph then the selected node (same engine as full workflow on subgraph)."""
    sub_nodes, sub_edges = subgraph_nodes_for_target(nodes, edges, node_id)
    if not any(n.id == node_id for n in sub_nodes):
        return "error", {}, [], node_id, f"Node not found: {node_id}"
    return run_workflow(sub_nodes, sub_edges, store, artifacts_dir, cache=cache, use_cache=use_cache, no_clear=no_clear)


def run_node_in_group(
    root_nodes: list[WorkflowNode],
    root_edges: list[WorkflowEdge],
    group_path: list[str],
    inner_node_id: str,
    store: DataStore,
    artifacts_dir: Path,
    cache: ResultCache | None = None,
    use_cache: bool = True,
) -> tuple[str, dict[str, Any], list[str], str | None, str | None]:
    """Run a single node *inside* a (possibly nested) group subflow.

    ``group_path`` is the chain of group node IDs from the outer workflow down to
    the subflow containing ``inner_node_id`` (e.g. ``["component_a"]`` for one
    level, ``["component_a", "component_b"]`` for a nested component).

    The group's input data is recomputed from the outer graph every call, so this
    works even without a prior full-workflow run. Returns the same 5-tuple as
    ``run_workflow``; ``node_outputs`` includes the inner target's output.
    """
    store.clear()
    logs: list[str] = []
    # Outer upstream outputs are merged into the result so the frontend can show the
    # input bar's incoming data (and outer node previews) without a prior full run.
    upstream_outputs: dict[str, Any] = {}

    def _bar_inject(input_map: list, nodes: list, port_dfs: list):
        """Build (bar_data, overrides) for a subflow whose input ports carry port_dfs."""
        bar_data: dict[str, dict[str, pd.DataFrame]] = {}
        bar_ids: set[str] = set()
        for mapping in input_map:
            g_handle = mapping.get("groupHandle", "df_in")
            bar_id = mapping.get("nodeId", "")
            bar_handle = mapping.get("nodeHandle", "df_out")
            idx = _handle_index(g_handle) - 1
            df_val = port_dfs[idx] if 0 <= idx < len(port_dfs) else None
            if df_val is not None:
                bar_data.setdefault(bar_id, {})[bar_handle] = df_val
                bar_ids.add(bar_id)
        for n in nodes:
            if n.type in ("group_input_bar", "group_output_bar"):
                bar_ids.add(n.id)
        return bar_data, {bid: None for bid in bar_ids}

    # Descend the group path. At each level we carry forward the input bar data so
    # the NEXT level's upstream (which may include this level's input bar) resolves.
    cur_nodes = root_nodes
    cur_edges = root_edges
    pending_bar_data: dict[str, dict[str, pd.DataFrame]] = {}
    pending_overrides: dict[str, "pd.DataFrame | None"] = {}
    cur_subflow: dict[str, Any] = {}

    for group_id in group_path:
        group = next((n for n in cur_nodes if n.id == group_id), None)
        if group is None or not group.subflow:
            return "error", {}, logs, group_id, f"Group not found: {group_id}"

        # 1. Run everything feeding this group within the current level (injecting any
        #    input-bar data inherited from the level above).
        anc = _ancestors(group_id, cur_edges)
        up_nodes = [n for n in cur_nodes if n.id in anc]
        up_ids = {n.id for n in up_nodes}
        up_edges = [e for e in cur_edges if e.source in up_ids and e.target in up_ids]
        if up_nodes:
            status, _outs, up_logs, err_id, msg = run_workflow(
                up_nodes, up_edges, store, artifacts_dir,
                cache=cache, use_cache=use_cache, no_clear=True,
                bar_data=pending_bar_data, port_overrides=pending_overrides,
            )
            upstream_outputs.update(_outs)
            logs.extend(f"  {l}" for l in up_logs[:-1])
            if status == "error":
                return "error", {}, logs, err_id, msg

        # 2. Read the group's input port DataFrames off its incoming edges.
        incoming = [
            (_handle_index(e.targetHandle), e.source, e.sourceHandle or "df_out")
            for e in cur_edges
            if e.target == group_id and not _is_img_handle(e.targetHandle)
        ]
        max_port = max((idx for idx, _, _ in incoming), default=0)
        port_dfs: list[pd.DataFrame | None] = [None] * max(1, max_port)
        for idx, src, src_handle in incoming:
            df = store.get_df_for_source(src, src_handle)
            port_dfs[idx - 1] = df.copy(deep=False) if df is not None else None

        # 3. Descend: prepare bar data for this group's subflow input bar.
        cur_nodes = [WorkflowNode(**n) for n in group.subflow.get("nodes", [])]
        cur_edges = [WorkflowEdge(**e) for e in group.subflow.get("edges", [])]
        cur_subflow = group.subflow
        pending_bar_data, pending_overrides = _bar_inject(
            cur_subflow.get("input_map", []), cur_nodes, port_dfs,
        )

    # 4. Run only the inner target's subgraph within the innermost subflow.
    inner_nodes, inner_edges = subgraph_nodes_for_target(cur_nodes, cur_edges, inner_node_id)
    if not any(n.id == inner_node_id for n in inner_nodes):
        return "error", {}, logs, inner_node_id, f"Node not found: {inner_node_id}"

    status, outputs, in_logs, err_id, msg = run_workflow(
        inner_nodes, inner_edges, store, artifacts_dir,
        cache=cache, use_cache=use_cache,
        port_overrides=pending_overrides, bar_data=pending_bar_data, no_clear=True,
    )
    logs.extend(in_logs)
    # Merge outer upstream outputs (under their own unique IDs) so the caller can
    # display the group's incoming data. Inner outputs take precedence on conflict.
    merged = {**upstream_outputs, **outputs}
    return status, merged, logs, err_id, msg
