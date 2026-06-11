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
  description?: string;
  dynamic_inputs?: boolean;
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
  input_count?: number;
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
  dtypes?: Record<string, string>;
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

export interface AIConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
  api_key: "",
  model: "gemini-2.5-flash",
};

export const AI_CONFIG_STORAGE_KEY = "geoflow.aiConfig.v1";

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (raw) return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_AI_CONFIG };
}

export function saveAIConfig(cfg: AIConfig): void {
  localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
}

export interface NodeGenerateResponse {
  node_spec: NodeSpec;
  warnings: string[];
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
  /** Index signature so Node<FlowNodeData> satisfies xyflow's Record constraint. */
  [key: string]: unknown;
  label: string;
  type: string;
  category: string;
  params: Record<string, unknown>;
  code: string;
  status: NodeStatus;
  color: string;
  showInput: boolean;
  outputHandle: "df_out" | "html_out";
  /** False for view-only nodes (html_out only) — no downstream data to connect */
  showOutput?: boolean;
  /** Number of input ports (1 = just df_in, 2 = df_in + df_in_2, …) */
  inputCount?: number;
  /** User may add/remove input ports via +/− on the node */
  dynamicInputs?: boolean;
}

/** Port handle id for the n-th input (1-based): df_in, df_in_2, df_in_3, … */
export function inputHandleId(index: number): string {
  return index <= 1 ? "df_in" : `df_in_${index}`;
}
