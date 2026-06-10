# NotebookFlow

NotebookFlow is a local-first visual workflow canvas where each node is a notebook-like Python code cell.

## v0.3 highlights

- **Incremental execution (KNIME-style)**: node results are cached by content
  fingerprint (code + params + input-file mtime + upstream chain). Re-running a
  workflow only executes nodes whose inputs changed; everything else is served
  from cache. Logs show `cached` / `success in N ms` per node and a run summary.
  Send `"use_cache": false` in the run payload or call `POST /api/cache/clear`
  to force re-execution.
- **Catalog-aware AI planner**: the LLM now sees the full node library (ids, IO
  contracts, parameters) and returns concrete steps — an existing `node_id`
  with filled-in `params`, or generated node code (safety-scanned) when nothing
  fits. Fenced/chatty JSON replies are parsed robustly instead of silently
  falling back to heuristics.
- **AST-based notebook import**: edges follow real variable dataflow (branches
  preserved), notebook variable names are bridged to the `df_in`/`df_out`
  convention so imported workflows run as-is, import-only cells are merged, and
  IPython magics are stripped.

See [docs/next-gen-architecture.md](../docs/next-gen-architecture.md) for the
diagnosis behind these changes and the longer-term roadmap.

## v0.2 AI workflow MVP scope

- Tabular + geospatial workflows (pandas / geopandas)
- Runs on your machine using your local Python environment
- Prompt-to-workflow planning and composition
- Notebook-to-workflow standardization
- GIS research article ingestion into candidate node library
- Hybrid strategy for generation: library-first + temporary node fallback

## Execution convention

Each node runs Python with:

- `df_in` — input `DataFrame` from the upstream node (if any)
- `params` — dictionary of parameters edited in the UI
- `df_out` — optional `DataFrame` output for downstream nodes
- `html_out` — optional HTML string (e.g. Plotly figures for charts)

Downstream nodes receive the upstream `df_out` as `df_in`.

## Security warning

**NotebookFlow executes arbitrary Python code from workflow nodes.** Do not expose the backend to the public internet. Use it only in a trusted local environment.

## Project layout

```text
notebookflow/
  backend/          # FastAPI + pandas + plotly
  frontend/         # React + Vite + @xyflow/react + Monaco
  examples/         # Sample CSV data
```

## Backend setup

```bash
cd notebookflow/backend
python -m venv .venv
```

Activate the virtual environment:

- **Windows (PowerShell):** `.venv\Scripts\Activate.ps1`
- **macOS / Linux:** `source .venv/bin/activate`

Then:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API listens at `http://localhost:8000`.

### Optional AI planner configuration

The planner uses OpenAI-compatible chat completion APIs (Gemini / DeepSeek compatible gateway).

Set environment variables before backend start:

```bash
AI_API_BASE_URL=<your-compatible-base-url>
AI_API_KEY=<your-api-key>
AI_MODEL=<model-name>
AI_TIMEOUT_SECONDS=60   # optional, request timeout for the planner call
```

If not configured (or provider fails), NotebookFlow automatically falls back to deterministic rule-based planning. Planner warnings in the response tell you which path was used.

## Frontend setup

```bash
cd notebookflow/frontend
npm install
npm run dev
```

The dev server proxies `/api` to `http://127.0.0.1:8000`. Open the printed local URL (typically `http://localhost:5173`).

`npm run preview` also proxies `/api` to port 8000 (see `vite.config.ts`).

If you still see **Failed to fetch** (e.g. custom port, or opening built files without proxy), create `notebookflow/frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Then restart `npm run dev` or `npm run preview`. See `frontend/.env.example`.

## Demo workflow

1. Add **Read CSV**, double-click it, upload `examples/sales.csv`.
2. Add **Column Filter**, connect **Read CSV** `df_out` → **Column Filter** `df_in`, choose columns `region` and `sales`.
3. Add **GroupBy**, connect **Column Filter** → **GroupBy**, set `group_by` = `region`, `target_column` = `sales`, `aggregation` = `max`.
4. Add **Histogram**, connect **GroupBy** → **Histogram**, set `column` = `sales`.
5. Click **Run Workflow**. Use the bottom **Output Preview** on a selected node to view the table or HTML chart.

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/nodes` | Builtin + GIS imported + temporary node specs |
| POST | `/api/upload` | Upload a CSV into `backend/tmp/uploads` |
| POST | `/api/workflow/run` | Execute a workflow JSON |
| POST | `/api/node/run` | Execute upstream subgraph for one node |
| POST | `/api/notebook/standardize` | Convert notebook cells to normalized workflow draft (JSON body) |
| POST | `/api/notebook/standardize-upload` | Same as above; upload raw `.ipynb` as multipart field `notebook` (preferred from UI) |
| POST | `/api/workflow/plan` | Generate planning steps from prompt |
| POST | `/api/workflow/compose` | Compose executable workflow (library-first + temporary fallback) |
| POST | `/api/library/gis/import` | Ingest structured GIS article records to node candidates |
| POST | `/api/cache/clear` | Drop cached node results (force full re-execution) |
| GET | `/api/artifacts/{filename}` | Serve generated HTML artifacts |

## Backend tests

```bash
cd notebookflow/backend
python tests/test_smoke.py
```

Covers: fingerprint cache hits/invalidation, cache mutation safety, planner
JSON extraction, retriever scoring, temp-node code safety scan, and end-to-end
execution of standardized notebooks.

## AI workflow features

### 1) Notebook standardization
- Use **Notebook to Flow** in toolbar.
- Choose a local `.ipynb` file, then click **Standardize**.
- Import limits (stability): first **200** code cells; each cell source capped at **~120k** characters (truncated with a warning).
- If Vite logs **`http proxy error` / `ECONNRESET`** on `/api/notebook/standardize-upload`, restart **`npm run dev`** after updating (older proxy `timeout` options were removed). If it persists, set `VITE_API_BASE_URL=http://127.0.0.1:8000` in `frontend/.env.local` to bypass the Vite proxy.
- If a **small** notebook still errors, the UI should show the backend **`detail`** message when the server returns JSON (422). If you only see `ECONNRESET`, the connection died before a response (see above).
- Backend converts code cells to a node DAG using heuristics and creates temporary nodes for unmatched cells.

### 2) Prompt-driven planning and composition
- Use **AI Workflow Builder** in sidebar.
- `Plan`: preview proposed analysis steps.
- `Compose`: generate workflow directly on canvas.

### 3) Library-first + temporary fallback
- Composer attempts to map each plan step to existing node specs.
- If confidence is below threshold, a temporary node is generated (clearly marked in category/label).

### 4) GIS article ingestion
- Click **Seed GIS Nodes** to import an example GIS research node.
- Imported GIS nodes are exposed through `/api/nodes` and can be chosen during composition.
