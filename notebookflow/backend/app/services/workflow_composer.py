"""Compose executable workflow from planned steps."""

from __future__ import annotations

from app.models import (
    ComposeWorkflowRequest,
    ComposeWorkflowResponse,
    NodeSuggestion,
    NodeSpec,
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


def compose_workflow(req: ComposeWorkflowRequest, specs: list[NodeSpec]) -> ComposeWorkflowResponse:
    planned = plan_workflow(
        WorkflowPlanRequest(
            prompt=req.prompt,
            data_context=req.data_context,
            constraints=req.constraints,
            max_steps=req.max_steps,
        )
    )
    nodes: list[WorkflowNode] = []
    edges: list[WorkflowEdge] = []
    suggestions: list[NodeSuggestion] = []
    generated_specs: list[NodeSpec] = []
    warnings = list(planned.warnings)
    prev_id: str | None = None
    for idx, step in enumerate(planned.steps):
        chosen, score = retrieve_best(step, specs)
        used_temp = False
        if chosen is None or score < req.confidence_threshold:
            if req.allow_temporary_nodes:
                chosen = build_temp_node_spec(step, req.prompt, idx)
                generated_specs.append(chosen)
                used_temp = True
            else:
                warnings.append(f"Step '{step.title}' skipped (no library match).")
                continue
        node_id = f"wf_{idx + 1}"
        nodes.append(
            WorkflowNode(
                id=node_id,
                type=chosen.id,
                label=chosen.label,
                category=chosen.category,
                position=Position(x=120 + idx * 190, y=180),
                params=dict(chosen.default_params),
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
                reason="library match" if not used_temp else "temporary fallback",
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
