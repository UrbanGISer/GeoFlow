"""LLM planner with OpenAI-compatible API and deterministic fallback."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib import request

from app.models import PlanStep, WorkflowPlanRequest


@dataclass
class PlannerResult:
    steps: list[PlanStep]
    raw_text: str
    warnings: list[str]


def _heuristic_steps(prompt: str, max_steps: int) -> list[PlanStep]:
    p = prompt.lower()
    steps: list[PlanStep] = []
    if any(x in p for x in ["shp", "geojson", "geofile", "shape"]):
        steps.append(PlanStep(title="Load geospatial file", intent="read geospatial source", io_type="source_to_df"))
    elif any(x in p for x in ["csv", "table", "dataset"]):
        steps.append(PlanStep(title="Load tabular data", intent="read csv source", io_type="source_to_df"))
    else:
        steps.append(PlanStep(title="Load input data", intent="load data", io_type="source_to_df"))

    if any(x in p for x in ["filter", "subset", "where"]):
        steps.append(PlanStep(title="Filter rows", intent="filter records", io_type="df_to_df"))
    if any(x in p for x in ["group", "aggregate", "summary"]):
        steps.append(PlanStep(title="Aggregate metrics", intent="group and aggregate", io_type="df_to_df"))
    if any(x in p for x in ["hist", "distribution"]):
        steps.append(PlanStep(title="Plot histogram", intent="histogram visualization", io_type="df_to_html"))
    if any(x in p for x in ["map", "folium", "spatial"]):
        steps.append(PlanStep(title="Render map", intent="map visualization", io_type="df_to_html"))
    if len(steps) == 1:
        steps.append(PlanStep(title="Transform data", intent="apply transformation", io_type="df_to_df"))
    return steps[: max(1, max_steps)]


def _call_openai_compatible(req: WorkflowPlanRequest) -> tuple[list[PlanStep], str]:
    base_url = os.getenv("AI_API_BASE_URL", "").strip()
    api_key = os.getenv("AI_API_KEY", "").strip()
    model = os.getenv("AI_MODEL", "").strip()
    if not base_url or not api_key or not model:
        raise RuntimeError("AI_API_BASE_URL / AI_API_KEY / AI_MODEL not configured.")
    url = f"{base_url.rstrip('/')}/chat/completions"
    prompt = (
        "You are a workflow planner. Return strict JSON with key 'steps'. "
        "Each step item includes: title, intent, io_type (source_to_df|df_to_df|df_to_html). "
        f"Max steps: {max(1, req.max_steps)}.\n\n"
        f"User prompt: {req.prompt}\n"
        f"Data context: {req.data_context}\n"
        f"Constraints: {req.constraints}"
    )
    body = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": "Return only valid JSON."},
            {"role": "user", "content": prompt},
        ],
    }
    payload = json.dumps(body).encode("utf-8")
    http_req = request.Request(
        url=url,
        method="POST",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with request.urlopen(http_req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
    obj = json.loads(raw)
    content = obj["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    steps = [PlanStep(**s) for s in parsed.get("steps", [])]
    return steps, content


def plan_workflow(req: WorkflowPlanRequest) -> PlannerResult:
    warnings: list[str] = []
    try:
        steps, raw = _call_openai_compatible(req)
        if not steps:
            warnings.append("Model returned no steps; fallback heuristics were used.")
            hs = _heuristic_steps(req.prompt, req.max_steps)
            return PlannerResult(steps=hs, raw_text=raw, warnings=warnings)
        return PlannerResult(steps=steps[: req.max_steps], raw_text=raw, warnings=warnings)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Planner fallback used: {exc}")
        hs = _heuristic_steps(req.prompt, req.max_steps)
        return PlannerResult(steps=hs, raw_text="", warnings=warnings)
