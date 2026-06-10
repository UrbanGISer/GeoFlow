"""Convert notebook cells into a normalized workflow draft."""

from __future__ import annotations

import json
import math
import re
from typing import Any

from app.default_nodes import DEFAULT_NODE_SPECS
from app.models import NotebookCell, NodeSpec, Position, WorkflowEdge, WorkflowNode, WorkflowPayload

# Guardrails so API responses and proxies do not choke on huge notebooks.
MAX_CODE_CELLS = 200
MAX_SOURCE_CHARS_PER_CELL = 120_000


def _next_id(prefix: str, idx: int) -> str:
    return f"{prefix}_{idx + 1}"


def _edge_id(source: str, target: str, idx: int) -> str:
    return f"edge_{source}_{target}_{idx}"


def _pick_builtin_spec(code: str, specs_by_id: dict[str, NodeSpec]) -> NodeSpec | None:
    src = code.lower()
    if "read_file(" in src or "geopandas" in src or "gpd.read_file" in src:
        return specs_by_id.get("geofile_reader")
    if "read_csv(" in src:
        return specs_by_id.get("read_csv")
    if "groupby(" in src:
        return specs_by_id.get("groupby")
    if "histogram" in src or "px.histogram" in src:
        return specs_by_id.get("histogram")
    if "folium." in src or "geojson" in src:
        return specs_by_id.get("geomap")
    if "query(" in src or ".loc[" in src or "filter" in src:
        return specs_by_id.get("row_filter")
    return None


def _temp_spec_from_code(code: str, idx: int) -> NodeSpec:
    node_id = f"tmp_nb_{idx + 1}"
    return NodeSpec(
        id=node_id,
        name=node_id,
        label=f"Notebook Step {idx + 1}",
        category="Temporary",
        color="#8e24aa",
        inputs={"df_in": {"type": "DataFrame"}},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[],
        default_params={},
        default_code=code.strip() or "df_out = df_in.copy() if df_in is not None else None",
        temporary=True,
        provenance={"source": "notebook_standardizer"},
    )


def parse_notebook_cells(notebook_json: str | None, cells: list[NotebookCell]) -> tuple[list[NotebookCell], list[str]]:
    """Returns (code_cells, parse_warnings)."""
    warnings: list[str] = []
    if cells:
        raw = [c for c in cells if c.cell_type == "code" and c.source.strip()]
    elif not notebook_json:
        return [], warnings
    else:
        try:
            obj = json.loads(notebook_json)
        except json.JSONDecodeError as e:
            warnings.append(f"Invalid notebook JSON: {e}")
            return [], warnings
        raw = []
        for cell in obj.get("cells", []):
            if cell.get("cell_type") != "code":
                continue
            source = cell.get("source", "")
            if isinstance(source, list):
                source = "".join(source)
            if isinstance(source, str) and source.strip():
                raw.append(NotebookCell(cell_type="code", source=source))
    out: list[NotebookCell] = []
    for i, c in enumerate(raw[:MAX_CODE_CELLS]):
        src = c.source
        if len(src) > MAX_SOURCE_CHARS_PER_CELL:
            warnings.append(
                f"Cell {i + 1}: source truncated from {len(src)} to {MAX_SOURCE_CHARS_PER_CELL} chars for import stability.",
            )
            src = src[:MAX_SOURCE_CHARS_PER_CELL] + "\n# ... [truncated by NotebookFlow import]"
        out.append(NotebookCell(cell_type="code", source=src))
    if len(raw) > MAX_CODE_CELLS:
        warnings.append(f"Only the first {MAX_CODE_CELLS} code cells were imported ({len(raw)} total).")
    return out, warnings


def _json_safe_params(params: dict[str, Any]) -> dict[str, Any]:
    """Ensure params are JSON-serializable (avoid NaN/Inf breaking FastAPI JSON encoding)."""
    out: dict[str, Any] = {}
    for k, v in params.items():
        if isinstance(v, float) and not math.isfinite(v):
            out[k] = None
        else:
            out[k] = v
    return out


def standardize_notebook(
    notebook_json: str | None,
    cells: list[NotebookCell],
) -> tuple[WorkflowPayload, list[NodeSpec], list[str]]:
    if notebook_json is not None:
        notebook_json = notebook_json.lstrip("\ufeff").replace("\x00", "")
    code_cells, parse_warnings = parse_notebook_cells(notebook_json, cells)
    specs_by_id = {s.id: s for s in DEFAULT_NODE_SPECS}
    generated_specs: list[NodeSpec] = []
    warnings: list[str] = list(parse_warnings)
    workflow_nodes: list[WorkflowNode] = []
    workflow_edges: list[WorkflowEdge] = []

    for idx, cell in enumerate(code_cells):
        code = cell.source.strip()
        picked = _pick_builtin_spec(code, specs_by_id)
        node_id = _next_id("nb", idx)
        if picked is None:
            temp_spec = _temp_spec_from_code(code, idx)
            generated_specs.append(temp_spec)
            node = WorkflowNode(
                id=node_id,
                type=temp_spec.id,
                label=temp_spec.label,
                category=temp_spec.category,
                position=Position(x=120 + idx * 180, y=160),
                params=_json_safe_params(dict(temp_spec.default_params)),
                code=temp_spec.default_code,
            )
        else:
            params = _json_safe_params(dict(picked.default_params))
            if picked.id == "read_csv":
                m = re.search(r"read_csv\(([^)]*)\)", code)
                if m:
                    args = m.group(1)
                    path_match = re.search(r"""['"]([^'"]+\.(csv|txt))['"]""", args, re.IGNORECASE)
                    if path_match:
                        params["file_path"] = path_match.group(1)
            node = WorkflowNode(
                id=node_id,
                type=picked.id,
                label=picked.label,
                category=picked.category,
                position=Position(x=120 + idx * 180, y=160),
                params=params,
                code=picked.default_code,
            )
        workflow_nodes.append(node)
        if idx > 0:
            prev = workflow_nodes[idx - 1]
            workflow_edges.append(
                WorkflowEdge(
                    id=_edge_id(prev.id, node.id, idx),
                    source=prev.id,
                    target=node.id,
                    sourceHandle="df_out",
                    targetHandle="df_in",
                )
            )

    if not workflow_nodes:
        warnings.append("No executable code cells found in notebook input.")

    return WorkflowPayload(nodes=workflow_nodes, edges=workflow_edges), generated_specs, warnings
