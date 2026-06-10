"""Convert structured GIS article snippets into candidate node specs."""

from __future__ import annotations

import re

from app.models import GISArticleInput, NodeSpec


def _slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", text.strip().lower()).strip("_")
    return s or "gis_node"


def ingest_articles_to_specs(articles: list[GISArticleInput]) -> list[NodeSpec]:
    specs: list[NodeSpec] = []
    for idx, a in enumerate(articles):
        sid = f"gis_{idx + 1}_{_slug(a.title)[:24]}"
        io_out_html = any("html" in o.lower() or "map" in o.lower() for o in a.outputs)
        inputs = {} if any("file" in i.lower() for i in a.inputs) else {"df_in": {"type": "DataFrame"}}
        outputs = {"html_out": {"type": "HTML"}} if io_out_html else {"df_out": {"type": "DataFrame"}}
        code = (
            "# Generated from GIS article ingestion\n"
            f"# Method: {a.method}\n"
            "df_out = df_in.copy() if df_in is not None else None\n"
        )
        if io_out_html:
            code = (
                "# Generated from GIS article ingestion\n"
                f"# Method: {a.method}\n"
                "html_out = '<html><body><h3>GIS method placeholder</h3></body></html>'\n"
            )
        specs.append(
            NodeSpec(
                id=sid,
                name=sid,
                label=a.title[:60],
                category="GIS Research",
                color="#26a69a",
                inputs=inputs,
                outputs=outputs,
                parameters=[],
                default_params=dict(a.example_params),
                default_code=code,
                temporary=False,
                provenance={
                    "source": "gis_article",
                    "method": a.method,
                    "pseudo_steps": a.pseudo_steps,
                },
            )
        )
    return specs
