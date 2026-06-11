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
import pandas as pd
left_on = params.get("left_on")
right_on = params.get("right_on") or left_on
how = params.get("how", "inner")
right_path = params.get("right_file_path")
if not right_path:
    raise ValueError("Provide right_file_path (path to the second CSV to join).")
if not left_on:
    raise ValueError("Provide left_on (join key column).")
df_right = pd.read_csv(right_path)
df_out = df_in.merge(df_right, left_on=left_on, right_on=right_on, how=how)
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
right_path = params.get("right_file_path")
if not right_path:
    raise ValueError("Provide right_file_path (path to the overlay GeoFile).")
gdf_right = gpd.read_file(right_path)
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
if df_in is None:
    raise ValueError("GeoMap requires df_in from upstream GeoFile Reader.")
if "geometry" not in df_in.columns:
    raise ValueError("Input does not contain a geometry column.")
tiles = params.get("tiles", "OpenStreetMap")
zoom_start = int(params.get("zoom_start", 4))
gdf = df_in[df_in.geometry.notnull()].copy()
if gdf.empty:
    raise ValueError("No valid geometries found.")
centroid = gdf.geometry.to_crs(epsg=4326).centroid
m = folium.Map(location=[float(centroid.y.mean()), float(centroid.x.mean())],
               zoom_start=zoom_start, tiles=tiles)
folium.GeoJson(gdf.__geo_interface__).add_to(m)
html_out = m.get_root().render()
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
html_out = ('<img src="data:image/png;base64,' +
            base64.b64encode(buf.getvalue()).decode() +
            '" style="max-width:100%;height:auto;" />')
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
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("left_on", "column", required=True),
            _ps("right_on", "string", default=""),
            _ps("right_file_path", "file", required=True),
            _ps("how", "enum", default="inner", options=["inner", "left", "right", "outer"]),
        ],
        default_params={"left_on": None, "right_on": "", "right_file_path": None, "how": "inner"},
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
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            _ps("right_file_path", "file", required=True),
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
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
        parameters=[
            _ps("tiles", "enum", default="OpenStreetMap",
                options=["OpenStreetMap", "CartoDB positron", "CartoDB dark_matter"]),
            _ps("zoom_start", "number", default=4),
        ],
        default_params={"tiles": "OpenStreetMap", "zoom_start": 4},
        default_code=GEOMAP_CODE,
    ),

    # ── Nature View ───────────────────────────────────────────────────────────
    NodeSpec(
        id="nature_boxplot", name="nature_boxplot", label="Box Plot", category="Nature View", color="#2e7d32",
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
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
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
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
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
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
        inputs={"df_in": {"type": "DataFrame"}}, outputs={"html_out": {"type": "HTML"}},
        parameters=[
            _ps("group_column", "column", required=True),
            _ps("value_column", "column", required=True),
            _ps("palette", "enum", default="Set2", options=_NATURE_PALETTES),
            _ps("title", "string", default="Ridge Plot"),
        ],
        default_params={"group_column": None, "value_column": None, "palette": "Set2", "title": "Ridge Plot"},
        default_code=NATURE_RIDGEPLOT_CODE,
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
]

# Alias kept for backward compatibility
DEFAULT_NODE_SPECS = NODE_SPECS


def get_spec_by_type(node_type: str) -> NodeSpec | None:
    for spec in NODE_SPECS:
        if spec.id == node_type:
            return spec
    return None
