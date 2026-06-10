"""Node retrieval utilities (library-first selection)."""

from __future__ import annotations

from app.models import NodeSpec, PlanStep


def _score(step: PlanStep, spec: NodeSpec) -> float:
    t = f"{step.title} {step.intent}".lower()
    s = f"{spec.id} {spec.label} {spec.category}".lower()
    score = 0.0
    for token in ["geo", "map", "hist", "group", "filter", "read", "csv", "transform"]:
        if token in t and token in s:
            score += 0.14
    if step.io_type == "df_to_html" and "html_out" in spec.outputs:
        score += 0.25
    if step.io_type == "source_to_df" and len(spec.inputs) == 0 and "df_out" in spec.outputs:
        score += 0.25
    if step.io_type == "df_to_df" and "df_in" in spec.inputs and "df_out" in spec.outputs:
        score += 0.25
    if step.io_type == "df_to_html" and "df_in" in spec.inputs:
        score += 0.1
    return min(score, 1.0)


def retrieve_best(step: PlanStep, specs: list[NodeSpec]) -> tuple[NodeSpec | None, float]:
    best: NodeSpec | None = None
    best_score = -1.0
    for spec in specs:
        sc = _score(step, spec)
        if sc > best_score:
            best_score = sc
            best = spec
    return best, max(best_score, 0.0)
