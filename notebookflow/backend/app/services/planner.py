"""LLM planner with OpenAI-compatible API and deterministic fallback.

The planner is *catalog-aware*: the model sees the actual node library
(ids, IO contracts, parameters) and returns concrete steps that either
reference an existing node id with filled-in params, or carry generated
node code following the df_in/params/df_out convention.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from urllib import request

from app.models import AIConfig, NodeSpec, PlanStep, WorkflowPlanRequest

NODE_CODE_CONVENTION = (
    "Node code convention: each node is a Python cell that receives "
    "`df_in` (pandas/geopandas DataFrame from the upstream node, or None for source nodes) "
    "and `params` (dict). It must assign `df_out` (DataFrame) for data nodes, or "
    "`html_out` (HTML string, e.g. plotly `fig.to_html(include_plotlyjs='cdn')` or a folium "
    "map `m.get_root().render()`) for visualization nodes. "
    "Available libraries: pandas (pd), geopandas, plotly, folium."
)


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


def extract_json_object(text: str) -> dict | None:
    """Parse a JSON object out of an LLM reply that may be fenced or chatty."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            obj = json.loads(text[start : end + 1])
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    return None


def catalog_summary(specs: list[NodeSpec]) -> str:
    """Compact, LLM-readable description of the node library."""
    lines: list[str] = []
    for s in specs:
        param_bits = []
        for p in s.parameters:
            bit = f"{p.name}:{p.type}"
            if p.required:
                bit += "*"
            if p.options:
                bit += f"[{'|'.join(str(o) for o in p.options)}]"
            param_bits.append(bit)
        inputs = ",".join(s.inputs.keys()) or "none"
        outputs = ",".join(s.outputs.keys()) or "none"
        lines.append(
            f"- id={s.id} | {s.label} ({s.category}) | in:{inputs} out:{outputs} | params: {', '.join(param_bits) or 'none'}"
        )
    return "\n".join(lines)


def _chat_completion(
    messages: list[dict],
    temperature: float = 0.2,
    ai_config: AIConfig | None = None,
) -> str:
    base_url = (
        ai_config.base_url if ai_config and ai_config.base_url
        else os.getenv("AI_API_BASE_URL", "").strip()
    )
    api_key = (
        ai_config.api_key if ai_config and ai_config.api_key
        else os.getenv("AI_API_KEY", "").strip()
    )
    model = (
        ai_config.model if ai_config and ai_config.model
        else os.getenv("AI_MODEL", "").strip()
    )
    if not base_url or not api_key or not model:
        raise RuntimeError("AI provider not configured (set base_url/api_key/model).")
    timeout = float(os.getenv("AI_TIMEOUT_SECONDS", "60"))
    url = f"{base_url.rstrip('/')}/chat/completions"
    body = {"model": model, "temperature": temperature, "messages": messages}
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
    with request.urlopen(http_req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    obj = json.loads(raw)
    return obj["choices"][0]["message"]["content"]


def llm_available(ai_config: AIConfig | None = None) -> bool:
    if ai_config:
        return bool(ai_config.base_url and ai_config.api_key and ai_config.model)
    return bool(
        os.getenv("AI_API_BASE_URL", "").strip()
        and os.getenv("AI_API_KEY", "").strip()
        and os.getenv("AI_MODEL", "").strip()
    )


def _build_plan_prompt(req: WorkflowPlanRequest, specs: list[NodeSpec] | None) -> str:
    parts = [
        "Plan a data-analysis workflow as a linear chain of steps. "
        "Return strict JSON: {\"steps\": [...]}. Each step has:\n"
        "  title (short), intent (one sentence), io_type (source_to_df|df_to_df|df_to_html),\n"
        "  node_id (an id from the node library below if one fits the step, else null),\n"
        "  params (concrete parameter values for that node; use real column/file names from the data context when known),\n"
        "  code (ONLY when node_id is null: Python following the node code convention; else null).",
        NODE_CODE_CONVENTION,
        f"Max steps: {max(1, req.max_steps)}.",
    ]
    if specs:
        parts.append("Node library:\n" + catalog_summary(specs))
    parts.append(f"User goal: {req.prompt}")
    if req.data_context:
        parts.append(f"Data context: {req.data_context}")
    if req.constraints:
        parts.append(f"Constraints: {req.constraints}")
    return "\n\n".join(parts)


def _parse_steps(parsed: dict, max_steps: int, warnings: list[str]) -> list[PlanStep]:
    steps: list[PlanStep] = []
    for i, item in enumerate(parsed.get("steps", [])):
        if not isinstance(item, dict):
            continue
        try:
            steps.append(
                PlanStep(
                    title=str(item.get("title") or f"Step {i + 1}"),
                    intent=str(item.get("intent") or ""),
                    io_type=str(item.get("io_type") or "df_to_df"),
                    node_id=item.get("node_id") or None,
                    params=item.get("params") if isinstance(item.get("params"), dict) else {},
                    code=item.get("code") or None,
                )
            )
        except Exception as e:  # noqa: BLE001
            warnings.append(f"Skipped malformed plan step {i + 1}: {e}")
    return steps[: max(1, max_steps)]


def plan_workflow(
    req: WorkflowPlanRequest,
    specs: list[NodeSpec] | None = None,
) -> PlannerResult:
    warnings: list[str] = []
    ai_config = req.ai_config if hasattr(req, "ai_config") else None
    try:
        content = _chat_completion(
            [
                {
                    "role": "system",
                    "content": (
                        "You are the workflow planner of a visual GIS/data-analysis tool. "
                        "Respond with a single JSON object and nothing else."
                    ),
                },
                {"role": "user", "content": _build_plan_prompt(req, specs)},
            ],
            ai_config=ai_config,
        )
        parsed = extract_json_object(content)
        if parsed is None:
            warnings.append("Model reply was not parseable JSON; fallback heuristics were used.")
            return PlannerResult(steps=_heuristic_steps(req.prompt, req.max_steps), raw_text=content, warnings=warnings)
        steps = _parse_steps(parsed, req.max_steps, warnings)
        if not steps:
            warnings.append("Model returned no steps; fallback heuristics were used.")
            return PlannerResult(steps=_heuristic_steps(req.prompt, req.max_steps), raw_text=content, warnings=warnings)
        return PlannerResult(steps=steps, raw_text=content, warnings=warnings)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Planner fallback used: {exc}")
        return PlannerResult(steps=_heuristic_steps(req.prompt, req.max_steps), raw_text="", warnings=warnings)
