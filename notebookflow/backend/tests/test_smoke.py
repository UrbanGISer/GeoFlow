"""Smoke tests for the incremental engine, AI planner plumbing, and notebook standardizer.

Runs with plain Python (no pytest required):
    cd notebookflow/backend && python tests/test_smoke.py
Only needs pandas + pydantic (no fastapi/geopandas/plotly imports here).
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from app.data_store import DataStore, ResultCache
from app.models import NotebookCell, PlanStep, WorkflowEdge, WorkflowNode
from app.node_specs import NODE_SPECS
from app.services.node_retriever import retrieve_best
from app.services.notebook_standardizer import standardize_notebook
from app.services.planner import extract_json_object, plan_workflow
from app.services.temp_node_factory import build_temp_node_spec, scan_generated_code
from app.models import WorkflowPlanRequest
from app.workflow_engine import run_workflow


def make_linear_workflow() -> tuple[list[WorkflowNode], list[WorkflowEdge]]:
    nodes = [
        WorkflowNode(
            id="n1",
            type="custom",
            label="Source",
            code="df_out = pd.DataFrame({'a': [1, 1, 2], 'b': [3.0, 4.0, 5.0]})",
        ),
        WorkflowNode(
            id="n2",
            type="custom",
            label="Agg",
            params={"col": "a"},
            code="df_out = df_in.groupby(params['col'])['b'].sum().reset_index()",
        ),
    ]
    edges = [WorkflowEdge(id="e1", source="n1", target="n2")]
    return nodes, edges


def test_engine_cache() -> None:
    nodes, edges = make_linear_workflow()
    store = DataStore()
    cache = ResultCache()
    artifacts = Path(tempfile.mkdtemp())

    status, outputs, logs, _, _ = run_workflow(nodes, edges, store, artifacts, cache=cache)
    assert status == "success", logs
    assert outputs["n2"]["cached"] is False
    first = store.get_df_for_node("n2")
    assert first is not None and first["b"].tolist() == [7.0, 5.0]

    status, outputs, logs, _, _ = run_workflow(nodes, edges, store, artifacts, cache=cache)
    assert status == "success", logs
    assert outputs["n1"]["cached"] is True and outputs["n2"]["cached"] is True
    assert any("cached" in line for line in logs)

    # Changing a param invalidates that node (and only re-runs from there).
    nodes[1].params["unused_marker"] = 1
    status, outputs, logs, _, _ = run_workflow(nodes, edges, store, artifacts, cache=cache)
    assert status == "success", logs
    assert outputs["n1"]["cached"] is True
    assert outputs["n2"]["cached"] is False

    # use_cache=False forces full re-execution.
    status, outputs, _, _, _ = run_workflow(nodes, edges, store, artifacts, cache=cache, use_cache=False)
    assert outputs["n1"]["cached"] is False
    print("ok: engine fingerprint cache")


def test_cache_mutation_safety() -> None:
    """A downstream node mutating df_in must not poison the cached upstream df."""
    nodes, edges = make_linear_workflow()
    nodes[1].code = "df_in['a'] = 999\ndf_out = df_in"
    store = DataStore()
    cache = ResultCache()
    artifacts = Path(tempfile.mkdtemp())
    run_workflow(nodes, edges, store, artifacts, cache=cache)
    run_workflow(nodes, edges, store, artifacts, cache=cache)
    src = store.get_df_for_node("n1")
    assert src is not None and src["a"].tolist() == [1, 1, 2], src["a"].tolist()
    print("ok: cached upstream protected from in-place mutation")


def test_planner_json_extraction_and_fallback() -> None:
    assert extract_json_object('{"steps": []}') == {"steps": []}
    assert extract_json_object('```json\n{"steps": [1]}\n```') == {"steps": [1]}
    assert extract_json_object('Here you go:\n```\n{"a": 1}\n```\nEnjoy!') == {"a": 1}
    assert extract_json_object('Sure! The plan is {"a": {"b": 2}} as requested.') == {"a": {"b": 2}}
    assert extract_json_object("no json here") is None

    result = plan_workflow(
        WorkflowPlanRequest(prompt="load csv then plot histogram of sales"), NODE_SPECS
    )
    assert result.steps, "heuristic fallback must produce steps"
    print("ok: planner JSON extraction + fallback")


def test_retriever_scoring() -> None:
    cases = [
        (PlanStep(title="Load tabular data", intent="read csv source", io_type="source_to_df"), "read_csv"),
        (PlanStep(title="Load geospatial file", intent="read shapefile", io_type="source_to_df"), "geofile_reader"),
        (PlanStep(title="Render map", intent="folium map visualization", io_type="df_to_html"), "geomap"),
        (PlanStep(title="Plot histogram", intent="distribution chart", io_type="df_to_html"), "histogram"),
        (PlanStep(title="Aggregate metrics", intent="group and aggregate", io_type="df_to_df"), "groupby"),
        (PlanStep(title="Filter rows", intent="subset records where value > x", io_type="df_to_df"), "row_filter"),
    ]
    for step, expected in cases:
        spec, score = retrieve_best(step, NODE_SPECS)
        assert spec is not None and spec.id == expected, f"{step.title}: got {spec.id if spec else None} ({score:.2f})"
    print("ok: retriever picks the right builtin for every step kind")


def test_temp_node_code_safety() -> None:
    assert scan_generated_code("import subprocess\nsubprocess.run(['rm'])")
    assert not scan_generated_code("df_out = df_in.dropna()")
    step = PlanStep(
        title="Custom clean",
        intent="drop nulls",
        io_type="df_to_df",
        code="df_out = df_in.dropna()",
    )
    spec = build_temp_node_spec(step, "prompt", 0)
    assert "dropna" in spec.default_code
    assert spec.provenance and spec.provenance["source"] == "planner_generated_code"

    bad = PlanStep(title="Evil", intent="x", io_type="df_to_df", code="import subprocess")
    warnings: list[str] = []
    spec = build_temp_node_spec(bad, "prompt", 1, warnings=warnings)
    assert "subprocess" not in spec.default_code and warnings
    print("ok: temp node factory uses safe generated code, rejects banned patterns")


def test_notebook_standardizer_dataflow() -> None:
    cells = [
        NotebookCell(source="import pandas as pd\nimport numpy as np"),
        NotebookCell(source="%matplotlib inline\ndf = pd.DataFrame({'a': [1, 1, 2], 'b': [3.0, 4.0, 5.0]})"),
        NotebookCell(source="df2 = df.groupby('a')['b'].sum().reset_index()"),
        NotebookCell(source="summary = df.describe()"),
    ]
    workflow, generated, warnings = standardize_notebook(None, cells)
    assert len(workflow.nodes) == 3, [n.label for n in workflow.nodes]  # import cell merged

    by_target = {e.target: e.source for e in workflow.edges}
    # df2 (node 2) and summary (node 3) must BOTH hang off the df producer (node 1) — real dataflow, not a chain.
    assert by_target.get("nb_2") == "nb_1"
    assert by_target.get("nb_3") == "nb_1", f"expected branch, got {workflow.edges}"

    # Wrapped code bridges names: the groupby node maps df_in->df and df2->df_out.
    groupby_node = workflow.nodes[1]
    assert "df = df_in" in groupby_node.code and "df_out = df2" in groupby_node.code, groupby_node.code

    # And the whole imported workflow actually runs.
    store = DataStore()
    status, outputs, logs, err_id, msg = run_workflow(
        workflow.nodes, workflow.edges, store, Path(tempfile.mkdtemp())
    )
    assert status == "success", f"{err_id}: {msg}"
    df2 = store.get_df_for_node("nb_2")
    assert df2 is not None and df2["b"].tolist() == [7.0, 5.0]
    print("ok: notebook standardizer produces a runnable branched DAG")


def test_notebook_read_csv_param_extraction() -> None:
    with tempfile.TemporaryDirectory() as td:
        csv_path = Path(td) / "sales.csv"
        csv_path.write_text("region,sales\nnorth,10\nsouth,20\n")
        cells = [
            NotebookCell(source=f"import pandas as pd\ndf = pd.read_csv('{csv_path}')"),
            NotebookCell(source="top = df.sort_values('sales', ascending=False).head(1)"),
        ]
        workflow, _, _ = standardize_notebook(None, cells)
        assert workflow.nodes[0].type == "read_csv"
        assert workflow.nodes[0].params["file_path"] == str(csv_path)
        store = DataStore()
        status, _, logs, err_id, msg = run_workflow(
            workflow.nodes, workflow.edges, store, Path(tempfile.mkdtemp())
        )
        assert status == "success", f"{err_id}: {msg}"
        top = store.get_df_for_node("nb_2")
        assert top is not None and top.iloc[0]["region"] == "south"
    print("ok: read_csv cell maps to builtin node with extracted file_path and runs")


def test_multi_input_ports() -> None:
    """Two-input join via df_in_2 port + df_ins list ordering + cache invalidation per port."""
    nodes = [
        WorkflowNode(id="L", type="custom", label="Left",
                     code="df_out = pd.DataFrame({'k': [1, 2, 3], 'a': [10, 20, 30]})"),
        WorkflowNode(id="R", type="custom", label="Right",
                     code="df_out = pd.DataFrame({'k': [1, 2], 'b': ['x', 'y']})"),
        WorkflowNode(id="J", type="custom", label="Join",
                     code="df_out = df_in.merge(df_in_2, on='k', how='inner')"),
        WorkflowNode(id="N", type="custom", label="CountInputs",
                     code="df_out = pd.DataFrame({'n': [sum(1 for d in df_ins if d is not None)]})"),
    ]
    edges = [
        WorkflowEdge(id="e1", source="L", target="J", targetHandle="df_in"),
        WorkflowEdge(id="e2", source="R", target="J", targetHandle="df_in_2"),
        WorkflowEdge(id="e3", source="L", target="N", targetHandle="df_in"),
        WorkflowEdge(id="e4", source="R", target="N", targetHandle="df_in_2"),
        WorkflowEdge(id="e5", source="J", target="N", targetHandle="df_in_3"),
    ]
    store = DataStore()
    cache = ResultCache()
    status, outputs, logs, err_id, msg = run_workflow(
        nodes, edges, store, Path(tempfile.mkdtemp()), cache=cache
    )
    assert status == "success", f"{err_id}: {msg}"
    joined = store.get_df_for_node("J")
    assert joined is not None and len(joined) == 2 and list(joined.columns) == ["k", "a", "b"]
    counted = store.get_df_for_node("N")
    assert counted is not None and counted.iloc[0]["n"] == 3
    assert outputs["J"]["df_out"]["dtypes"]["b"] == "string"

    # Changing only the second-port upstream must invalidate the join cache.
    nodes[1].code = "df_out = pd.DataFrame({'k': [1, 2, 3], 'b': ['x', 'y', 'z']})"
    status, outputs, _, _, _ = run_workflow(
        nodes, edges, store, Path(tempfile.mkdtemp()), cache=cache
    )
    assert status == "success"
    assert outputs["J"]["cached"] is False
    joined = store.get_df_for_node("J")
    assert joined is not None and len(joined) == 3
    print("ok: multi-input ports (df_in_2/df_in_3, df_ins, per-port cache invalidation)")


if __name__ == "__main__":
    test_engine_cache()
    test_cache_mutation_safety()
    test_planner_json_extraction_and_fallback()
    test_retriever_scoring()
    test_temp_node_code_safety()
    test_notebook_standardizer_dataflow()
    test_notebook_read_csv_param_extraction()
    test_multi_input_ports()
    print("\nAll smoke tests passed.")
