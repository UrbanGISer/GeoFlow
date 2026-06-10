"""Node retrieval utilities (library-first selection)."""

from __future__ import annotations

import re

from app.models import NodeSpec, PlanStep

# Concept -> synonym terms. A side "has" a concept when any of its tokens
# contains the concept key (handles compounds like geofile/geomap) or
# equals one of the synonyms.
_CONCEPTS: dict[str, set[str]] = {
    "read": {"load", "import", "open", "ingest", "source", "reader"},
    "csv": {"table", "tabular", "spreadsheet"},
    "geo": {"geospatial", "spatial", "shapefile", "geojson", "gis", "vector", "crs"},
    "map": {"folium", "choropleth", "basemap", "leaflet"},
    "hist": {"histogram", "distribution", "bins"},
    "group": {"groupby", "aggregate", "aggregation", "summarize", "summary"},
    "filter": {"subset", "where", "select", "query"},
    "join": {"merge", "overlay", "intersect", "union"},
    "buffer": {"distance", "radius"},
}


def _tokens(text: str) -> set[str]:
    toks = {t for t in re.split(r"[^a-z0-9]+", text.lower()) if len(t) > 2}
    # Light plural normalization so "rows" matches "row".
    return {t[:-1] if t.endswith("s") and len(t) > 3 else t for t in toks}


def _concepts(tokens: set[str]) -> set[str]:
    found: set[str] = set()
    for concept, synonyms in _CONCEPTS.items():
        if any(concept in t for t in tokens) or tokens & synonyms:
            found.add(concept)
    return found


def _score(step: PlanStep, spec: NodeSpec) -> float:
    step_tokens = _tokens(f"{step.title} {step.intent}")
    spec_tokens = _tokens(f"{spec.id} {spec.name} {spec.label} {spec.category}")
    step_concepts = _concepts(step_tokens)
    spec_concepts = _concepts(spec_tokens)

    score = 0.0
    if step_concepts:
        score += 0.45 * len(step_concepts & spec_concepts) / len(step_concepts)
    overlap = len(step_tokens & spec_tokens)
    union = len(step_tokens | spec_tokens) or 1
    score += 0.2 * overlap / union

    # IO-contract compatibility.
    has_df_in = "df_in" in spec.inputs
    has_df_out = "df_out" in spec.outputs
    has_html_out = "html_out" in spec.outputs
    if step.io_type == "source_to_df" and not spec.inputs and has_df_out:
        score += 0.3
    elif step.io_type == "df_to_df" and has_df_in and has_df_out:
        score += 0.3
    elif step.io_type == "df_to_html" and has_df_in and has_html_out:
        score += 0.3
    elif step.io_type == "df_to_html" and has_html_out:
        score += 0.15
    else:
        score -= 0.2  # IO mismatch should disqualify near-ties

    return max(0.0, min(score, 1.0))


def retrieve_best(step: PlanStep, specs: list[NodeSpec]) -> tuple[NodeSpec | None, float]:
    best: NodeSpec | None = None
    best_score = -1.0
    for spec in specs:
        if spec.temporary:
            continue  # never recycle old one-off temp nodes into new plans
        sc = _score(step, spec)
        if sc > best_score:
            best_score = sc
            best = spec
    return best, max(best_score, 0.0)
