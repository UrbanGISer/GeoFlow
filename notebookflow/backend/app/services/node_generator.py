"""AI-powered node generator.

Given a plain-English description, asks an LLM to write a Python code cell
that follows the df_in / params / df_out / html_out convention, then wraps
it in a NodeSpec so it can be used immediately on the canvas.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Any

from app.models import AIConfig, NodeSpec, ParameterSpec

_SYSTEM_PROMPT = """\
You are an expert GeoFlow node developer.
A GeoFlow Python node cell always receives these two variables:
  df_in   - pandas or geopandas DataFrame (may be None for source nodes)
  params  - dict of user-supplied parameters

And must produce one or both of:
  df_out  - transformed DataFrame for downstream nodes
  html_out - HTML string for the output panel (plotly, folium, matplotlib base64, etc.)

Rules:
1. Start with imports inside the cell (no top-level).
2. Validate required params and raise ValueError with a clear message if missing.
3. Never use subprocess, os.system, eval, exec, socket, pickle.loads, or shutil.rmtree.
4. Keep the code under 50 lines.
5. Return a JSON object with these keys:
   - "label": short display name (≤30 chars)
   - "category": one of [Input, Transform, GIS, Visualization, Nature View, Python Script]
   - "code": the Python cell string
   - "parameters": list of {name, type, required, default} objects
     type is one of: string, number, enum, file, column, column_list
   - "color": a suitable hex color matching the category (Input=#e53935, Transform=#fbc02d,
     GIS=#26a69a, Visualization=#1e88e5, Nature View=#2e7d32, Python Script=#546e7a)
"""


def _call_llm(prompt: str, ai_config: AIConfig | None) -> str:
    base_url = (
        ai_config.base_url if ai_config and ai_config.base_url
        else os.environ.get("AI_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
    )
    api_key = (
        ai_config.api_key if ai_config and ai_config.api_key
        else os.environ.get("AI_API_KEY", "")
    )
    model = (
        ai_config.model if ai_config and ai_config.model
        else os.environ.get("AI_MODEL", "gemini-2.5-flash")
    )

    base_url = base_url.rstrip("/")
    url = f"{base_url}/chat/completions"

    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    timeout = int(os.environ.get("AI_TIMEOUT_SECONDS", "60"))
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode())["choices"][0]["message"]["content"]


def _extract_json(text: str) -> dict[str, Any] | None:
    """Extract JSON object from LLM reply (may have markdown fences)."""
    # Try fenced block first
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        try:
            return json.loads(fence.group(1))
        except json.JSONDecodeError:
            pass
    # Find first { ... } span
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    pass
    return None


_CATEGORY_COLORS = {
    "Input": "#e53935",
    "Transform": "#fbc02d",
    "GIS": "#26a69a",
    "Visualization": "#1e88e5",
    "Nature View": "#2e7d32",
    "Python Script": "#546e7a",
}

_BANNED = re.compile(
    r"\b(subprocess|os\.system|os\.remove|shutil\.rmtree|__import__|"
    r"eval\s*\(|exec\s*\(|socket\.|pickle\.loads)\b"
)


_CODE_SYSTEM_PROMPT = """\
You write a single Python code cell for a GeoFlow node. The cell receives:
  df_in   - pandas/geopandas DataFrame from upstream (may be None)
  df_in_2, df_in_3, ... and df_ins - extra inputs for multi-port nodes
  params  - dict of user parameters

Rules:
1. DATA mode: the cell MUST assign df_out (a pandas/geopandas DataFrame).
   VIEW mode: the cell MUST assign html_out (an HTML string — plotly
   fig.to_html(include_plotlyjs='cdn'), folium m.get_root().render(),
   or a base64 <img> from matplotlib).
2. Imports go inside the cell. Available: pandas, geopandas, plotly,
   folium, matplotlib, seaborn, numpy.
3. Never use subprocess, os.system, eval, exec, socket, pickle.loads,
   shutil.rmtree.
4. Reply with ONLY the Python code — no markdown fences, no explanation.
"""


def generate_code(
    description: str,
    mode: str = "data",
    current_code: str = "",
    data_context: str = "",
    ai_config: AIConfig | None = None,
) -> tuple[str, list[str]]:
    """Generate (or rewrite) a node code cell from a plain-English ask."""
    warnings: list[str] = []
    target = "html_out (VIEW mode)" if mode == "html" else "df_out (DATA mode)"
    parts = [f"Write the node code cell. Output target: {target}.", f"Task: {description}"]
    if data_context:
        parts.append(f"Data context: {data_context}")
    if current_code.strip():
        parts.append(f"Current code (rewrite/extend as needed):\n{current_code}")

    base_url = (
        ai_config.base_url if ai_config and ai_config.base_url
        else os.environ.get("AI_API_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
    )
    api_key = ai_config.api_key if ai_config and ai_config.api_key else os.environ.get("AI_API_KEY", "")
    model = ai_config.model if ai_config and ai_config.model else os.environ.get("AI_MODEL", "gemini-2.5-flash")
    if not api_key:
        raise RuntimeError("AI provider not configured — set your API key in the AI settings.")

    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": _CODE_SYSTEM_PROMPT},
            {"role": "user", "content": "\n\n".join(parts)},
        ],
        "temperature": 0.2,
    }).encode()
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    timeout = int(os.environ.get("AI_TIMEOUT_SECONDS", "60"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            raw = json.loads(resp.read().decode())["choices"][0]["message"]["content"]
    except Exception as exc:
        raise RuntimeError(f"LLM call failed: {exc}") from exc

    code = raw.strip()
    # Strip markdown fences if the model added them anyway.
    fence = re.match(r"^```(?:python)?\s*\n(.*?)\n?```\s*$", code, re.DOTALL)
    if fence:
        code = fence.group(1)

    banned = _BANNED.findall(code)
    if banned:
        raise RuntimeError(f"Generated code contained banned pattern(s): {banned}")
    out_var = "html_out" if mode == "html" else "df_out"
    if out_var not in code:
        warnings.append(f"Generated code does not assign {out_var} — review before running.")
    return code, warnings


def generate_node(
    description: str,
    category: str = "Python Script",
    ai_config: AIConfig | None = None,
) -> tuple[NodeSpec, list[str]]:
    """Ask the LLM to generate a node spec for the given description.

    Returns (NodeSpec, warnings).  Raises RuntimeError on hard failures.
    """
    warnings: list[str] = []

    try:
        raw = _call_llm(
            f"Generate a GeoFlow node that does the following:\n{description}\n\n"
            f"Preferred category: {category}",
            ai_config,
        )
    except Exception as exc:
        raise RuntimeError(f"LLM call failed: {exc}") from exc

    data = _extract_json(raw)
    if not data:
        raise RuntimeError(f"LLM did not return valid JSON. Raw reply:\n{raw[:500]}")

    code = data.get("code", "# LLM produced no code\ndf_out = df_in")
    label = data.get("label", description[:30])
    cat = data.get("category", category)
    color = data.get("color", _CATEGORY_COLORS.get(cat, "#546e7a"))

    # Safety scan
    banned_hits = _BANNED.findall(code)
    if banned_hits:
        warnings.append(f"Generated code contained banned pattern(s): {banned_hits}. Code was replaced.")
        code = "# Safety scan blocked generated code — please write your own implementation\ndf_out = df_in"

    # Build parameters
    raw_params = data.get("parameters", [])
    parameters: list[ParameterSpec] = []
    default_params: dict[str, Any] = {}
    for p in raw_params:
        if not isinstance(p, dict) or "name" not in p:
            continue
        ps = ParameterSpec(
            name=p["name"],
            type=p.get("type", "string"),
            required=bool(p.get("required", False)),
            default=p.get("default"),
            options=p.get("options"),
        )
        parameters.append(ps)
        default_params[p["name"]] = p.get("default")

    # Infer IO ports from code
    has_df_out = "df_out" in code
    has_html_out = "html_out" in code
    has_df_in = "df_in" in code

    inputs = {"df_in": {"type": "DataFrame"}} if has_df_in else {}
    outputs: dict[str, Any] = {}
    if has_df_out:
        outputs["df_out"] = {"type": "DataFrame"}
    if has_html_out:
        outputs["html_out"] = {"type": "HTML"}
    if not outputs:
        outputs["df_out"] = {"type": "DataFrame"}

    import hashlib
    node_id = "gen_" + hashlib.md5(description.encode()).hexdigest()[:8]

    spec = NodeSpec(
        id=node_id,
        name=node_id,
        label=label,
        category=cat,
        color=color,
        inputs=inputs,
        outputs=outputs,
        parameters=parameters,
        default_params=default_params,
        default_code=code,
        temporary=True,
    )
    return spec, warnings
