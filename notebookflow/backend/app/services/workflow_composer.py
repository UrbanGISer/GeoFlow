"""Compose executable workflow from planned steps.

Library-first: the catalog-aware planner can directly select node ids and
fill params; otherwise a token-overlap retriever maps steps to specs, and a
temporary node (planner-generated code or template) is the last resort.
"""

from __future__ import annotations

from app.models import (
    ComposeWorkflowRequest,
    ComposeWorkflowResponse,
    NodeSuggestion,
    NodeSpec,
    PlanStep,
    Position,
    WorkflowPlanRequest,
    WorkflowEdge,
    WorkflowNode,
    WorkflowPayload,
)
from app.services.node_retriever import retrieve_best
from app.services.planner import plan_workflow
from app.services.temp_node_factory import build_temp_node_spec
from app.services.workflow_validator import validate_workflow


def _merged_params(spec: NodeSpec, step: PlanStep, warnings: list[str]) -> dict:
    """Planner-suggested params override defaults, restricted to declared parameters."""
    params = dict(spec.default_params)
    if not step.params:
        return params
    known = {p.name for p in spec.parameters}
    for key, value in step.params.items():
        if key in known or key in params:
            params[key] = value
        else:
            warnings.append(
                f"Step '{step.title}': ignored unknown parameter '{key}' for node '{spec.id}'."
            )
    return params


def compose_workflow(req: ComposeWorkflowRequest, specs: list[NodeSpec]) -> ComposeWorkflowResponse:
    planned = plan_workflow(
        WorkflowPlanRequest(
            prompt=req.prompt,
            data_context=req.data_context,
            constraints=req.constraints,
            max_steps=req.max_steps,
        ),
        specs,
    )
    by_id = {s.id: s for s in specs}
    nodes: list[WorkflowNode] = []
    edges: list[WorkflowEdge] = []
    suggestions: list[NodeSuggestion] = []
    generated_specs: list[NodeSpec] = []
    warnings = list(planned.warnings)
    prev_id: str | None = None

    for idx, step in enumerate(planned.steps):
        chosen: NodeSpec | None = None
        score = 0.0
        reason = ""
        used_temp = False
        params: dict = {}

        if step.node_id:
            chosen = by_id.get(step.node_id)
            if chosen is not None:
                score = 0.95
                reason = "planner selected library node"
            else:
                warnings.append(
                    f"Step '{step.title}': planner referenced unknown node '{step.node_id}'; using retriever."
                )

        if chosen is None and not step.code:
            chosen, score = retrieve_best(step, specs)
            reason = "library match"

        if chosen is None or score < req.confidence_threshold:
            if req.allow_temporary_nodes:
                chosen = build_temp_node_spec(step, req.prompt, idx, warnings=warnings)
                generated_specs.append(chosen)
                used_temp = True
                provenance = (chosen.provenance or {}).get("source", "")
                reason = (
                    "temporary node from planner-generated code"
                    if provenance == "planner_generated_code"
                    else "temporary fallback template"
                )
                params = dict(chosen.default_params)
            else:
                warnings.append(f"Step '{step.title}' skipped (no library match).")
                continue
        else:
            params = _merged_params(chosen, step, warnings)

        node_id = f"wf_{idx + 1}"
        nodes.append(
            WorkflowNode(
                id=node_id,
                type=chosen.id,
                label=chosen.label,
                category=chosen.category,
                position=Position(x=120 + idx * 190, y=180),
                params=params,
                code=chosen.default_code,
            )
        )
        if prev_id and chosen.inputs:
            edges.append(
                WorkflowEdge(
                    id=f"edge_{prev_id}_{node_id}_{idx}",
                    source=prev_id,
                    target=node_id,
                    sourceHandle="df_out",
                    targetHandle="df_in",
                )
            )
        prev_id = node_id
        suggestions.append(
            NodeSuggestion(
                step_title=step.title,
                chosen_node_id=chosen.id,
                confidence=score,
                reason=reason,
                used_temporary=used_temp,
            )
        )

    payload = WorkflowPayload(nodes=nodes, edges=edges)
    merged_specs = [*specs, *generated_specs]
    validation = validate_workflow(payload, merged_specs)
    return ComposeWorkflowResponse(
        workflow=payload,
        generated_node_specs=generated_specs,
        suggestions=suggestions,
        warnings=warnings,
        validation=validation,
    )
