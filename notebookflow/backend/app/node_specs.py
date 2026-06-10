"""Builtin tabular node specifications for NotebookFlow v0.1."""

from __future__ import annotations

from app.models import NodeSpec, ParameterSpec

READ_CSV_CODE = '''import pandas as pd

df_out = pd.read_csv(
    params["file_path"],
    sep=params.get("delimiter", ","),
    encoding=params.get("encoding", "utf-8")
)
'''

COLUMN_FILTER_CODE = '''columns = params.get("columns", [])

if not columns:
    raise ValueError("Please select at least one column.")

df_out = df_in[columns].copy()
'''

ROW_FILTER_CODE = '''column = params.get("column")
operator = params.get("operator", ">")
value = params.get("value")

if column is None:
    raise ValueError("Please select a column.")

series = df_in[column]

try:
    value_cast = float(value)
except Exception:
    value_cast = value

if operator == ">":
    df_out = df_in[series > value_cast].copy()
elif operator == ">=":
    df_out = df_in[series >= value_cast].copy()
elif operator == "<":
    df_out = df_in[series < value_cast].copy()
elif operator == "<=":
    df_out = df_in[series <= value_cast].copy()
elif operator == "==":
    df_out = df_in[series == value_cast].copy()
elif operator == "!=":
    df_out = df_in[series != value_cast].copy()
elif operator == "contains":
    df_out = df_in[series.astype(str).str.contains(str(value), na=False)].copy()
else:
    raise ValueError(f"Unsupported operator: {operator}")
'''

GROUPBY_CODE = '''group_by = params.get("group_by")
target = params.get("target_column")
agg = params.get("aggregation", "max")

if group_by is None:
    raise ValueError("Please select group_by column.")

if target is None:
    raise ValueError("Please select target_column.")

df_out = (
    df_in
    .groupby(group_by)[target]
    .agg(agg)
    .reset_index()
)
'''

HISTOGRAM_CODE = '''import plotly.express as px

column = params.get("column")
bins = int(params.get("bins", 30))

if column is None:
    raise ValueError("Please select a column.")

fig = px.histogram(df_in, x=column, nbins=bins)
html_out = fig.to_html(include_plotlyjs="cdn")
'''

GEOFILE_READER_CODE = '''import os
import geopandas as gpd

file_path = params.get("file_path")

if not file_path:
    raise ValueError("Please provide file_path.")

layer = params.get("layer")
# Allow GDAL to rebuild missing .shx when possible.
os.environ["SHAPE_RESTORE_SHX"] = "YES"
if layer:
    df_out = gpd.read_file(file_path, layer=layer)
else:
    df_out = gpd.read_file(file_path)
'''

GEOMAP_CODE = '''import folium

if df_in is None:
    raise ValueError("GeoMap requires df_in from upstream GeoFile Reader.")

if "geometry" not in df_in.columns:
    raise ValueError("Input does not contain a geometry column.")

tiles = params.get("tiles", "OpenStreetMap")
zoom_start = int(params.get("zoom_start", 4))

gdf = df_in.copy()
gdf = gdf[gdf.geometry.notnull()].copy()

if gdf.empty:
    raise ValueError("No valid geometries found.")

centroid = gdf.geometry.to_crs(epsg=4326).centroid
center_lat = float(centroid.y.mean())
center_lon = float(centroid.x.mean())

m = folium.Map(location=[center_lat, center_lon], zoom_start=zoom_start, tiles=tiles)
folium.GeoJson(gdf.__geo_interface__).add_to(m)
html_out = m.get_root().render()
'''

NODE_SPECS: list[NodeSpec] = [
    NodeSpec(
        id="read_csv",
        name="read_csv",
        label="Read CSV",
        category="Input",
        color="#e53935",
        inputs={},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            ParameterSpec(name="file_path", type="file", required=True),
            ParameterSpec(name="delimiter", type="string", required=False, default=","),
            ParameterSpec(name="encoding", type="string", required=False, default="utf-8"),
        ],
        default_params={
            "file_path": None,
            "delimiter": ",",
            "encoding": "utf-8",
        },
        default_code=READ_CSV_CODE,
    ),
    NodeSpec(
        id="column_filter",
        name="column_filter",
        label="Column Filter",
        category="Transform",
        color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            ParameterSpec(name="columns", type="column_list", required=True),
        ],
        default_params={"columns": []},
        default_code=COLUMN_FILTER_CODE,
    ),
    NodeSpec(
        id="row_filter",
        name="row_filter",
        label="Row Filter",
        category="Transform",
        color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            ParameterSpec(name="column", type="column", required=True),
            ParameterSpec(
                name="operator",
                type="enum",
                required=False,
                default=">",
                options=[">", ">=", "<", "<=", "==", "!=", "contains"],
            ),
            ParameterSpec(name="value", type="string", required=True),
        ],
        default_params={
            "column": None,
            "operator": ">",
            "value": "",
        },
        default_code=ROW_FILTER_CODE,
    ),
    NodeSpec(
        id="groupby",
        name="groupby",
        label="GroupBy",
        category="Transform",
        color="#fbc02d",
        inputs={"df_in": {"type": "DataFrame"}},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            ParameterSpec(name="group_by", type="column", required=True),
            ParameterSpec(name="target_column", type="column", required=True),
            ParameterSpec(
                name="aggregation",
                type="enum",
                required=False,
                default="max",
                options=["sum", "mean", "median", "min", "max", "count"],
            ),
        ],
        default_params={
            "group_by": None,
            "target_column": None,
            "aggregation": "max",
        },
        default_code=GROUPBY_CODE,
    ),
    NodeSpec(
        id="histogram",
        name="histogram",
        label="Histogram",
        category="Visualization",
        color="#1e88e5",
        inputs={"df_in": {"type": "DataFrame"}},
        outputs={"html_out": {"type": "HTML"}},
        parameters=[
            ParameterSpec(name="column", type="column", required=True),
            ParameterSpec(name="bins", type="number", required=False, default=30),
        ],
        default_params={
            "column": None,
            "bins": 30,
        },
        default_code=HISTOGRAM_CODE,
    ),
    NodeSpec(
        id="geofile_reader",
        name="geofile_reader",
        label="GeoFile Reader",
        category="Input",
        color="#ef5350",
        inputs={},
        outputs={"df_out": {"type": "DataFrame"}},
        parameters=[
            ParameterSpec(name="file_path", type="file", required=True),
            ParameterSpec(name="layer", type="string", required=False, default=""),
        ],
        default_params={
            "file_path": None,
            "layer": "",
        },
        default_code=GEOFILE_READER_CODE,
    ),
    NodeSpec(
        id="geomap",
        name="geomap",
        label="GeoMap",
        category="Visualization",
        color="#42a5f5",
        inputs={"df_in": {"type": "DataFrame"}},
        outputs={"html_out": {"type": "HTML"}},
        parameters=[
            ParameterSpec(
                name="tiles",
                type="enum",
                required=False,
                default="OpenStreetMap",
                options=["OpenStreetMap", "CartoDB positron", "CartoDB dark_matter"],
            ),
            ParameterSpec(name="zoom_start", type="number", required=False, default=4),
        ],
        default_params={
            "tiles": "OpenStreetMap",
            "zoom_start": 4,
        },
        default_code=GEOMAP_CODE,
    ),
]


def get_spec_by_type(node_type: str) -> NodeSpec | None:
    for spec in NODE_SPECS:
        if spec.id == node_type:
            return spec
    return None
