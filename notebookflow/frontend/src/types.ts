export type NodeStatus = "idle" | "running" | "success" | "error";

export interface ParameterSpec {
  name: string;
  type: string;
  required?: boolean;
  default?: unknown;
  options?: unknown[];
}

export interface NodeSpec {
  id: string;
  name: string;
  label: string;
  category: string;
  color: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  parameters: ParameterSpec[];
  default_params: Record<string, unknown>;
  default_code: string;
  temporary?: boolean;
  provenance?: Record<string, unknown> | null;
}

export interface WorkflowNodePayload {
  id: string;
  type: string;
  label: string;
  category?: string;
  position?: { x: number; y: number };
  params: Record<string, unknown>;
  code: string;
}

export interface WorkflowEdgePayload {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface DataFrameOutputSummary {
  type: "DataFrame";
  rows: number;
  columns: string[];
  preview: Record<string, unknown>[];
}

export interface HtmlOutputSummary {
  type: "HTML";
  artifact_url: string;
}

export interface NodeOutputsEntry {
  df_out?: DataFrameOutputSummary;
  html_out?: HtmlOutputSummary;
}

export type NodeOutputsMap = Record<string, NodeOutputsEntry>;

export interface RunWorkflowResponse {
  status: "success" | "error";
  node_outputs: NodeOutputsMap;
  logs: string[];
  node_id?: string | null;
  message?: string | null;
}

export interface NotebookCellInput {
  cell_type: string;
  source: string;
}

export interface WorkflowValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface NotebookStandardizeResponse {
  workflow: {
    nodes: WorkflowNodePayload[];
    edges: WorkflowEdgePayload[];
  };
  generated_node_specs: NodeSpec[];
  warnings: string[];
  validation: WorkflowValidation;
}

export interface WorkflowPlanStep {
  title: string;
  intent: string;
  io_type: "source_to_df" | "df_to_df" | "df_to_html";
}

export interface WorkflowPlanResponse {
  steps: WorkflowPlanStep[];
  raw_model_text: string;
  warnings: string[];
}

export interface NodeSuggestion {
  step_title: string;
  chosen_node_id: string;
  confidence: number;
  reason: string;
  used_temporary: boolean;
}

export interface ComposeWorkflowResponse {
  workflow: {
    nodes: WorkflowNodePayload[];
    edges: WorkflowEdgePayload[];
  };
  generated_node_specs: NodeSpec[];
  suggestions: NodeSuggestion[];
  warnings: string[];
  validation: WorkflowValidation;
}

export interface GISArticleInput {
  title: string;
  method: string;
  inputs: string[];
  outputs: string[];
  pseudo_steps: string[];
  example_params: Record<string, unknown>;
}

export interface GISImportResponse {
  imported: number;
  node_specs: NodeSpec[];
}

export interface FlowNodeData {
  label: string;
  type: string;
  category: string;
  params: Record<string, unknown>;
  code: string;
  status: NodeStatus;
  color: string;
  showInput: boolean;
  outputHandle: "df_out" | "html_out";
}
