"""Node specifications — builtin library for NotebookFlow.

Categories
----------
Input        : data readers
Transform    : tabular operations
GIS          : geospatial operations (geopandas)
Visualization: interactive charts (plotly / folium)
Nature View  : publication-quality static figures (matplotlib + seaborn)
Python Script: open-ended user code templates
"""

from __future__ import annotations

from app.models import NodeSpec, ParameterSpec

# ─── helpers ──────────────────────────────────────────────────────────────────

_PALETTE_OPTIONS = ["colorblind", "Set2", "Set1", "tab10", "muted", "pastel", "deep", "bright"]
_NATURE_PALETTES = ["colorblind", "Set2", "tab10", "muted", "pastel"]


def _ps(name: str, type_: str, required: bool = False, default=None, options=None) -> ParameterSpec:
    return ParameterSpec(name=name, type=type_, required=required, default=default, options=options)


# ─── Input ────────────────────────────────────────────────────────────────────

READ_CSV_CODE = """\
import pandas as pd
df_out = pd.read_csv(
    params["file_path"],
    sep=params.get("delimiter", ","),
    encoding=params.get("encoding", "utf-8"),
)
"""

READ_EXCEL_CODE = """\
import pandas as pd
file_path = params.get("file_path")
if not file_path:
    raise ValueError("Provide file_path.")
sheet = params.get("sheet", 0)
try:
    sheet = int(sheet)
except (TypeError, ValueError):
    pass
df_out = pd.read_excel(file_path, sheet_name=sheet)
"""

READ_JSON_CODE = """\
import pathlib, pandas as pd
file_path = params.get("file_path")
if not file_path:
    raise ValueError("Provide file_path.")
ext = pathlib.Path(file_path).suffix.lower()
if ext in (".geojson", ".json"):
    try:
        import geopandas as gpd
        df_out = gpd.read_file(file_path)
    except Exception:
        df_out = pd.read_json(file_path)
else:
    df_out = pd.read_json(file_path)
"""

READ_PARQUET_CODE = """\
import pandas as pd
file_path = params.get("file_path")
if not file_path:
    raise ValueError("Provide file_path.")
df_out = pd.read_parquet(file_path)
"""

GEOFILE_READER_CODE = """\
import os, geopandas as gpd
file_path = params.get("file_path")
if not file_path:
    raise ValueError("Provide file_path.")
os.environ["SHAPE_RESTORE_SHX"] = "YES"
layer = params.get("layer")
df_out = gpd.read_file(file_path, layer=layer) if layer else gpd.read_file(file_path)
"""

# ─── Transform ────────────────────────────────────────────────────────────────

COLUMN_FILTER_CODE = """\
columns = params.get("columns", [])
if not columns:
    raise ValueError("Select at least one column.")
df_out = df_in[columns].copy()
"""

ROW_FILTER_CODE = """\
column = params.get("column")
operator = params.get("operator", ">")
value = params.get("value")
if column is None:
    raise ValueError("Select a column.")
series = df_in[column]
try:
    value_cast = float(value)
except Exception:
    value_cast = value
ops = {
    ">": lambda s, v: s > v,
    ">=": lambda s, v: s >= v,
    "<": lambda s, v: s < v,
    "<=": lambda s, v: s <= v,
    "==": lambda s, v: s == v,
    "!=": lambda s, v: s != v,
    "contains": lambda s, v: s.astype(str).str.contains(str(v), na=False),
}
if operator not in ops:
    raise ValueError(f"Unsupported operator: {operator}")
df_out = df_in[ops[operator](series, value_cast)].copy()
"""

GROUPBY_CODE = """\
group_by = params.get("group_by")
target = params.get("target_column")
agg = params.get("aggregation", "max")
if group_by is None:
    raise ValueError("Select group_by column.")
if target is None:
    raise ValueError("Select target_column.")
df_out = df_in.groupby(group_by)[target].agg(agg).reset_index()
"""

SORT_CODE = """\
col = params.get("column")
if col is None:
    raise ValueError("Select a column to sort by.")
ascending = params.get("ascending", "true")
asc = str(ascending).lower() not in ("false", "0", "no")
df_out = df_in.sort_values(col, ascending=asc).reset_index(drop=True)
"""

JOIN_CODE = """\
left_on = params.get("left_on")
right_on = params.get("right_on") or left_on
how = params.get("how", "inner")
right_file_path = params.get("right_file_path")
left_cols = params.get("left_columns") or []
right_cols = params.get("right_columns") or []

if df_in_2 is None or df_in_2.empty:
    if not right_file_path:
        raise ValueError("Connect a right table or set right_file_path.")
    import pandas as _pd
    df_right = _pd.read_csv(right_file_path)
else:
    df_right = df_in_2

if not left_on:
    raise ValueError("Select a left join key column.")

df_left = df_in.copy()
if left_cols:
    keep_left = list({left_on} | set(left_cols))
    df_left = df_left[[c for c in keep_left if c in df_left.columns]]

df_right = df_right.copy()
if right_cols:
    keep_right = list({right_on} | set(right_cols))
    df_right = df_right[[c for c in keep_right if c in df_right.columns]]

df_out = df_left.merge(df_right, left_on=left_on, right_on=right_on, how=how)
"""

RENAME_CODE = """\
import json
raw = params.get("rename_map", "{}")
try:
    rename_map = json.loads(raw) if isinstance(raw, str) else dict(raw)
except Exception as e:
    raise ValueError(f"rename_map must be valid JSON object, e.g. {{\\\"old\\\": \\\"new\\\"}}: {e}")
df_out = df_in.rename(columns=rename_map)
"""

FORMULA_COLUMN_CODE = """\
col_name = params.get("new_column", "result")
expr = params.get("expression", "")
if not expr:
    raise ValueError("Provide an expression, e.g. col_a + col_b * 2")
df_out = df_in.copy()
df_out[col_name] = df_in.eval(expr)
"""

STATISTICS_CODE = """\
df_out = df_in.describe(include="all").reset_index().rename(columns={"index": "statistic"})
"""

DROP_DUPLICATES_CODE = """\
subset_raw = params.get("subset", "")
keep = params.get("keep", "first")
subset = [c.strip() for c in subset_raw.split(",") if c.strip()] if subset_raw else None
df_out = df_in.drop_duplicates(subset=subset, keep=keep).reset_index(drop=True)
"""

# ─── GIS ──────────────────────────────────────────────────────────────────────

GEO_BUFFER_CODE = """\
import geopandas as gpd
if df_in is None or "geometry" not in df_in.columns:
    raise ValueError("Requires a GeoDataFrame with geometry column.")
distance = float(params.get("distance", 100))
gdf = df_in.copy()
if gdf.crs and gdf.crs.is_geographic:
    gdf = gdf.to_crs(epsg=3857)
    gdf["geometry"] = gdf.geometry.buffer(distance)
    df_out = gdf.to_crs(df_in.crs)
else:
    gdf["geometry"] = gdf.geometry.buffer(distance)
    df_out = gdf
"""

GEO_DISSOLVE_CODE = """\
by_col = params.get("by_column", "")
agg_col = params.get("agg_column", "")
agg_func = params.get("agg_func", "first")
kwargs = {agg_col: agg_func} if agg_col else {}
if by_col:
    df_out = df_in.dissolve(by=by_col, aggfunc=kwargs or "first").reset_index()
else:
    df_out = df_in.dissolve(aggfunc=kwargs or "first").reset_index()
"""

GEO_SJOIN_CODE = """\
import geopandas as gpd
how = params.get("how", "left")
predicate = params.get("predicate", "intersects")
if df_in_2 is not None:
    gdf_right = df_in_2
else:
    right_path = params.get("right_file_path")
    if not right_path:
        raise ValueError("Connect a second input layer (right port) or set right_file_path.")
    gdf_right = gpd.read_file(right_path)
if not isinstance(gdf_right, gpd.GeoDataFrame):
    raise ValueError("Second input must be a GeoDataFrame (use GeoFile Reader).")
if df_in.crs and gdf_right.crs and df_in.crs != gdf_right.crs:
    gdf_right = gdf_right.to_crs(df_in.crs)
df_out = gpd.sjoin(df_in, gdf_right, how=how, predicate=predicate)
"""

GEO_CRS_CODE = """\
target = params.get("target_crs", "EPSG:4326")
df_out = df_in.to_crs(target)
"""

GEO_CENTROID_CODE = """\
df_out = df_in.copy()
df_out["geometry"] = df_in.geometry.centroid
"""

GEO_AREA_LENGTH_CODE = """\
mode = params.get("mode", "area")
gdf = df_in.copy()
if gdf.crs and gdf.crs.is_geographic:
    gdf = gdf.to_crs(epsg=3857)
if mode == "area":
    gdf["area_m2"] = gdf.geometry.area
    if df_in.crs and df_in.crs.is_geographic:
        gdf = gdf.to_crs(df_in.crs)
    df_out = gdf
elif mode == "length":
    gdf["length_m"] = gdf.geometry.length
    if df_in.crs and df_in.crs.is_geographic:
        gdf = gdf.to_crs(df_in.crs)
    df_out = gdf
else:
    raise ValueError("mode must be 'area' or 'length'.")
"""

GEO_CONVEX_HULL_CODE = """\
df_out = df_in.copy()
df_out["geometry"] = df_in.geometry.convex_hull
"""

GEO_CLIP_CODE = """\
import geopandas as gpd
mask_path = params.get("mask_file_path")
if not mask_path:
    raise ValueError("Provide mask_file_path (clip boundary GeoFile).")
mask = gpd.read_file(mask_path)
df_out = gpd.clip(df_in, mask)
"""

GEOMAP_CODE = """\
import folium
tiles = params.get("tiles", "OpenStreetMap")
zoom_start = int(params.get("zoom_start", 4))
layer_colors = ["#1976d2", "#e53935", "#2e7d32", "#f9a825", "#8e24aa",
                "#00838f", "#6d4c41", "#c2185b"]
layers = []
for i, gdf in enumerate(df_ins):
    if gdf is None:
        continue
    if "geometry" not in gdf.columns:
        raise ValueError(f"Input {i + 1} does not contain a geometry column.")
    layer = gdf[gdf.geometry.notnull()].copy()
    if layer.empty:
        continue
    layers.append((i, layer))
if not layers:
    raise ValueError("GeoMap requires at least one connected GeoDataFrame input.")
first = layers[0][1]
centroid = first.geometry.to_crs(epsg=4326).centroid
m = folium.Map(location=[float(centroid.y.mean()), float(centroid.x.mean())],
               zoom_start=zoom_start, tiles=tiles)
# Inputs are drawn bottom-to-top: port 1 is the bottom layer.
for i, layer in layers:
    color = layer_colors[i % len(layer_colors)]
    folium.GeoJson(
        layer.to_crs(epsg=4326).__geo_interface__ if layer.crs else layer.__geo_interface__,
        name=f"Layer {i + 1}",
        style_function=lambda _f, c=color: {
            "color": c, "fillColor": c, "weight": 2, "fillOpacity": 0.35,
        },
    ).add_to(m)
folium.LayerControl().add_to(m)
html_out = m.get_root().render()
"""

GEO_VIEW_CODE = """\
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import to_rgba
from matplotlib.patches import Patch
from matplotlib.lines import Line2D
import pandas as pd

title = params.get("title", "")
dpi = int(params.get("dpi", 200))
axis_off = bool(params.get("axis_off", True))
fig_w = float(params.get("fig_width", 10) or 10)
fig_h = float(params.get("fig_height", 8) or 8)
layer_styles = params.get("layers") or []
basemap = params.get("basemap", "none") or "none"
basemap_alpha = float(params.get("basemap_alpha", 0.5) or 0.5)

_BASEMAP_SOURCES = {
    "osm":            "OpenStreetMap.Mapnik",
    "satellite":      "Esri.WorldImagery",
    "topo":           "OpenTopoMap",
    "cartodb_light":  "CartoDB.Positron",
    "cartodb_dark":   "CartoDB.DarkMatter",
    "stamen_terrain": "Stadia.StamenTerrain",
    "stamen_toner":   "Stadia.StamenToner",
}

legend_show = bool(params.get("legend_show", True))
legend_loc = params.get("legend_loc", "best") or "best"
legend_fontsize = float(params.get("legend_fontsize", 10) or 10)
legend_frame = bool(params.get("legend_frame", True))
_bbox_raw = str(params.get("legend_bbox") or "").strip()
legend_bbox = None
if _bbox_raw:
    parts = [float(x) for x in _bbox_raw.replace(";", ",").split(",") if x.strip()]
    if len(parts) == 2:
        legend_bbox = tuple(parts)

default_colors = ["#1976d2", "#e53935", "#2e7d32", "#f9a825", "#8e24aa",
                  "#00838f", "#6d4c41", "#c2185b"]

layers = []
crs = None
for i, gdf in enumerate(df_ins):
    if gdf is None:
        continue
    if "geometry" not in gdf.columns:
        raise ValueError(f"Input {i + 1} does not contain a geometry column.")
    layer = gdf[gdf.geometry.notnull()].copy()
    if layer.empty:
        continue
    if crs is None and layer.crs is not None:
        crs = layer.crs
    elif crs is not None and layer.crs is not None and layer.crs != crs:
        layer = layer.to_crs(crs)
    layers.append((i, layer))
if not layers:
    raise ValueError("GeoView requires at least one connected GeoDataFrame input.")

fig = plt.figure(figsize=(fig_w, fig_h), dpi=dpi)
ax = fig.add_subplot(111)

legend_kwds = {"loc": legend_loc, "fontsize": legend_fontsize, "frameon": legend_frame}
if legend_bbox:
    legend_kwds["bbox_to_anchor"] = legend_bbox

manual_handles = []
has_column_legend = False
# Inputs are drawn bottom-to-top: port 1 is the bottom layer.
for i, layer in layers:
    st = layer_styles[i] if i < len(layer_styles) and isinstance(layer_styles[i], dict) else {}
    label = st.get("label") or f"Layer {i + 1}"
    col = st.get("column") or None
    mode = st.get("mode", "auto")
    cmap = st.get("cmap", "viridis")
    fill = st.get("fill_color") or default_colors[i % len(default_colors)]
    fill_alpha = float(st.get("fill_alpha", 0.75))
    edge_color = st.get("edge_color", "#333333")
    edge_width = float(st.get("edge_width", 0.4))
    edge_alpha = float(st.get("edge_alpha", 1.0))
    marker_size = float(st.get("marker_size", 20))

    geom_types = set(layer.geometry.geom_type.dropna().unique())
    is_point = geom_types <= {"Point", "MultiPoint"}
    is_line = geom_types <= {"LineString", "MultiLineString"}

    kw = {"ax": ax, "edgecolor": to_rgba(edge_color, edge_alpha), "linewidth": edge_width}
    if is_point:
        kw["markersize"] = marker_size

    if col and col in layer.columns:
        # Schemes that accept a k (number-of-classes) parameter
        _schemes_with_k = {
            "EqualInterval", "FisherJenks", "FisherJenksSampled",
            "JenksCaspall", "JenksCaspallForced", "JenksCaspallSampled",
            "MaximumBreaks", "NaturalBreaks", "Quantiles", "StdMean",
        }
        is_numeric = pd.api.types.is_numeric_dtype(layer[col])
        scheme_raw = st.get("scheme") or None
        k = int(st.get("k", 5) or 5)

        if not is_numeric:
            # String / categorical column — always use categorical legend
            layer.plot(column=col, cmap=cmap, categorical=True,
                       legend=legend_show, alpha=fill_alpha,
                       legend_kwds=legend_kwds if legend_show else {},
                       **kw)
        elif mode == "continuous":
            # Smooth colorbar — no classification
            layer.plot(column=col, cmap=cmap,
                       legend=legend_show, alpha=fill_alpha,
                       legend_kwds={"shrink": 0.6, "label": col} if legend_show else {},
                       **kw)
        else:
            # class mode (or auto with numeric column) → mapclassify
            scheme = scheme_raw or "NaturalBreaks"
            cls_kw = {"k": k} if scheme in _schemes_with_k else {}
            layer.plot(column=col, cmap=cmap, scheme=scheme,
                       legend=legend_show, alpha=fill_alpha,
                       legend_kwds=legend_kwds if legend_show else {},
                       classification_kwds=cls_kw,
                       **kw)
        if legend_show:
            has_column_legend = True
    else:
        if is_line:
            layer.plot(color=to_rgba(fill, fill_alpha), linewidth=max(edge_width, 0.8),
                       ax=ax)
            manual_handles.append(Line2D([0], [0], color=to_rgba(fill, fill_alpha),
                                         lw=max(edge_width, 0.8), label=label))
        else:
            layer.plot(color=to_rgba(fill, fill_alpha), **kw)
            if is_point:
                manual_handles.append(Line2D([0], [0], marker="o", linestyle="",
                                             markerfacecolor=to_rgba(fill, fill_alpha),
                                             markeredgecolor=to_rgba(edge_color, edge_alpha),
                                             markersize=8, label=label))
            else:
                manual_handles.append(Patch(facecolor=to_rgba(fill, fill_alpha),
                                            edgecolor=to_rgba(edge_color, edge_alpha),
                                            linewidth=edge_width, label=label))

# A column-driven legend (geopandas) takes priority; otherwise build one
# from the plain layers' handles.
if legend_show and manual_handles and not has_column_legend:
    ax.legend(handles=manual_handles, **legend_kwds)

# Basemap via contextily (tiles must be fetched in Web Mercator)
if basemap != "none":
    try:
        import contextily as cx
        src_name = _BASEMAP_SOURCES.get(basemap, "OpenStreetMap.Mapnik")
        # Split "Provider.Style" → cx.providers.Provider.Style
        _parts = src_name.split(".", 1)
        provider = getattr(getattr(cx.providers, _parts[0]), _parts[1]) if len(_parts) == 2 else getattr(cx.providers, src_name)
        cx.add_basemap(ax, source=provider, alpha=basemap_alpha,
                       crs=(crs.to_string() if crs else "EPSG:4326"),
                       reset_extent=False)
    except Exception as _bme:
        ax.set_title(f"[basemap error: {_bme}]", fontsize=9, color="red", loc="right")

if axis_off:
    ax.set_axis_off()
if title:
    ax.set_title(title, fontsize=13, fontweight="bold")
plt.tight_layout()

import io, base64

buf = io.BytesIO()
fig.savefig(buf, format="png", bbox_inches="tight", dpi=dpi)
plt.close(fig)

img_out = buf.getvalue()
html_out = ('<img src="data:image/png;base64,' +
            base64.b64encode(buf.getvalue()).decode() +
            '" style="max-width:100%;height:auto;" />')
"""

# ─── Visualization (Plotly) ───────────────────────────────────────────────────

HISTOGRAM_CODE = """\
import plotly.express as px
column = params.get("column")
bins = int(params.get("bins", 30))
if column is None:
    raise ValueError("Select a column.")
fig = px.histogram(df_in, x=column, nbins=bins)
html_out = fig.to_html(include_plotlyjs="cdn")
"""

SCATTER_CODE = """\
import plotly.express as px
x_col = params.get("x_column")
y_col = params.get("y_column")
color_col = params.get("color_column") or None
if not x_col or not y_col:
    raise ValueError("Select x_column and y_column.")
fig = px.scatter(df_in, x=x_col, y=y_col, color=color_col)
html_out = fig.to_html(include_plotlyjs="cdn")
"""

BAR_CHART_CODE = """\
import plotly.express as px
x_col = params.get("x_column")
y_col = params.get("y_column")
color_col = params.get("color_column") or None
if not x_col or not y_col:
    raise ValueError("Select x_column and y_column.")
fig = px.bar(df_in, x=x_col, y=y_col, color=color_col)
html_out = fig.to_html(include_plotlyjs="cdn")
"""

LINE_CHART_CODE = """\
import plotly.express as px
x_col = params.get("x_column")
y_col = params.get("y_column")
color_col = params.get("color_column") or None
if not x_col or not y_col:
    raise ValueError("Select x_column and y_column.")
fig = px.line(df_in, x=x_col, y=y_col, color=color_col)
html_out = fig.to_html(include_plotlyjs="cdn")
"""

# ─── Nature View (matplotlib + seaborn) ──────────────────────────────────────
# These produce publication-quality static figures embedded as base64 PNG.

def _nature_img_footer() -> str:
    """Shared tail: save figure → base64 PNG → HTML img tag."""
    return """\
import io, base64
buf = io.BytesIO()
fig.savefig(buf, format="png", bbox_inches="tight", dpi=150)
plt.close(fig)
img_out = buf.getvalue()
html_out = ('<img src="data:image/png;base64,' +
            base64.b64encode(buf.getvalue()).decode() +
            '" style="max-width:100%;height:auto;" />')
"""


NATURE_BOXPLOT_CODE = """\
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
y_col = params.get("y_column")
x_col = params.get("x_column") or None
palette = params.get("palette", "colorblind")
title = params.get("title", "")
if not y_col:
    raise ValueError("Select y_column.")
sns.set_theme(style="ticks", font_scale=1.0)
fig, ax = plt.subplots(figsize=(6, 4))
sns.boxplot(data=df_in, x=x_col, y=y_col, palette=palette, ax=ax, linewidth=1.2)
sns.despine()
ax.set_xlabel(x_col or "", fontsize=10)
ax.set_ylabel(y_col, fontsize=10)
if title:
    ax.set_title(title, fontsize=11, fontweight="bold")
plt.tight_layout()
import io, base64
buf = io.BytesIO()
fig.savefig(buf, format="png", bbox_inches="tight", dpi=150)
plt.close(fig)
img_out = buf.getvalue()
html_out = ('<img src="data:image/png;base64,' +
            base64.b64encode(buf.getvalue()).decode() +
            '" style="max-width:100%;height:auto;" />')
"""

NATURE_VIOLIN_CODE = """\
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
y_col = params.get("y_column")
x_col = params.get("x_column") or None
palette = params.get("palette", "colorblind")
title = params.get("title", "")
if not y_col:
    raise ValueError("Select y_column.")
sns.set_theme(style="ticks", font_scale=1.0)
fig, ax = plt.subplots(figsize=(6, 4))
sns.violinplot(data=df_in, x=x_col, y=y_col, palette=palette, ax=ax, linewidth=1.0)
sns.despine()
ax.set_xlabel(x_col or "", fontsize=10)
ax.set_ylabel(y_col, fontsize=10)
if title:
    ax.set_title(title, fontsize=11, fontweight="bold")
plt.tight_layout()
import io, base64
buf = io.BytesIO()
fig.savefig(buf, format="png", bbox_inches="tight", dpi=150)
plt.close(fig)
img_out = buf.getvalue()
html_out = ('<img src="data:image/png;base64,' +
            base64.b64encode(buf.getvalue()).decode() +
            '" style="max-width:100%;height:auto;" />')
"""

NATURE_HEATMAP_CODE = """\
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
x_col = params.get("x_column") or None
y_col = params.get("y_column") or None
value_col = params.get("value_column") or None
cmap = params.get("palette", "coolwarm")
title = params.get("title", "")
sns.set_theme(style="white")
if x_col and y_col and value_col:
    pivot = df_in.pivot_table(index=y_col, columns=x_col, values=value_col, aggfunc="mean")
else:
    numeric = df_in.select_dtypes(include="number")
    if numeric.empty:
        raise ValueError("No numeric columns found for correlation heatmap.")
    pivot = numeric.corr()
fig, ax = plt.subplots(figsize=(max(5, len(pivot.columns) * 0.6 + 2),
                                max(4, len(pivot) * 0.5 + 1.5)))
annot = len(pivot) <= 20
sns.heatmap(pivot, cmap=cmap, ax=ax, annot=annot, fmt=".2f", linewidths=0.4)
if title:
    ax.set_title(title, fontsize=11, fontweight="bold")
plt.tight_layout()
import io, base64
buf = io.BytesIO()
fig.savefig(buf, format="png", bbox_inches="tight", dpi=150)
plt.close(fig)
img_out = buf.getvalue()
html_out = ('<img src="data:image/png;base64,' +
            base64.b64encode(buf.getvalue()).decode() +
            '" style="max-width:100%;height:auto;" />')
"""

NATURE_RIDGEPLOT_CODE = """\
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
group_col = params.get("group_column")
value_col = params.get("value_column")
palette = params.get("palette", "Set2")
title = params.get("title", "Ridge Plot")
if not group_col or not value_col:
    raise ValueError("Select group_column and value_column.")
groups = list(df_in[group_col].dropna().unique())
n = len(groups)
if n == 0:
    raise ValueError("No groups found.")
colors = sns.color_palette(palette, n)
fig, axes = plt.subplots(n, 1, figsize=(7, max(3, n * 0.9 + 1)),
                         dpi=150, sharex=True)
if n == 1:
    axes = [axes]
for i, (grp, ax) in enumerate(zip(groups, axes)):
    data = df_in[df_in[group_col] == grp][value_col].dropna()
    if len(data) >= 2:
        sns.kdeplot(data, ax=ax, fill=True, alpha=0.65,
                    color=colors[i], linewidth=1.4)
    ax.yaxis.set_visible(False)
    ax.set_ylabel(str(grp), rotation=0, labelpad=50, ha="right", fontsize=8)
    sns.despine(ax=ax, left=True)
axes[-1].set_xlabel(value_col, fontsize=9)
if title:
    fig.suptitle(title, fontsize=10, y=1.01)
plt.tight_layout()
import io, base64
buf = io.BytesIO()
fig.savefig(buf, format="png", bbox_inches="tight", dpi=150)
plt.close(fig)
img_out = buf.getvalue()
html_out = ('<img src="data:image/png;base64,' +
            base64.b64encode(buf.getvalue()).decode() +
            '" style="max-width:100%;height:auto;" />')
"""

# ─── Image Nodes ─────────────────────────────────────────────────────────────

IMAGE_EXPORTER_CODE = """\
import shutil, pathlib
if img_in_path is None:
    raise ValueError("Connect an image source to the img_in port.")
save_path = params.get("save_path", "")
if not save_path:
    raise ValueError("Specify save_path in parameters.")
dest = pathlib.Path(save_path)
if dest.suffix.lower() not in (".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"):
    dest = dest.with_suffix(".png")
dest.parent.mkdir(parents=True, exist_ok=True)
src = pathlib.Path(img_in_path)
try:
    from PIL import Image as _PILImage
    fmt_map = {".jpg": "JPEG", ".jpeg": "JPEG", ".tiff": "TIFF", ".tif": "TIFF", ".bmp": "BMP"}
    out_fmt = fmt_map.get(dest.suffix.lower())
    if out_fmt:
        quality = int(params.get("quality", 90) or 90)
        with _PILImage.open(str(src)) as _im:
            _im_rgb = _im.convert("RGB") if out_fmt == "JPEG" else _im
            _im_rgb.save(str(dest), format=out_fmt, quality=quality if out_fmt == "JPEG" else None)
    else:
        shutil.copy2(str(src), str(dest))
except ImportError:
    shutil.copy2(str(src), str(dest))
html_out = (
    '<div style="font-family:monospace;padding:10px 14px;background:#f5f5f5;'
    'border-radius:6px;font-size:13px;">'
    '<span style="color:#2e7d32;">✓</span> Saved to<br>'
    f'<strong style="word-break:break-all;">{dest}</strong></div>'
)
"""

REPORT_BUILDER_CODE = """\
import base64 as _b64mod, pathlib as _plmod
from html import escape as _hesc

_title = str(params.get("title", "Report"))
_accent = str(params.get("accent_color", "#1976d2"))
_sections = params.get("sections") or []

# Build port→path lookup (avoid comprehensions: exec two-dict scope issue)
_raw_paths = []
if img_in_path:
    _raw_paths.append(img_in_path)
if img_ins_paths:
    for _xp in img_ins_paths:
        if _xp not in _raw_paths:
            _raw_paths.append(_xp)
_port_map = {}
for _xi in range(len(_raw_paths)):
    _port_map[_xi + 1] = _raw_paths[_xi]

# ─── NO def blocks below — all inline (exec two-dict scope prevents closures) ───
_rows_html = ""
for _sec in _sections:
    _cols = _sec.get("columns") or []
    if not _cols:
        continue
    _nc = len(_cols)
    _pct = str(100 // _nc)
    _gap = str(int(_sec.get("gap", 0)))
    _sbg = _sec.get("bg", "")
    _sst = ("background:" + _sbg + ";" if _sbg else "")
    _tds = ""
    for _cell in _cols:
        _ct = _cell.get("type", "text")
        _cbg = _cell.get("bg", "")
        _cpad = str(int(_cell.get("padding", 12)))
        _bs = "padding:" + _cpad + "px;" + ("background:" + _cbg + ";" if _cbg else "") + "width:100%;box-sizing:border-box;height:100%;"
        if _ct == "heading":
            _tx = _hesc(str(_cell.get("content", "")))
            _fs = str(int(_cell.get("fontSize", 18)))
            _fc = str(_cell.get("fontColor", "#222"))
            _ta = str(_cell.get("textAlign", "left"))
            _ds = ("border-bottom:2px solid " + _accent + ";padding-bottom:6px;margin-bottom:4px;" if _cell.get("showDivider", True) else "")
            _ch = '<div style="' + _bs + '"><h2 style="' + _ds + 'font-size:' + _fs + 'px;color:' + _fc + ';text-align:' + _ta + ';margin:0;font-weight:bold;">' + _tx + '</h2></div>'
        elif _ct == "image":
            _port = int(_cell.get("imgPort", 1))
            _ipath = _port_map.get(_port)
            _cap = _hesc(str(_cell.get("caption", "")))
            _fit = str(_cell.get("fit", "contain"))
            if _ipath and _plmod.Path(_ipath).exists():
                _imgraw = _plmod.Path(_ipath).read_bytes()
                _b64v = _b64mod.b64encode(_imgraw).decode()
                _caph = ('<p style="font-size:11px;color:#666;text-align:center;margin:6px 0 0;">' + _cap + '</p>' if _cap else "")
                _ch = '<div style="' + _bs + 'text-align:center;"><img src="data:image/png;base64,' + _b64v + '" style="max-width:100%;height:auto;object-fit:' + _fit + ';" />' + _caph + '</div>'
            else:
                _ch = '<div style="' + _bs + 'background:#f0f0f0;min-height:100px;display:flex;align-items:center;justify-content:center;color:#999;font-size:12px;">img_in_' + str(_port) + ' not connected</div>'
        else:
            _rt = str(_cell.get("content", ""))
            _fs = str(int(_cell.get("fontSize", 13)))
            _fc = str(_cell.get("fontColor", "#333"))
            _ta = str(_cell.get("textAlign", "left"))
            _lh = str(_cell.get("lineHeight", 1.6))
            _et = _hesc(_rt).replace("\\n", "<br>")
            _ch = '<div style="' + _bs + 'font-size:' + _fs + 'px;color:' + _fc + ';text-align:' + _ta + ';line-height:' + _lh + ';">' + _et + '</div>'
        _tds += '<td style="vertical-align:top;width:' + _pct + '%;padding-right:' + _gap + 'px;">' + _ch + '</td>'
    _rows_html += '<tr style="' + _sst + '">' + _tds + '</tr>'

html_out = (
    '<div style="font-family:sans-serif;max-width:960px;margin:0 auto;padding:28px;background:#fff;">'
    '<h1 style="font-size:22px;font-weight:bold;color:#111;border-bottom:3px solid ' + _accent + ';padding-bottom:10px;margin:0 0 20px;">'
    + _hesc(_title) +
    '</h1>'
    '<table style="border-collapse:collapse;width:100%;">' + _rows_html + '</table>'
    '</div>'
)
"""

LLM_VISION_CODE = """\
import base64, pathlib
try:
    from openai import OpenAI as _OpenAI
except ImportError:
    raise ImportError("openai package is required: pip install openai")

if img_in_path is None:
    raise ValueError("Connect an image source to the img_in port.")
if not pathlib.Path(img_in_path).exists():
    raise FileNotFoundError(f"Image artifact not found: {img_in_path} — run the upstream visualization node first.")

prompt = params.get("prompt", "Describe what you see in this image in detail.")
base_url = params.get("base_url", "https://generativelanguage.googleapis.com/v1beta/openai/")
api_key = params.get("api_key", "")
model = params.get("model", "gemini-2.5-flash")
if not api_key:
    raise ValueError("Set api_key in LLM Vision node parameters (or use the AI Studio tab key).")

img_bytes = pathlib.Path(img_in_path).read_bytes()
b64 = base64.b64encode(img_bytes).decode()

_client = _OpenAI(base_url=base_url, api_key=api_key)
_resp = _client.chat.completions.create(
    model=model,
    messages=[{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            {"type": "text", "text": prompt},
        ],
    }],
    max_tokens=2048,
)
_analysis = _resp.choices[0].message.content or ""

import html as _html_mod
html_out = (
    '<div style="font-family:sans-serif;padding:16px;max-width:800px;">'
    '<h3 style="font-size:14px;font-weight:bold;color:#444;margin:0 0 10px;">LLM Vision Analysis</h3>'
    '<div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:6px;padding:12px;'
    'font-size:13px;line-height:1.65;white-space:pre-wrap;">'
    + _html_mod.escape(_analysis) +
    '</div>'
    f'<p style="font-size:11px;color:#aaa;margin-top:8px;">Model: {model}</p>'
    '</div>'
)
"""

# ─── Python Script ────────────────────────────────────────────────────────────

PYTHON_SCRIPT_DATA_CODE = """\
# Python Script node — data output
# Inputs: df_in (DataFrame or None), params (dict)
# Set df_out to produce output for downstream nodes.
if df_in is None:
    raise ValueError("Connect an upstream node or remove this node from the chain.")
df_out = df_in.copy()
# --- write your transformation below ---
"""

PYTHON_SCRIPT_HTML_CODE = """\
# Python Script node — HTML/figure output
# Inputs: df_in (DataFrame or None), params (dict)
# Set html_out to produce a rendered output (plotly, folium, matplotlib, etc.)
import plotly.express as px
if df_in is None:
    raise ValueError("Connect an upstream data node.")
col = df_in.columns[0]
fig = px.histogram(df_in, x=col, title=f"Distribution of {col}")
html_out = fig.to_html(include_plotlyjs="cdn")
# --- replace above with your visualization code ---
"""

# ─── Spec registry ────────────────────────────────────────────────────────────

NODE_SPECS: list[NodeSpec] = [
    # ── Input ─────────────────────────────────────────────────────────────────
    NodeSpec(
        id="read_csv", name="read_csv", label="Read CSV", category="Input", color="#e53935",
        inputs={}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("file_path", "file", required=True),
            _ps("delimiter", "string", default=","),
            _ps("encoding", "string", default="utf-8"),
        ],
        default_params={"file_path": None, "delimiter": ",", "encoding": "utf-8"},
        default_code=READ_CSV_CODE,
    ),
    NodeSpec(
        id="read_excel", name="read_excel", label="Read Excel", category="Input", color="#e53935",
        inputs={}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("file_path", "file", required=True),
            _ps("sheet", "string", default="0"),
        ],
        default_params={"file_path": None, "sheet": "0"},
        default_code=READ_EXCEL_CODE,
    ),
    NodeSpec(
        id="read_json", name="read_json", label="Read JSON / GeoJSON", category="Input", color="#e53935",
        inputs={}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[_ps("file_path", "file", required=True)],
        default_params={"file_path": None},
        default_code=READ_JSON_CODE,
    ),
    NodeSpec(
        id="read_parquet", name="read_parquet", label="Read Parquet", category="Input", color="#e53935",
        inputs={}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[_ps("file_path", "file", required=True)],
        default_params={"file_path": None},
        default_code=READ_PARQUET_CODE,
    ),
    NodeSpec(
        id="geofile_reader", name="geofile_reader", label="GeoFile Reader", category="Input", color="#ef5350",
        inputs={}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("file_path", "file", required=True),
            _ps("layer", "string", default=""),
        ],
        default_params={"file_path": None, "layer": ""},
        default_code=GEOFILE_READER_CODE,
    ),

    # ── Transform ─────────────────────────────────────────────────────────────
    NodeSpec(
        id="column_filter", name="column_filter", label="Column Filter", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[_ps("columns", "column_list", required=True)],
        default_params={"columns": []},
        default_code=COLUMN_FILTER_CODE,
    ),
    NodeSpec(
        id="row_filter", name="row_filter", label="Row Filter", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("column", "column", required=True),
            _ps("operator", "enum", default=">",
                options=[">", ">=", "<", "<=", "==", "!=", "contains"]),
            _ps("value", "string", required=True),
        ],
        default_params={"column": None, "operator": ">", "value": ""},
        default_code=ROW_FILTER_CODE,
    ),
    NodeSpec(
        id="groupby", name="groupby", label="GroupBy", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("group_by", "column", required=True),
            _ps("target_column", "column", required=True),
            _ps("aggregation", "enum", default="max",
                options=["sum", "mean", "median", "min", "max", "count"]),
        ],
        default_params={"group_by": None, "target_column": None, "aggregation": "max"},
        default_code=GROUPBY_CODE,
    ),
    NodeSpec(
        id="sort_rows", name="sort_rows", label="Sort Rows", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("column", "column", required=True),
            _ps("ascending", "enum", default="true", options=["true", "false"]),
        ],
        default_params={"column": None, "ascending": "true"},
        default_code=SORT_CODE,
    ),
    NodeSpec(
        id="join_tables", name="join_tables", label="Join Tables", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame", "label": "left"}, "df_in_2": {"type": "DataFrame", "label": "right"}},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("left_on", "column", required=True),
            _ps("right_on", "column_right", required=True),
            _ps("right_file_path", "file"),
            _ps("how", "enum", default="inner", options=["inner", "left", "right", "outer"]),
            _ps("left_columns", "column_list", default=None),
            _ps("right_columns", "column_list_right", default=None),
        ],
        default_params={"left_on": None, "right_on": None, "right_file_path": None, "how": "inner", "left_columns": None, "right_columns": None},
        default_code=JOIN_CODE,
    ),
    NodeSpec(
        id="rename_columns", name="rename_columns", label="Rename Columns", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[_ps("rename_map", "string", default="{}", required=True)],
        default_params={"rename_map": "{}"},
        default_code=RENAME_CODE,
    ),
    NodeSpec(
        id="formula_column", name="formula_column", label="Formula Column", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("new_column", "string", default="result"),
            _ps("expression", "string", required=True),
        ],
        default_params={"new_column": "result", "expression": ""},
        default_code=FORMULA_COLUMN_CODE,
    ),
    NodeSpec(
        id="table_statistics", name="table_statistics", label="Statistics", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[],
        default_params={},
        default_code=STATISTICS_CODE,
    ),
    NodeSpec(
        id="drop_duplicates", name="drop_duplicates", label="Drop Duplicates", category="Transform", color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("subset", "string", default=""),
            _ps("keep", "enum", default="first", options=["first", "last", "false"]),
        ],
        default_params={"subset": "", "keep": "first"},
        default_code=DROP_DUPLICATES_CODE,
    ),

    # ── GIS ───────────────────────────────────────────────────────────────────
    NodeSpec(
        id="geo_buffer", name="geo_buffer", label="Buffer", category="GIS", color="#26a69a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[_ps("distance", "number", default=100)],
        default_params={"distance": 100},
        default_code=GEO_BUFFER_CODE,
    ),
    NodeSpec(
        id="geo_dissolve", name="geo_dissolve", label="Dissolve", category="GIS", color="#26a69a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("by_column", "column", default=""),
            _ps("agg_column", "column", default=""),
            _ps("agg_func", "enum", default="first",
                options=["first", "sum", "mean", "max", "min", "count"]),
        ],
        default_params={"by_column": "", "agg_column": "", "agg_func": "first"},
        default_code=GEO_DISSOLVE_CODE,
    ),
    NodeSpec(
        id="geo_spatial_join", name="geo_spatial_join", label="Spatial Join", category="GIS", color="#26a69a",
        inputs={"df_in": {"type": "DataFrame", "label": "left"}, "df_in_2": {"type": "DataFrame", "label": "right"}},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("right_file_path", "file"),
            _ps("how", "enum", default="left", options=["left", "inner", "right"]),
            _ps("predicate", "enum", default="intersects",
                options=["intersects", "within", "contains", "overlaps", "touches", "crosses"]),
        ],
        default_params={"right_file_path": None, "how": "left", "predicate": "intersects"},
        default_code=GEO_SJOIN_CODE,
    ),
    NodeSpec(
        id="geo_crs_transform", name="geo_crs_transform", label="CRS Transform", category="GIS", color="#26a69a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[_ps("target_crs", "string", default="EPSG:4326")],
        default_params={"target_crs": "EPSG:4326"},
        default_code=GEO_CRS_CODE,
    ),
    NodeSpec(
        id="geo_centroid", name="geo_centroid", label="Centroid", category="GIS", color="#26a69a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[],
        default_params={},
        default_code=GEO_CENTROID_CODE,
    ),
    NodeSpec(
        id="geo_area_length", name="geo_area_length", label="Area / Length", category="GIS", color="#26a69a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[_ps("mode", "enum", default="area", options=["area", "length"])],
        default_params={"mode": "area"},
        default_code=GEO_AREA_LENGTH_CODE,
    ),
    NodeSpec(
        id="geo_convex_hull", name="geo_convex_hull", label="Convex Hull", category="GIS", color="#26a69a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[],
        default_params={},
        default_code=GEO_CONVEX_HULL_CODE,
    ),
    NodeSpec(
        id="geo_clip", name="geo_clip", label="Clip", category="GIS", color="#26a69a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[_ps("mask_file_path", "file", required=True)],
        default_params={"mask_file_path": None},
        default_code=GEO_CLIP_CODE,
    ),

    # ── Visualization (Plotly) ─────────────────────────────────────────────────
    NodeSpec(
        id="histogram", name="histogram", label="Histogram", category="Visualization", color="#1e88e5",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
        parameters=[
            _ps("column", "column", required=True),
            _ps("bins", "number", default=30),
        ],
        default_params={"column": None, "bins": 30},
        default_code=HISTOGRAM_CODE,
    ),
    NodeSpec(
        id="scatter_plot", name="scatter_plot", label="Scatter Plot", category="Visualization", color="#1e88e5",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
        parameters=[
            _ps("x_column", "column", required=True),
            _ps("y_column", "column", required=True),
            _ps("color_column", "column", default=""),
        ],
        default_params={"x_column": None, "y_column": None, "color_column": ""},
        default_code=SCATTER_CODE,
    ),
    NodeSpec(
        id="bar_chart", name="bar_chart", label="Bar Chart", category="Visualization", color="#1e88e5",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
        parameters=[
            _ps("x_column", "column", required=True),
            _ps("y_column", "column", required=True),
            _ps("color_column", "column", default=""),
        ],
        default_params={"x_column": None, "y_column": None, "color_column": ""},
        default_code=BAR_CHART_CODE,
    ),
    NodeSpec(
        id="line_chart", name="line_chart", label="Line Chart", category="Visualization", color="#1e88e5",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
        parameters=[
            _ps("x_column", "column", required=True),
            _ps("y_column", "column", required=True),
            _ps("color_column", "column", default=""),
        ],
        default_params={"x_column": None, "y_column": None, "color_column": ""},
        default_code=LINE_CHART_CODE,
    ),
    NodeSpec(
        id="geomap", name="geomap", label="GeoMap", category="Visualization", color="#42a5f5",
        inputs={"df_in": {"type": "DataFrame", "label": "layer 1"}},
        outputs={"html_out": {"type": "HTML"}},
        dynamic_inputs=True,
        parameters=[
            _ps("tiles", "enum", default="OpenStreetMap",
                options=["OpenStreetMap", "CartoDB positron", "CartoDB dark_matter"]),
            _ps("zoom_start", "number", default=4),
        ],
        default_params={"tiles": "OpenStreetMap", "zoom_start": 4},
        default_code=GEOMAP_CODE,
    ),
    NodeSpec(
        id="geo_view", name="geo_view", label="GeoView", category="Visualization", color="#42a5f5",
        inputs={"df_in": {"type": "DataFrame", "label": "layer 1"}},
        outputs={"html_out": {"type": "HTML"}, "img_out": {"type": "Image", "label": "PNG image"}},
        dynamic_inputs=True,
        parameters=[
            _ps("layers", "geo_layers", default=[]),
            _ps("title", "string", default=""),
            _ps("axis_off", "boolean", default=True),
            _ps("fig_width", "number", default=10),
            _ps("fig_height", "number", default=8),
            _ps("legend_show", "boolean", default=True),
            _ps("legend_loc", "enum", default="best",
                options=["best", "upper right", "upper left", "lower right", "lower left",
                         "center right", "center left", "upper center", "lower center", "center"]),
            _ps("legend_fontsize", "number", default=10),
            _ps("legend_frame", "boolean", default=True),
            _ps("legend_bbox", "string", default=""),
            _ps("basemap", "enum", default="none",
                options=["none", "osm", "satellite", "topo",
                         "cartodb_light", "cartodb_dark",
                         "stamen_terrain", "stamen_toner"]),
            _ps("basemap_alpha", "number", default=0.5),
            _ps("dpi", "number", default=200),
        ],
        default_params={
            "layers": [], "title": "", "axis_off": True,
            "fig_width": 10, "fig_height": 8,
            "legend_show": True, "legend_loc": "best", "legend_fontsize": 10,
            "legend_frame": True, "legend_bbox": "",
            "basemap": "none", "basemap_alpha": 0.5,
            "dpi": 200,
        },
        default_code=GEO_VIEW_CODE,
    ),

    # ── Nature View ───────────────────────────────────────────────────────────
    NodeSpec(
        id="nature_boxplot", name="nature_boxplot", label="Box Plot", category="Nature View", color="#2e7d32",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}, "img_out": {"type": "Image"}},
        parameters=[
            _ps("y_column", "column", required=True),
            _ps("x_column", "column", default=""),
            _ps("palette", "enum", default="colorblind", options=_NATURE_PALETTES),
            _ps("title", "string", default=""),
        ],
        default_params={"y_column": None, "x_column": "", "palette": "colorblind", "title": ""},
        default_code=NATURE_BOXPLOT_CODE,
    ),
    NodeSpec(
        id="nature_violin", name="nature_violin", label="Violin Plot", category="Nature View", color="#2e7d32",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}, "img_out": {"type": "Image"}},
        parameters=[
            _ps("y_column", "column", required=True),
            _ps("x_column", "column", default=""),
            _ps("palette", "enum", default="colorblind", options=_NATURE_PALETTES),
            _ps("title", "string", default=""),
        ],
        default_params={"y_column": None, "x_column": "", "palette": "colorblind", "title": ""},
        default_code=NATURE_VIOLIN_CODE,
    ),
    NodeSpec(
        id="nature_heatmap", name="nature_heatmap", label="Heatmap", category="Nature View", color="#2e7d32",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}, "img_out": {"type": "Image"}},
        parameters=[
            _ps("x_column", "column", default=""),
            _ps("y_column", "column", default=""),
            _ps("value_column", "column", default=""),
            _ps("palette", "enum", default="coolwarm",
                options=["coolwarm", "viridis", "RdYlBu", "Blues", "YlOrRd", "PuOr"]),
            _ps("title", "string", default=""),
        ],
        default_params={"x_column": "", "y_column": "", "value_column": "", "palette": "coolwarm", "title": ""},
        default_code=NATURE_HEATMAP_CODE,
    ),
    NodeSpec(
        id="nature_ridgeplot", name="nature_ridgeplot", label="Ridge Plot", category="Nature View", color="#2e7d32",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}, "img_out": {"type": "Image"}},
        parameters=[
            _ps("group_column", "column", required=True),
            _ps("value_column", "column", required=True),
            _ps("palette", "enum", default="Set2", options=_NATURE_PALETTES),
            _ps("title", "string", default="Ridge Plot"),
        ],
        default_params={"group_column": None, "value_column": None, "palette": "Set2", "title": "Ridge Plot"},
        default_code=NATURE_RIDGEPLOT_CODE,
    ),

    # ── Image Nodes ───────────────────────────────────────────────────────────
    NodeSpec(
        id="image_exporter", name="image_exporter", label="Image Exporter",
        category="Image", color="#f57c00",
        inputs={"img_in": {"type": "Image", "label": "image"}},
        outputs={},
        parameters=[
            _ps("save_path", "string", required=True, default=""),
            _ps("quality", "number", default=90),
        ],
        default_params={"save_path": "", "quality": 90},
        default_code=IMAGE_EXPORTER_CODE,
    ),
    NodeSpec(
        id="report_builder", name="report_builder", label="Report Builder",
        category="Image", color="#7b1fa2",
        inputs={"img_in": {"type": "Image", "label": "image 1"}},
        outputs={"html_out": {"type": "HTML"}},
        dynamic_inputs=True,
        parameters=[
            _ps("title", "string", default="Report"),
            _ps("accent_color", "string", default="#1976d2"),
            _ps("sections", "json", default=[]),
        ],
        default_params={
            "title": "Report",
            "accent_color": "#1976d2",
            "sections": [
                {"id": "s1", "columns": [{"id": "c1", "type": "heading", "content": "My Report", "fontSize": 18, "textAlign": "left", "showDivider": True}]},
                {"id": "s2", "columns": [{"id": "c2", "type": "image", "imgPort": 1, "caption": ""}]},
                {"id": "s3", "columns": [{"id": "c3", "type": "text", "content": "Add your analysis notes here.", "fontSize": 13, "textAlign": "left"}]},
            ],
        },
        default_code=REPORT_BUILDER_CODE,
        description="Visual page-layout report combining images and text. Use the Layout Editor in the node panel to arrange sections.",
    ),
    NodeSpec(
        id="llm_vision", name="llm_vision", label="LLM Vision",
        category="Image", color="#c62828",
        inputs={"img_in": {"type": "Image", "label": "image"}},
        outputs={"html_out": {"type": "HTML"}},
        parameters=[
            _ps("prompt", "string", default="Describe what you see in this image in detail."),
            _ps("base_url", "string", default="https://generativelanguage.googleapis.com/v1beta/openai/"),
            _ps("api_key", "string", default=""),
            _ps("model", "string", default="gemini-2.5-flash"),
        ],
        default_params={
            "prompt": "Describe what you see in this image in detail.",
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
            "api_key": "", "model": "gemini-2.5-flash",
        },
        default_code=LLM_VISION_CODE,
    ),

    # ── Python Script ─────────────────────────────────────────────────────────
    NodeSpec(
        id="python_script_data", name="python_script_data",
        label="Python Script (Data)", category="Python Script", color="#546e7a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[],
        default_params={},
        default_code=PYTHON_SCRIPT_DATA_CODE,
    ),
    NodeSpec(
        id="python_script_html", name="python_script_html",
        label="Python Script (HTML)", category="Python Script", color="#546e7a",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
        parameters=[],
        default_params={},
        default_code=PYTHON_SCRIPT_HTML_CODE,
    ),

    # ── Group / Component boundary nodes ─────────────────────────────────────
    NodeSpec(
        id="port_in", name="port_in",
        label="Port In", category="Group", color="#7b1fa2",
        inputs={}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[],
        default_params={},
        default_code="df_out = df_in",
        description="Input boundary node for a Group or Component.",
    ),
    NodeSpec(
        id="port_out", name="port_out",
        label="Port Out", category="Group", color="#7b1fa2",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={},
        parameters=[],
        default_params={},
        default_code="df_out = df_in",
        description="Output boundary node for a Group or Component.",
    ),
    # KNIME-style vertical bar nodes (internal to group subflows, not user-draggable)
    NodeSpec(
        id="group_input_bar", name="group_input_bar",
        label="Input", category="Group", color="#388e3c",
        inputs={"df_in": {"type": "DataFrame"}},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[],
        default_params={},
        default_code="",
        description="Group input bar. Data is pre-injected by the group executor; execution is skipped.",
    ),
    NodeSpec(
        id="group_output_bar", name="group_output_bar",
        label="Output", category="Group", color="#c62828",
        inputs={"df_in": {"type": "DataFrame"}},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[],
        default_params={},
        default_code="",
        description="Group output bar. Its upstream edge provides the group's output.",
    ),
]

# ─── Node descriptions (markdown, shown in the Info tab) ────────────────────

_DESCRIPTIONS: dict[str, str] = {
    "read_csv": (
        "Reads a **CSV file** into a DataFrame.\n\n"
        "- `file_path`: path to the .csv file (upload supported)\n"
        "- `delimiter`: field separator (default `,`)\n"
        "- `encoding`: text encoding (default `utf-8`)"
    ),
    "read_excel": (
        "Reads an **Excel workbook** (.xlsx / .xls) into a DataFrame.\n\n"
        "- `sheet`: sheet index (`0`) or sheet name\n\n"
        "Requires `openpyxl`."
    ),
    "read_json": (
        "Reads a **JSON or GeoJSON** file.\n\n"
        "GeoJSON is loaded with *geopandas* (geometry preserved); "
        "plain JSON falls back to `pandas.read_json`."
    ),
    "read_parquet": "Reads a **Parquet** file into a DataFrame — fast columnar format.",
    "geofile_reader": (
        "Reads a **geospatial file** into a GeoDataFrame.\n\n"
        "Supports Shapefile (.shp / zipped), GeoJSON, GeoPackage, and more via GDAL.\n\n"
        "- `layer`: layer name for multi-layer sources (e.g. GeoPackage)"
    ),
    "column_filter": "Keeps only the **selected columns** — like KNIME *Column Filter*.",
    "row_filter": (
        "Filters rows by a **condition** on one column.\n\n"
        "Operators: `>` `>=` `<` `<=` `==` `!=` `contains` (string match)."
    ),
    "groupby": (
        "**Groups rows** by a column and aggregates a target column.\n\n"
        "Aggregations: `sum`, `mean`, `median`, `min`, `max`, `count`."
    ),
    "sort_rows": "Sorts rows by a column, ascending or descending.",
    "join_tables": (
        "**Joins two tables** on key columns — like SQL JOIN.\n\n"
        "**Inputs**: left table (top port), right table (bottom port).\n"
        "If the right port is unconnected, `right_file_path` is read as CSV.\n\n"
        "- `how`: `inner` / `left` / `right` / `outer`"
    ),
    "rename_columns": (
        "Renames columns using a **JSON mapping**, e.g.\n\n"
        "```json\n{\"old_name\": \"new_name\"}\n```"
    ),
    "formula_column": (
        "Adds a **computed column** using a pandas `eval` expression.\n\n"
        "Example: `pop_density = population / area_km2` → expression `population / area_km2`."
    ),
    "table_statistics": "Computes **summary statistics** (count, mean, std, min, max, …) for every column.",
    "drop_duplicates": (
        "Removes **duplicate rows**.\n\n"
        "- `subset`: comma-separated columns to compare (empty = all columns)\n"
        "- `keep`: `first` / `last` / `false` (drop all duplicates)"
    ),
    "geo_buffer": (
        "Creates a **buffer** around each geometry.\n\n"
        "- `distance`: buffer radius in **meters**\n\n"
        "Geographic CRS inputs are projected to EPSG:3857 for the buffer, then projected back."
    ),
    "geo_dissolve": (
        "**Merges geometries** into one (or one per group) — like KNIME/QGIS *Dissolve*.\n\n"
        "- `by_column`: group key (empty = dissolve everything)\n"
        "- `agg_column` + `agg_func`: optional attribute aggregation"
    ),
    "geo_spatial_join": (
        "**Spatial join** of two layers by geometric relationship.\n\n"
        "**Inputs**: left layer (top port), right layer (bottom port).\n"
        "If the right port is unconnected, `right_file_path` is loaded.\n"
        "CRS mismatches are reprojected automatically.\n\n"
        "- `predicate`: `intersects` / `within` / `contains` / `overlaps` / `touches` / `crosses`"
    ),
    "geo_crs_transform": (
        "**Reprojects** the layer to a target CRS.\n\n"
        "- `target_crs`: e.g. `EPSG:4326` (WGS84), `EPSG:3857` (Web Mercator)"
    ),
    "geo_centroid": "Replaces each geometry with its **centroid point**.",
    "geo_area_length": (
        "Computes **area (m²)** or **length (m)** per feature into a new column.\n\n"
        "Geographic inputs are measured in EPSG:3857."
    ),
    "geo_convex_hull": "Replaces each geometry with its **convex hull**.",
    "geo_clip": (
        "**Clips** the input layer to a mask boundary.\n\n"
        "- `mask_file_path`: GeoFile whose union is the clip boundary"
    ),
    "histogram": "Interactive **histogram** (Plotly) of one numeric column.",
    "scatter_plot": "Interactive **scatter plot** (Plotly). Optional `color_column` for grouping.",
    "bar_chart": "Interactive **bar chart** (Plotly).",
    "line_chart": "Interactive **line chart** (Plotly).",
    "geomap": (
        "Interactive **web map** (folium / Leaflet) of one or more layers.\n\n"
        "**Dynamic inputs**: select the node and use **+ / −** to add or remove "
        "layer ports. Layers draw **bottom-to-top** (port 1 at the bottom). "
        "Each layer gets its own color and a layer-control toggle."
    ),
    "geo_view": (
        "**Static map** (PNG or SVG) of one or more layers — publication-ready output.\n\n"
        "**Dynamic inputs**: + / − to add or remove layer ports; layers draw **bottom-to-top**.\n\n"
        "**Layer Styles** — per layer: column-driven coloring (Classified / Continuous), "
        "color ramp, fill/boundary color & alpha, marker size for points.\n\n"
        "**Legend bbox** (`x, y`) — axes-fraction coordinates that anchor the legend box:\n"
        "- `(0, 0)` = bottom-left corner of the axes\n"
        "- `(1, 1)` = top-right corner\n"
        "- `(1.05, 0.5)` = just outside the right edge, vertically centred\n"
        "- `(0.5, -0.15)` = below the axes, horizontally centred\n"
        "Pair with **legend_loc** to control which corner of the legend box lands on that point. "
        "e.g. loc=`upper left` + bbox=`1.05,1` places the legend's top-left corner outside the right edge.\n\n"
        "**Output format**: PNG (default) or SVG (resolution-independent, no DPI needed).\n"
        "**save_path**: full file path to also write the file to your workspace (e.g. `/data/map.png`)."
    ),
    "nature_boxplot": (
        "**Box plot** in Nature journal style (matplotlib + seaborn, static PNG).\n\n"
        "- `palette`: colorblind-safe schemes available"
    ),
    "nature_violin": "**Violin plot** in Nature journal style (static PNG).",
    "nature_heatmap": (
        "**Heatmap** in Nature journal style.\n\n"
        "With `x/y/value` columns set: pivot-table heatmap. "
        "Otherwise: correlation matrix of numeric columns."
    ),
    "nature_ridgeplot": (
        "**Ridge plot** (stacked density curves per group) in Nature journal style.\n\n"
        "- `group_column`: one ridge per group value\n"
        "- `value_column`: numeric distribution"
    ),
    "python_script_data": (
        "**Free-form Python** node producing a DataFrame.\n\n"
        "Variables available: `df_in` (upstream DataFrame or None), `params` (dict), "
        "`df_ins` (all inputs). Set `df_out` for downstream nodes."
    ),
    "python_script_html": (
        "**Free-form Python** node producing an HTML view.\n\n"
        "Set `html_out` to any HTML string — plotly `fig.to_html()`, folium "
        "`m.get_root().render()`, or a base64 `<img>`."
    ),
}

for _spec in NODE_SPECS:
    _spec.description = _DESCRIPTIONS.get(_spec.id, _spec.description)

# Alias kept for backward compatibility
DEFAULT_NODE_SPECS = NODE_SPECS


def get_spec_by_type(node_type: str) -> NodeSpec | None:
    for spec in NODE_SPECS:
        if spec.id == node_type:
            return spec
    return None
