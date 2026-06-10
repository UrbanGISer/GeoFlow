"""Workflow validation utilities."""

from __future__ import annotations

from app.models import NodeSpec, WorkflowPayload, WorkflowValidation


def validate_workflow(payload: WorkflowPayload, specs: list[NodeSpec]) -> WorkflowValidation:
    errors: list[str] = []
    warnings: list[str] = []
    by_id = {s.id: s for s in specs}
    node_ids = {n.id for n in payload.nodes}
    if not payload.nodes:
        errors.append("Workflow has no nodes.")
    for e in payload.edges:
        if e.source not in node_ids or e.target not in node_ids:
            errors.append(f"Invalid edge {e.id}: source/target not found.")
    for n in payload.nodes:
        spec = by_id.get(n.type)
        if not spec:
            warnings.append(f"Node {n.id} uses unknown type '{n.type}' (may be temporary).")
            continue
        for p in spec.parameters:
            if p.required:
                val = n.params.get(p.name)
                if val in (None, "", []):
                    warnings.append(f"Node {n.id} missing required parameter '{p.name}'.")
    return WorkflowValidation(ok=len(errors) == 0, errors=errors, warnings=warnings)
