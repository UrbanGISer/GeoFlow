"""Convert notebook cells into a normalized, *runnable* workflow draft.

v0.3: cells are analyzed with the `ast` module to recover real dataflow:
- edges follow variable producer/consumer relationships, not cell order
- cell code is wrapped so notebook variable names bridge to the
  df_in/df_out node convention (imported workflows can actually run)
- import-only cells are merged into the next code cell
- IPython magics / shell escapes are stripped
"""

from __future__ import annotations

import ast
import json
import math
import re
from dataclasses import dataclass, field
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


def _strip_magics(source: str) -> str:
    """Drop IPython magics / shell escapes that are not valid Python."""
    lines: list[str] = []
    for line in source.splitlines():
        stripped = line.lstrip()
        if stripped.startswith(("%", "!")) or "get_ipython()" in stripped:
            lines.append(f"# [magic removed] {stripped[:80]}")
        else:
            lines.append(line)
    return "\n".join(lines)


@dataclass
class CellInfo:
    """Names a cell consumes from earlier cells and names it defines."""

    free_names: set[str] = field(default_factory=set)
    assigned_names: list[str] = field(default_factory=list)  # in assignment order
    imported_names: set[str] = field(default_factory=set)
    import_only: bool = False
    parse_ok: bool = True
    mentions_df_in: bool = False
    mentions_df_out: bool = False


def _analyze_cell(code: str) -> CellInfo:
    info = CellInfo()
    info.mentions_df_in = bool(re.search(r"\bdf_in\b", code))
    info.mentions_df_out = bool(re.search(r"\bdf_out\b", code))
    try:
        tree = ast.parse(code)
    except SyntaxError:
        info.parse_ok = False
        return info

    assigned: set[str] = set()
    import_only = True
    for stmt in tree.body:
        if isinstance(stmt, (ast.Import, ast.ImportFrom)):
            for alias in stmt.names:
                name = (alias.asname or alias.name).split(".")[0]
                assigned.add(name)
                info.imported_names.add(name)
            continue
        import_only = False
        # Uses before assignment within the cell count as external (free) names.
        for node in ast.walk(stmt):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                if node.id not in assigned:
                    info.free_names.add(node.id)
        for node in ast.walk(stmt):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                if node.id not in assigned:
                    info.assigned_names.append(node.id)
                assigned.add(node.id)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                assigned.add(node.name)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    name = (alias.asname or alias.name).split(".")[0]
                    assigned.add(name)
                    info.imported_names.add(name)
    info.import_only = import_only
    # Builtins / common module aliases are not data dependencies.
    info.free_names -= info.imported_names
    return info


def _extract_path_param(code: str, func: str, exts: str) -> str | None:
    m = re.search(rf"{func}\(([^)]*)\)", code)
    if not m:
        return None
    path_match = re.search(rf"""['"]([^'"]+\.({exts}))['"]""", m.group(1), re.IGNORECASE)
    return path_match.group(1) if path_match else None


def _pick_builtin_spec(
    code: str, specs_by_id: dict[str, NodeSpec]
) -> tuple[NodeSpec | None, dict[str, Any]]:
    """Map a cell to a builtin node only when its key params can be recovered,
    so the resulting node is runnable without manual fixes."""
    src = code.lower()
    if "read_csv(" in src:
        path = _extract_path_param(code, r"read_csv", "csv|txt|tsv")
        if path:
            return specs_by_id.get("read_csv"), {"file_path": path}
    if "read_file(" in src or "gpd.read_file" in src:
        path = _extract_path_param(code, r"read_file", "shp|geojson|json|gpkg|zip")
        if path:
            return specs_by_id.get("geofile_reader"), {"file_path": path}
    return None, {}


def _wrap_cell_code(code: str, in_name: str | None, out_name: str | None, info: CellInfo) -> str:
    """Bridge notebook variable names to the df_in/df_out node convention."""
    parts: list[str] = []
    if in_name and not info.mentions_df_in:
        parts.append(f"{in_name} = df_in  # bridged from upstream node")
    parts.append(code.rstrip())
    if not info.mentions_df_out:
        if out_name:
            parts.append(f"df_out = {out_name}  # bridged to downstream nodes")
        elif in_name:
            parts.append(f"df_out = {in_name}  # pass-through")
    return "\n".join(parts) + "\n"


def _temp_spec_from_code(code: str, idx: int, summary: str) -> NodeSpec:
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
        default_code=code.strip() + "\n" if code.strip() else "df_out = df_in.copy() if df_in is not None else None",
        temporary=True,
        provenance={"source": "notebook_standardizer", "summary": summary},
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

    # variable name -> (node_id, position in chain) of its most recent producer
    producers: dict[str, str] = {}
    pending_imports: list[str] = []
    last_node_id: str | None = None
    node_idx = 0

    for cell in code_cells:
        code = _strip_magics(cell.source).strip()
        if not code:
            continue
        info = _analyze_cell(code)

        if info.parse_ok and info.import_only:
            pending_imports.append(code)
            continue

        if pending_imports:
            code = "\n".join([*pending_imports, code])
            pending_imports = []
            info = _analyze_cell(code)

        node_id = _next_id("nb", node_idx)

        # Resolve the upstream node via real dataflow when possible.
        dep_names = [n for n in info.free_names if n in producers]
        in_name: str | None = None
        upstream_node: str | None = None
        if dep_names:
            # Most recently produced dependency wins the single df_in port.
            dep_names.sort(key=lambda n: list(producers.keys()).index(n))
            in_name = dep_names[-1]
            upstream_node = producers[in_name]
            extra = [n for n in dep_names if producers[n] != upstream_node]
            if extra:
                warnings.append(
                    f"Cell {node_idx + 1}: also depends on {', '.join(sorted(set(extra)))} "
                    "from other cells; only one upstream input is connected (single df_in port)."
                )
        elif not info.parse_ok and last_node_id is not None:
            upstream_node = last_node_id  # fall back to sequential order

        picked, picked_params = _pick_builtin_spec(code, specs_by_id)
        if picked is not None:
            params = _json_safe_params({**picked.default_params, **picked_params})
            node = WorkflowNode(
                id=node_id,
                type=picked.id,
                label=picked.label,
                category=picked.category,
                position=Position(x=120 + node_idx * 180, y=160),
                params=params,
                code=picked.default_code,
            )
            upstream_node = None  # source nodes take no df_in
        else:
            out_name = info.assigned_names[-1] if info.assigned_names else None
            wrapped = _wrap_cell_code(code, in_name if upstream_node else None, out_name, info)
            summary = code.splitlines()[0][:80]
            temp_spec = _temp_spec_from_code(wrapped, node_idx, summary)
            generated_specs.append(temp_spec)
            node = WorkflowNode(
                id=node_id,
                type=temp_spec.id,
                label=temp_spec.label,
                category=temp_spec.category,
                position=Position(x=120 + node_idx * 180, y=160),
                params=_json_safe_params(dict(temp_spec.default_params)),
                code=temp_spec.default_code,
            )

        workflow_nodes.append(node)
        if upstream_node:
            workflow_edges.append(
                WorkflowEdge(
                    id=_edge_id(upstream_node, node.id, node_idx),
                    source=upstream_node,
                    target=node.id,
                    sourceHandle="df_out",
                    targetHandle="df_in",
                )
            )

        # This cell now produces every name it assigned.
        for name in info.assigned_names:
            producers[name] = node.id
        last_node_id = node.id
        node_idx += 1

    if not workflow_nodes:
        warnings.append("No executable code cells found in notebook input.")

    return WorkflowPayload(nodes=workflow_nodes, edges=workflow_edges), generated_specs, warnings
