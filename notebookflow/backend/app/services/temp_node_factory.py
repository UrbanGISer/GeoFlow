"""Temporary node generation (fallback when library match is weak).

When the catalog-aware planner supplies generated code for a step, that code
is used (after a safety scan). Otherwise we fall back to deterministic
templates so composed workflows always have runnable scaffolding.
"""

from __future__ import annotations

import hashlib
import re

from app.models import NodeSpec, ParameterSpec, PlanStep

# Local-first tool, but AI-generated code should still not touch the system.
_BANNED_PATTERNS: list[tuple[str, str]] = [
    (r"\bsubprocess\b", "subprocess"),
    (r"\bos\.system\b", "os.system"),
    (r"\bos\.remove\b|\bos\.unlink\b|\bos\.rmdir\b", "file deletion"),
    (r"\bshutil\.rmtree\b", "shutil.rmtree"),
    (r"\b__import__\b", "__import__"),
    (r"\beval\s*\(", "eval()"),
    (r"\bexec\s*\(", "exec()"),
    (r"\bsocket\b", "raw sockets"),
    (r"\bpickle\.loads\b", "pickle.loads"),
]


def scan_generated_code(code: str) -> list[str]:
    """Return reasons the code is unsafe; empty list means it passed."""
    findings: list[str] = []
    for pattern, label in _BANNED_PATTERNS:
        if re.search(pattern, code):
            findings.append(label)
    return findings


def build_temp_node_spec(
    step: PlanStep,
    prompt: str,
    index: int,
    warnings: list[str] | None = None,
) -> NodeSpec:
    digest = hashlib.sha1(f"{prompt}:{step.title}:{index}".encode("utf-8")).hexdigest()[:8]
    node_id = f"temp_{index + 1}_{digest}"
    output_html = step.io_type == "df_to_html"

    code: str | None = None
    source = "planner_fallback_template"
    if step.code and step.code.strip():
        findings = scan_generated_code(step.code)
        if findings:
            if warnings is not None:
                warnings.append(
                    f"Step '{step.title}': generated code rejected ({', '.join(findings)}); template used instead."
                )
        else:
            code = step.code.strip() + "\n"
            source = "planner_generated_code"
    if code is None:
        code = _code_template(step, output_html)

    params = dict(step.params) if step.params else {}
    param_specs = [
        ParameterSpec(name=k, type="string", required=False, default=v) for k, v in params.items()
    ]
    if not param_specs:
        param_specs = [ParameterSpec(name="note", type="string", required=False, default=step.intent)]
        params = {"note": step.intent}

    return NodeSpec(
        id=node_id,
        name=node_id,
        label=f"Temp · {step.title}",
        category="Temporary",
        color="#8e24aa",
        inputs={} if step.io_type == "source_to_df" else {"df_in": {"type": "DataFrame"}},
        outputs={"html_out": {"type": "HTML"}} if output_html else {"df_out": {"type": "DataFrame"}},
        parameters=param_specs,
        default_params=params,
        default_code=code,
        temporary=True,
        provenance={"source": source, "step": step.model_dump()},
    )


def _code_template(step: PlanStep, output_html: bool) -> str:
    if output_html:
        if "map" in step.title.lower():
            return (
                "import folium\n"
                "if df_in is None or 'geometry' not in df_in.columns:\n"
                "    raise ValueError('Temp map node expects geometry column in df_in.')\n"
                "gdf = df_in[df_in.geometry.notnull()].copy()\n"
                "if gdf.empty:\n"
                "    raise ValueError('No valid geometry found.')\n"
                "cent = gdf.geometry.to_crs(epsg=4326).centroid\n"
                "m = folium.Map(location=[float(cent.y.mean()), float(cent.x.mean())], zoom_start=5)\n"
                "folium.GeoJson(gdf.__geo_interface__).add_to(m)\n"
                "html_out = m.get_root().render()\n"
            )
        return (
            "import plotly.express as px\n"
            "if df_in is None:\n"
            "    raise ValueError('Temp chart node expects df_in.')\n"
            "col = df_in.columns[0] if len(df_in.columns) else None\n"
            "if not col:\n"
            "    raise ValueError('No columns available to plot.')\n"
            "fig = px.histogram(df_in, x=col)\n"
            "html_out = fig.to_html(include_plotlyjs='cdn')\n"
        )
    if step.io_type == "source_to_df":
        return (
            "import pandas as pd\n"
            "file_path = params.get('file_path')\n"
            "if not file_path:\n"
            "    raise ValueError('Provide file_path for temporary source node.')\n"
            "df_out = pd.read_csv(file_path)\n"
        )
    intent_line = re.sub(r"\s+", " ", step.intent).strip()
    return (
        "if df_in is None:\n"
        "    raise ValueError('Temp transform node expects df_in.')\n"
        f"# {intent_line}\n"
        "df_out = df_in.copy()\n"
    )
