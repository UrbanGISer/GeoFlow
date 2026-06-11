"""Pydantic models for API and workflow payloads."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Position(BaseModel):
    x: float = 0
    y: float = 0


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    sourceHandle: str | None = "df_out"
    targetHandle: str | None = "df_in"


class WorkflowNode(BaseModel):
    id: str
    type: str
    label: str
    category: str | None = None
    position: Position | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    code: str = ""
    input_count: int | None = None  # UI port count for dynamic-input nodes


class WorkflowPayload(BaseModel):
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]


class RunWorkflowRequest(WorkflowPayload):
    use_cache: bool = True


class RunWorkflowResponse(BaseModel):
    status: str
    node_outputs: dict[str, Any] = Field(default_factory=dict)
    logs: list[str] = Field(default_factory=list)
    node_id: str | None = None
    message: str | None = None


class SingleNodeRunRequest(BaseModel):
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]
    node_id: str
    use_cache: bool = True


class HealthResponse(BaseModel):
    status: str


class UploadResponse(BaseModel):
    file_path: str
    filename: str


class ParameterSpec(BaseModel):
    name: str
    type: str
    required: bool = False
    default: Any | None = None
    options: list[Any] | None = None


class NodeSpec(BaseModel):
    id: str
    name: str
    label: str
    category: str
    color: str
    inputs: dict[str, Any]
    outputs: dict[str, Any]
    parameters: list[ParameterSpec]
    default_params: dict[str, Any]
    default_code: str
    description: str = ""  # markdown shown in the Info tab
    dynamic_inputs: bool = False  # user can add/remove input ports (+/− on node)
    temporary: bool = False
    provenance: dict[str, Any] | None = None
    cwl_hints: dict[str, Any] | None = None  # reserved for CWL export


class NotebookCell(BaseModel):
    cell_type: str = "code"
    source: str = ""


class NotebookStandardizeRequest(BaseModel):
    notebook_json: str | None = None
    cells: list[NotebookCell] = Field(default_factory=list)
    notebook_name: str | None = None


class WorkflowValidation(BaseModel):
    ok: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NotebookStandardizeResponse(BaseModel):
    workflow: WorkflowPayload
    generated_node_specs: list[NodeSpec] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    validation: WorkflowValidation


class WorkflowPlanRequest(BaseModel):
    prompt: str
    data_context: str = ""
    constraints: str = ""
    max_steps: int = 8
    ai_config: AIConfig | None = None


class PlanStep(BaseModel):
    title: str
    intent: str
    io_type: str = "df_to_df"
    # Concrete grounding produced by a catalog-aware planner:
    node_id: str | None = None  # existing library node id, if one fits
    params: dict[str, Any] = Field(default_factory=dict)  # concrete parameter values
    code: str | None = None  # generated node code when no library node fits


class WorkflowPlanResponse(BaseModel):
    steps: list[PlanStep] = Field(default_factory=list)
    raw_model_text: str = ""
    warnings: list[str] = Field(default_factory=list)


class ComposeWorkflowRequest(BaseModel):
    prompt: str
    data_context: str = ""
    constraints: str = ""
    max_steps: int = 8
    allow_temporary_nodes: bool = True
    confidence_threshold: float = 0.45
    ai_config: AIConfig | None = None


class NodeSuggestion(BaseModel):
    step_title: str
    chosen_node_id: str
    confidence: float
    reason: str
    used_temporary: bool = False


class ComposeWorkflowResponse(BaseModel):
    workflow: WorkflowPayload
    generated_node_specs: list[NodeSpec] = Field(default_factory=list)
    suggestions: list[NodeSuggestion] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    validation: WorkflowValidation


class AIConfig(BaseModel):
    """Runtime AI provider override — sent from the AI Studio settings page."""
    base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"
    api_key: str = ""
    model: str = "gemini-2.5-flash"


class NodeGenerateRequest(BaseModel):
    description: str
    category: str = "Python Script"
    ai_config: AIConfig | None = None


class NodeGenerateResponse(BaseModel):
    node_spec: NodeSpec
    warnings: list[str] = Field(default_factory=list)


class CWLExportRequest(WorkflowPayload):
    pass


class GISArticleInput(BaseModel):
    title: str
    method: str
    inputs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    pseudo_steps: list[str] = Field(default_factory=list)
    example_params: dict[str, Any] = Field(default_factory=dict)


class GISImportRequest(BaseModel):
    articles: list[GISArticleInput] = Field(default_factory=list)


class GISImportResponse(BaseModel):
    imported: int
    node_specs: list[NodeSpec] = Field(default_factory=list)
