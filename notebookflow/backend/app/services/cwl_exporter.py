"""CWL (Common Workflow Language) export — interface reservation.

GeoFlow nodes are Python exec cells; full CWL CommandLineTool mapping is
non-trivial (requires containerized runners).  This stub:
  - generates syntactically valid CWL v1.2 Workflow + CommandLineTool stubs
  - embeds the original Python code as a hint so the spec round-trips
  - is intentionally incomplete — real execution requires a CWL runner
    (cwltool, Toil, etc.) and Docker images per node.

The exported YAML can serve as a starting point for CWL-native pipelines.
"""

from __future__ import annotations

import hashlib
import json
import textwrap
from typing import Any

from app.models import WorkflowNode, WorkflowEdge


def _safe_id(node_id: str) -> str:
    return "step_" + hashlib.md5(node_id.encode()).hexdigest()[:6]


def _node_to_tool(node: WorkflowNode) -> dict[str, Any]:
    """Produce a CWL CommandLineTool stub for a single node."""
    return {
        "cwlVersion": "v1.2",
        "class": "CommandLineTool",
        "id": node.id,
        "label": node.label,
        "doc": f"GeoFlow node type={node.type}. Params={json.dumps(node.params)}",
        "hints": {
            "geoflow:PythonNode": {
                "nodeType": node.type,
                "params": node.params,
                "code": node.code,
            }
        },
        "baseCommand": ["python3", "-m", "geoflow.run_node"],
        "arguments": [
            {"valueFrom": node.id, "prefix": "--node-id"},
            {"valueFrom": json.dumps(node.params), "prefix": "--params"},
        ],
        "inputs": {
            "df_in": {
                "type": ["null", "File"],
                "inputBinding": {"prefix": "--df-in"},
            }
        },
        "outputs": {
            "df_out": {
                "type": ["null", "File"],
                "outputBinding": {"glob": "df_out.parquet"},
            },
            "html_out": {
                "type": ["null", "File"],
                "outputBinding": {"glob": "html_out.html"},
            },
        },
    }


def export_cwl(nodes: list[WorkflowNode], edges: list[WorkflowEdge]) -> dict[str, Any]:
    """Return a CWL v1.2 Workflow document (as a dict, serialize to YAML/JSON)."""
    node_map = {n.id: n for n in nodes}

    # Build adjacency: target_id → list[source_id]
    incoming: dict[str, list[str]] = {n.id: [] for n in nodes}
    for e in edges:
        incoming.setdefault(e.target, []).append(e.source)

    cwl_steps: dict[str, Any] = {}
    cwl_inputs: dict[str, Any] = {}

    for node in nodes:
        step_id = _safe_id(node.id)
        in_sources = incoming.get(node.id, [])

        step_in: dict[str, Any] = {}
        if in_sources:
            upstream = in_sources[0]
            step_in["df_in"] = f"{_safe_id(upstream)}/df_out"
        else:
            # Source node — wire to a workflow-level input
            wf_input_id = f"input_{step_id}"
            cwl_inputs[wf_input_id] = {"type": ["null", "File"]}
            step_in["df_in"] = wf_input_id

        cwl_steps[step_id] = {
            "run": f"#{node.id}",
            "label": node.label,
            "in": step_in,
            "out": ["df_out", "html_out"],
        }

    # Identify sink nodes (no outgoing edges) as workflow outputs
    sources = {e.source for e in edges}
    sink_ids = [n.id for n in nodes if n.id not in sources]
    cwl_outputs: dict[str, Any] = {}
    for sink_id in sink_ids:
        step_id = _safe_id(sink_id)
        cwl_outputs[f"out_{step_id}"] = {
            "type": ["null", "File"],
            "outputSource": f"{step_id}/df_out",
        }
        cwl_outputs[f"html_{step_id}"] = {
            "type": ["null", "File"],
            "outputSource": f"{step_id}/html_out",
        }

    tools = [_node_to_tool(node_map[n.id]) for n in nodes]

    wf = {
        "cwlVersion": "v1.2",
        "class": "Workflow",
        "$namespaces": {"geoflow": "https://github.com/spatial-data-lab/geoflow#"},
        "doc": textwrap.dedent("""\
            GeoFlow exported workflow (CWL v1.2 stub).
            NOTE: This is an interface reservation — nodes require a GeoFlow
            CWL runner image to execute natively. The 'geoflow:PythonNode' hints
            embed the original Python code for round-trip fidelity.
        """),
        "inputs": cwl_inputs,
        "outputs": cwl_outputs,
        "steps": cwl_steps,
        "$graph": tools,
    }
    return wf
