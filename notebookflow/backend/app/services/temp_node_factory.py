"""Temporary node generation (fallback when library match is weak)."""

from __future__ import annotations

import hashlib
import re

from app.models import NodeSpec, PlanStep


def build_temp_node_spec(step: PlanStep, prompt: str, index: int) -> NodeSpec:
    digest = hashlib.sha1(f"{prompt}:{step.title}:{index}".encode("utf-8")).hexdigest()[:8]
    node_id = f"temp_{index + 1}_{digest}"
    output_html = step.io_type == "df_to_html"
    code = _code_template(step, output_html)
    return NodeSpec(
        id=node_id,
        name=node_id,
        label=f"Temp · {step.title}",
        category="Temporary",
        color="#8e24aa",
        inputs={} if step.io_type == "source_to_df" else {"df_in": {"type": "DataFrame"}},
        outputs={"html_out": {"type": "HTML"}} if output_html else {"df_out": {"type": "DataFrame"}},
        parameters=[{"name": "note", "type": "string", "required": False, "default": step.intent}],  # type: ignore[list-item]
        default_params={"note": step.intent},
        default_code=code,
        temporary=True,
        provenance={"source": "planner_fallback", "step": step.model_dump()},
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
    return (
        "if df_in is None:\n"
        "    raise ValueError('Temp transform node expects df_in.')\n"
        f"# {re.sub(r'\\s+', ' ', step.intent).strip()}\n"
        "df_out = df_in.copy()\n"
    )
