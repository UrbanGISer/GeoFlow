import type {
  AIConfig,
  ComposeWorkflowResponse,
  GISArticleInput,
  GISImportResponse,
  NodeGenerateResponse,
  NodeSpec,
  NotebookCellInput,
  NotebookStandardizeResponse,
  RunWorkflowResponse,
  WorkflowEdgePayload,
  WorkflowNodePayload,
  WorkflowPlanResponse,
} from "../types";

/** Dev default: relative `/api` (Vite proxy). Preview / custom host: set `VITE_API_BASE_URL=http://127.0.0.1:8000` in `.env.local`. */
const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const API_PREFIX = API_ORIGIN ? `${API_ORIGIN}/api` : "/api";

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Read response body as JSON; if !res.ok, throw with FastAPI `detail` when present. */
async function parseJsonWithHttpError<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text) as { detail?: string | Array<{ msg?: string }> };
      if (typeof j.detail === "string") detail = j.detail;
      else if (Array.isArray(j.detail))
        detail = j.detail.map((x) => (typeof x === "object" && x && "msg" in x ? String((x as { msg: string }).msg) : JSON.stringify(x))).join("; ");
    } catch {
      detail = text.slice(0, 400);
    }
    throw new Error(detail ? `${label}: ${res.status} — ${detail}` : `${label} failed: ${res.status}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}: invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch(`${API_PREFIX}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return parseJson(res);
}

export async function fetchNodeSpecs(): Promise<NodeSpec[]> {
  const res = await fetch(`${API_PREFIX}/nodes`);
  if (!res.ok) throw new Error(`Failed to load nodes: ${res.status}`);
  return parseJson(res);
}

export async function uploadCsv(file: File): Promise<{ file_path: string; filename: string }> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_PREFIX}/upload`, { method: "POST", body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `Upload failed: ${res.status}`);
  }
  return parseJson(res);
}

export async function runWorkflow(payload: {
  nodes: WorkflowNodePayload[];
  edges: WorkflowEdgePayload[];
}): Promise<RunWorkflowResponse> {
  const res = await fetch(`${API_PREFIX}/workflow/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<RunWorkflowResponse>(res);
  if (!res.ok && data.status !== "error") {
    throw new Error(`Run failed: ${res.status}`);
  }
  return data;
}

export async function runSingleNode(payload: {
  nodes: WorkflowNodePayload[];
  edges: WorkflowEdgePayload[];
  node_id: string;
}): Promise<RunWorkflowResponse> {
  const res = await fetch(`${API_PREFIX}/node/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<RunWorkflowResponse>(res);
  if (!res.ok && data.status !== "error") {
    throw new Error(`Node run failed: ${res.status}`);
  }
  return data;
}

export async function standardizeNotebook(payload: {
  notebook_json?: string;
  cells?: NotebookCellInput[];
  notebook_name?: string;
}): Promise<NotebookStandardizeResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/notebook/standardize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(
      API_ORIGIN
        ? `Cannot reach API at ${API_ORIGIN}. Start the backend on port 8000 and check the URL in VITE_API_BASE_URL.`
        : "Cannot reach API (network error). Start the backend (uvicorn app.main:app --reload --port 8000 in notebookflow/backend). If you use npm run preview or a non-5173 URL, create frontend/.env.local with VITE_API_BASE_URL=http://127.0.0.1:8000 and restart the dev/preview server.",
    );
  }
  if (res.status === 404) {
    throw new Error(
      "Notebook standardize returned 404: the running backend does not expose POST /api/notebook/standardize. Restart uvicorn with the latest notebookflow backend code (this is not related to AI API keys).",
    );
  }
  return parseJsonWithHttpError<NotebookStandardizeResponse>(res, "Notebook standardize");
}

/** Upload .ipynb as multipart (avoids huge JSON + proxy issues with large notebooks). */
export async function standardizeNotebookFromFile(file: File): Promise<NotebookStandardizeResponse> {
  const fd = new FormData();
  fd.append("notebook", file);
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}/notebook/standardize-upload`, {
      method: "POST",
      body: fd,
    });
  } catch {
    throw new Error(
      API_ORIGIN
        ? `Cannot reach API at ${API_ORIGIN}. Start the backend on port 8000 and check VITE_API_BASE_URL.`
        : "Cannot reach API (network error). Start the backend on port 8000. If the notebook is very large, this message can also mean the dev proxy timed out — try again after increasing timeout or use VITE_API_BASE_URL=http://127.0.0.1:8000 in frontend/.env.local (bypasses Vite proxy).",
    );
  }
  if (res.status === 404) {
    throw new Error(
      "Notebook upload returned 404: restart the backend with the latest code so POST /api/notebook/standardize-upload is registered.",
    );
  }
  return parseJsonWithHttpError<NotebookStandardizeResponse>(res, "Notebook standardize");
}

export async function planWorkflow(payload: {
  prompt: string;
  data_context?: string;
  constraints?: string;
  max_steps?: number;
  ai_config?: AIConfig | null;
}): Promise<WorkflowPlanResponse> {
  const res = await fetch(`${API_PREFIX}/workflow/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Workflow plan failed: ${res.status}`);
  return parseJson(res);
}

export async function composeWorkflow(payload: {
  prompt: string;
  data_context?: string;
  constraints?: string;
  max_steps?: number;
  allow_temporary_nodes?: boolean;
  confidence_threshold?: number;
  ai_config?: AIConfig | null;
}): Promise<ComposeWorkflowResponse> {
  const res = await fetch(`${API_PREFIX}/workflow/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Workflow compose failed: ${res.status}`);
  return parseJson(res);
}

export async function generateNode(payload: {
  description: string;
  category?: string;
  ai_config?: AIConfig | null;
}): Promise<NodeGenerateResponse> {
  const res = await fetch(`${API_PREFIX}/node/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonWithHttpError<NodeGenerateResponse>(res, "Node generate");
}

export async function importGISLibrary(payload: { articles: GISArticleInput[] }): Promise<GISImportResponse> {
  const res = await fetch(`${API_PREFIX}/library/gis/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`GIS import failed: ${res.status}`);
  return parseJson(res);
}

export function artifactUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const rel = path.startsWith("/") ? path : `/${path}`;
  if (API_ORIGIN) return `${API_ORIGIN}${rel}`;
  return rel;
}
