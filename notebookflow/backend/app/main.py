"""FastAPI entrypoint for NotebookFlow."""

from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response

from app.data_store import DataStore, ResultCache
from app.default_nodes import DEFAULT_NODE_SPECS
from app.models import (
    CodeGenerateRequest,
    CodeGenerateResponse,
    ComposeWorkflowRequest,
    ComposeWorkflowResponse,
    CWLExportRequest,
    GISImportRequest,
    GISImportResponse,
    HealthResponse,
    NodeGenerateRequest,
    NodeGenerateResponse,
    NotebookCell,
    NotebookStandardizeRequest,
    NotebookStandardizeResponse,
    RunWorkflowRequest,
    RunWorkflowResponse,
    SingleNodeRunRequest,
    UploadResponse,
    WorkflowPlanRequest,
    WorkflowPlanResponse,
)
from app.registry import add_gis_specs, add_temporary_specs, list_all_dynamic_specs
from app.services import workspace as ws
from app.services.cwl_exporter import export_cwl
from app.services.gis_ingest import ingest_articles_to_specs
from app.services.node_generator import generate_code, generate_node
from app.services.notebook_exporter import export_ipynb
from app.services.notebook_standardizer import standardize_notebook
from app.services.planner import plan_workflow
from app.services.workflow_composer import compose_workflow
from app.services.workflow_validator import validate_workflow
from app.workflow_engine import run_single_node, run_workflow

BASE_DIR = Path(__file__).resolve().parent.parent
TMP_UPLOADS = BASE_DIR / "tmp" / "uploads"
TMP_ARTIFACTS = BASE_DIR / "tmp" / "artifacts"

app = FastAPI(title="NotebookFlow", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_store = DataStore()
_result_cache = ResultCache()


def _notebook_standardize_json_response(
    notebook_json: str | None,
    cells: list[NotebookCell] | None = None,
) -> Response:
    """Build JSON in one shot (avoids mid-stream encode failures that show as ECONNRESET behind Vite proxy)."""
    try:
        workflow, generated, warnings = standardize_notebook(notebook_json, cells or [])
        if generated:
            add_temporary_specs(generated)
        validation = validate_workflow(workflow, [*DEFAULT_NODE_SPECS, *list_all_dynamic_specs(), *generated])
        resp = NotebookStandardizeResponse(
            workflow=workflow,
            generated_node_specs=generated,
            warnings=warnings,
            validation=validation,
        )
        payload = jsonable_encoder(resp)
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False, default=str)
        return Response(
            content=body.encode("utf-8"),
            media_type="application/json; charset=utf-8",
        )
    except HTTPException:
        raise
    except (TypeError, ValueError) as e:
        raise HTTPException(
            status_code=422,
            detail=f"Notebook standardize serialization failed: {e}",
        ) from e
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Notebook standardize failed: {e}") from e


@app.get("/")
def root() -> dict[str, str]:
    """Landing page for browsers that open http://127.0.0.1:8000/"""
    return {
        "service": "NotebookFlow API",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/api/health",
        "nodes": "/api/nodes",
    }


@app.on_event("startup")
def _startup() -> None:
    import os
    os.environ.setdefault("MPLBACKEND", "Agg")
    TMP_UPLOADS.mkdir(parents=True, exist_ok=True)
    TMP_ARTIFACTS.mkdir(parents=True, exist_ok=True)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/api/nodes")
def list_nodes() -> list[dict]:
    all_specs = [*DEFAULT_NODE_SPECS, *list_all_dynamic_specs()]
    return [spec.model_dump() for spec in all_specs]


@app.post("/api/upload", response_model=UploadResponse)
async def upload(file: UploadFile = File(...)) -> UploadResponse:
    TMP_UPLOADS.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or "upload.csv").name
    dest = TMP_UPLOADS / safe_name
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    # If user uploads a zipped shapefile bundle, extract and return the .shp path.
    if dest.suffix.lower() == ".zip":
        extract_dir = TMP_UPLOADS / dest.stem
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(dest, "r") as zf:
            zf.extractall(extract_dir)
        shp_files = list(extract_dir.rglob("*.shp"))
        if shp_files:
            shp_path = str(shp_files[0].resolve())
            return UploadResponse(file_path=shp_path, filename=shp_files[0].name)

    abs_path = str(dest.resolve())
    return UploadResponse(file_path=abs_path, filename=safe_name)


@app.post("/api/workflow/run", response_model=RunWorkflowResponse)
def run_workflow_endpoint(payload: RunWorkflowRequest) -> RunWorkflowResponse:
    status, node_outputs, logs, err_id, msg = run_workflow(
        payload.nodes,
        payload.edges,
        _store,
        TMP_ARTIFACTS,
        cache=_result_cache,
        use_cache=payload.use_cache,
    )
    if status == "error":
        return RunWorkflowResponse(
            status="error",
            node_id=err_id,
            message=msg or "Unknown error",
            node_outputs=node_outputs,
            logs=logs,
        )
    return RunWorkflowResponse(status="success", node_outputs=node_outputs, logs=logs)


@app.post("/api/node/run", response_model=RunWorkflowResponse)
def run_node_endpoint(payload: SingleNodeRunRequest) -> RunWorkflowResponse:
    status, node_outputs, logs, err_id, msg = run_single_node(
        payload.nodes,
        payload.edges,
        payload.node_id,
        _store,
        TMP_ARTIFACTS,
        cache=_result_cache,
        use_cache=payload.use_cache,
    )
    if status == "error":
        return RunWorkflowResponse(
            status="error",
            node_id=err_id,
            message=msg or "Unknown error",
            node_outputs=node_outputs,
            logs=logs,
        )
    return RunWorkflowResponse(status="success", node_outputs=node_outputs, logs=logs)


@app.post("/api/notebook/standardize")
def standardize_notebook_endpoint(payload: NotebookStandardizeRequest) -> Response:
    return _notebook_standardize_json_response(payload.notebook_json, payload.cells)


@app.post("/api/notebook/standardize-upload")
async def standardize_notebook_upload(notebook: UploadFile = File(...)) -> Response:
    """Upload raw .ipynb bytes (multipart). Prefer this over JSON body for large notebooks."""
    raw = await notebook.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Empty notebook file.")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    text = text.lstrip("\ufeff").replace("\x00", "")
    return _notebook_standardize_json_response(text, [])


@app.post("/api/workflow/plan", response_model=WorkflowPlanResponse)
def plan_workflow_endpoint(payload: WorkflowPlanRequest) -> WorkflowPlanResponse:
    specs = [*DEFAULT_NODE_SPECS, *list_all_dynamic_specs()]
    planned = plan_workflow(payload, specs)
    return WorkflowPlanResponse(steps=planned.steps, raw_model_text=planned.raw_text, warnings=planned.warnings)


@app.post("/api/cache/clear")
def clear_result_cache() -> dict[str, str]:
    """Drop all cached node results (force full re-execution on next run)."""
    _result_cache.clear()
    return {"status": "cleared"}


@app.post("/api/workflow/compose", response_model=ComposeWorkflowResponse)
def compose_workflow_endpoint(payload: ComposeWorkflowRequest) -> ComposeWorkflowResponse:
    specs = [*DEFAULT_NODE_SPECS, *list_all_dynamic_specs()]
    composed = compose_workflow(payload, specs)
    if composed.generated_node_specs:
        add_temporary_specs(composed.generated_node_specs)
    return composed


@app.post("/api/library/gis/import", response_model=GISImportResponse)
def gis_import_endpoint(payload: GISImportRequest) -> GISImportResponse:
    specs = ingest_articles_to_specs(payload.articles)
    add_gis_specs(specs)
    return GISImportResponse(imported=len(specs), node_specs=specs)


@app.get("/api/artifacts/{filename}")
def get_artifact(filename: str) -> FileResponse:
    safe = Path(filename).name
    path = TMP_ARTIFACTS / safe
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")
    return FileResponse(path, media_type="text/html; charset=utf-8")


@app.post("/api/node/generate", response_model=NodeGenerateResponse)
def node_generate_endpoint(payload: NodeGenerateRequest) -> NodeGenerateResponse:
    """AI-powered node generator: describe what you want, get a runnable NodeSpec."""
    try:
        spec, warnings = generate_node(payload.description, payload.category, payload.ai_config)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    add_temporary_specs([spec])
    return NodeGenerateResponse(node_spec=spec, warnings=warnings)


@app.post("/api/code/generate", response_model=CodeGenerateResponse)
def code_generate_endpoint(payload: CodeGenerateRequest) -> CodeGenerateResponse:
    """AI Coding inside a node: generate/rewrite the node's code cell."""
    try:
        code, warnings = generate_code(
            payload.description,
            payload.mode,
            payload.current_code,
            payload.data_context,
            payload.ai_config,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return CodeGenerateResponse(code=code, warnings=warnings)


@app.post("/api/workflow/export/cwl")
def export_cwl_endpoint(payload: CWLExportRequest) -> dict:
    """Export the current workflow as a CWL v1.2 Workflow stub (interface reservation)."""
    return export_cwl(payload.nodes, payload.edges)


# ── Workspace file browser ────────────────────────────────────────────────────

def _ws_call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.get("/api/workspace/list")
def workspace_list(path: str | None = None) -> dict:
    """List a folder. No path → default workspace folder."""
    return _ws_call(ws.list_dir, path)


@app.post("/api/workspace/mkdir")
def workspace_mkdir(payload: dict) -> dict:
    return _ws_call(ws.make_dir, payload.get("parent"), payload.get("name", ""))


@app.post("/api/workspace/create-file")
def workspace_create_file(payload: dict) -> dict:
    return _ws_call(
        ws.create_file,
        payload.get("parent"),
        payload.get("name", ""),
        payload.get("content", ""),
    )


@app.post("/api/workspace/save-file")
def workspace_save_file(payload: dict) -> dict:
    """Save a text file (e.g. workflow JSON) into a workspace folder, overwriting."""
    return _ws_call(
        ws.save_file,
        payload.get("parent"),
        payload.get("name", ""),
        payload.get("content", ""),
        payload.get("overwrite", True),
    )


@app.get("/api/workspace/read")
def workspace_read(path: str) -> dict:
    """Read a text file back (e.g. open a saved workflow from the Workspace tab)."""
    return _ws_call(ws.read_file, path)


@app.post("/api/workspace/pick-folder")
def workspace_pick_folder(payload: dict) -> dict:
    """Open the native OS folder dialog (backend runs locally). 501 → no GUI."""
    try:
        return ws.pick_folder_native(payload.get("initial"))
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc


@app.post("/api/workflow/export/ipynb")
def export_ipynb_endpoint(payload: CWLExportRequest) -> dict:
    """Convert the workflow into an equivalent runnable Jupyter notebook."""
    try:
        return export_ipynb(payload.nodes, payload.edges)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/workspace/delete")
def workspace_delete(payload: dict) -> dict:
    return _ws_call(ws.delete_path, payload.get("path", ""))
