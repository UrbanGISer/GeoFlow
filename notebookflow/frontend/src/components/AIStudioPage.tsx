import { useState } from "react";
import { composeWorkflow, generateNode, planWorkflow } from "../api/client";
import type { AIConfig, ComposeWorkflowResponse, NotebookStandardizeResponse } from "../types";
import { loadAIConfig } from "../types";
import { AISettingsPanel } from "./AISettingsPanel";
import { NotebookImportModal } from "./NotebookImportModal";

type AITab = "builder" | "creator" | "notebook";

interface AIStudioPageProps {
  onClose: () => void;
  onComposed: (res: ComposeWorkflowResponse) => void;
  onNotebookApply: (res: NotebookStandardizeResponse) => void;
  onNodeSpecCreated: (spec: import("../types").NodeSpec) => void;
}

function WorkflowBuilderTab({ aiConfig, onComposed }: { aiConfig: AIConfig; onComposed: (r: ComposeWorkflowResponse) => void }) {
  const [prompt, setPrompt] = useState("");
  const [dataContext, setDataContext] = useState("");
  const [constraints, setConstraints] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [planSteps, setPlanSteps] = useState<Array<{ title: string; intent: string }> | null>(null);

  const ai = aiConfig.api_key ? aiConfig : null;

  return (
    <div className="nf-ai-tool-tab">
      <p className="nf-ai-tool-desc">
        Describe your analysis goal in natural language. The AI planner builds a complete workflow with connected nodes.
      </p>
      <div className="nf-field">
        <label className="nf-field-label">Analysis Goal <span className="nf-required">*</span></label>
        <textarea
          className="nf-textarea"
          rows={4}
          placeholder="e.g. Load a CSV of city coordinates, filter to Europe, compute a buffer of 10km around each point, and show a map"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div className="nf-field">
        <label className="nf-field-label">Data Context</label>
        <textarea
          className="nf-textarea"
          rows={2}
          placeholder="e.g. File: cities.csv, columns: name, lat, lon, population"
          value={dataContext}
          onChange={(e) => setDataContext(e.target.value)}
        />
      </div>
      <div className="nf-field">
        <label className="nf-field-label">Constraints</label>
        <textarea
          className="nf-textarea"
          rows={2}
          placeholder="e.g. Use only built-in nodes, max 5 steps"
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
        />
      </div>
      <div className="nf-modal-actions-row">
        <button
          type="button"
          className="nf-btn"
          disabled={busy || !prompt.trim()}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            setPlanSteps(null);
            try {
              const p = await planWorkflow({ prompt, data_context: dataContext, constraints, max_steps: 8, ai_config: ai });
              setPlanSteps(p.steps);
              if (p.warnings.length) setMsg({ text: p.warnings.join("; "), error: false });
            } catch (e) {
              setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Planning…" : "Preview Plan"}
        </button>
        <button
          type="button"
          className="nf-btn nf-btn-primary"
          disabled={busy || !prompt.trim()}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const res = await composeWorkflow({ prompt, data_context: dataContext, constraints, max_steps: 8, allow_temporary_nodes: true, confidence_threshold: 0.45, ai_config: ai });
              onComposed(res);
              setMsg({ text: "Workflow applied to canvas!", error: false });
            } catch (e) {
              setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Composing…" : "Compose & Apply"}
        </button>
      </div>
      {msg ? (
        <p className={msg.error ? "nf-error-text" : "nf-muted"} style={{ marginTop: 8 }}>{msg.text}</p>
      ) : null}
      {planSteps ? (
        <div className="nf-ai-plan">
          <strong>Planned Steps</strong>
          <ol>
            {planSteps.map((s, i) => (
              <li key={`step-${i}`}><b>{s.title}</b> — {s.intent}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function NodeCreatorTab({ aiConfig, onNodeSpecCreated }: { aiConfig: AIConfig; onNodeSpecCreated: (spec: import("../types").NodeSpec) => void }) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Python Script");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [result, setResult] = useState<{ label: string; warnings: string[] } | null>(null);

  const ai = aiConfig.api_key ? aiConfig : null;

  return (
    <div className="nf-ai-tool-tab">
      <p className="nf-ai-tool-desc">
        Describe a custom node and let the AI write the Python code for it. The node is added to your library immediately.
      </p>
      <div className="nf-field">
        <label className="nf-field-label">Node Description <span className="nf-required">*</span></label>
        <textarea
          className="nf-textarea"
          rows={4}
          placeholder="e.g. Calculate NDVI from a raster DataFrame with 'nir' and 'red' columns, output a new column 'ndvi'"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="nf-field">
        <label className="nf-field-label">Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {["Input", "Transform", "GIS", "Visualization", "Nature View", "Python Script"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="nf-modal-actions-row">
        <button
          type="button"
          className="nf-btn nf-btn-primary"
          disabled={busy || !description.trim() || !ai}
          onClick={async () => {
            if (!ai) { setMsg({ text: "Set your API key in Settings above.", error: true }); return; }
            setBusy(true);
            setMsg(null);
            setResult(null);
            try {
              const res = await generateNode({ description, category, ai_config: ai });
              onNodeSpecCreated(res.node_spec);
              setResult({ label: res.node_spec.label, warnings: res.warnings });
              setMsg({ text: `Node "${res.node_spec.label}" added to library.`, error: false });
            } catch (e) {
              setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Generating…" : "Generate Node"}
        </button>
        {!ai ? <span className="nf-muted" style={{ fontSize: 12 }}>Requires API key in Settings</span> : null}
      </div>
      {msg ? (
        <p className={msg.error ? "nf-error-text" : "nf-muted"} style={{ marginTop: 8 }}>{msg.text}</p>
      ) : null}
      {result?.warnings.length ? (
        <ul className="nf-warn-list">
          {result.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function NotebookToFlowTab({ onApply }: { onApply: (res: NotebookStandardizeResponse) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="nf-ai-tool-tab">
      <p className="nf-ai-tool-desc">
        Import a Jupyter notebook (.ipynb) and convert it into a visual workflow. Each cell becomes a node with real dataflow edges.
      </p>
      <button type="button" className="nf-btn nf-btn-primary" onClick={() => setOpen(true)}>
        Open Notebook Importer
      </button>
      <NotebookImportModal
        open={open}
        onClose={() => setOpen(false)}
        onApply={(res) => {
          onApply(res);
          setOpen(false);
        }}
      />
    </div>
  );
}

export function AIStudioPage({ onClose, onComposed, onNotebookApply, onNodeSpecCreated }: AIStudioPageProps) {
  const [activeTab, setActiveTab] = useState<AITab>("builder");
  const [config, setConfig] = useState<AIConfig>(() => loadAIConfig());

  const handleConfigChange = (c: AIConfig) => {
    setConfig(c);
  };

  const tabs: Array<{ id: AITab; label: string }> = [
    { id: "builder", label: "AI Workflow Builder" },
    { id: "creator", label: "AI Node Creator" },
    { id: "notebook", label: "Notebook to Flow" },
  ];

  return (
    <div className="nf-ai-studio-overlay">
      <div className="nf-ai-studio-page">
        <div className="nf-ai-studio-header">
          <div>
            <h1 className="nf-ai-studio-title">AI Studio</h1>
            <p className="nf-ai-studio-subtitle">Build workflows, generate nodes, and import notebooks with AI assistance</p>
          </div>
          <button type="button" className="nf-btn" onClick={onClose}>
            ← Back to Canvas
          </button>
        </div>

        <AISettingsPanel config={config} onChange={handleConfigChange} />

        <div className="nf-ai-studio-tools">
          <div className="nf-tab-bar">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`nf-tab-btn${activeTab === t.id ? " nf-tab-btn-active" : ""}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="nf-tab-content">
            {activeTab === "builder" ? (
              <WorkflowBuilderTab
                aiConfig={config}
                onComposed={(res) => {
                  onComposed(res);
                  onClose();
                }}
              />
            ) : null}
            {activeTab === "creator" ? (
              <NodeCreatorTab
                aiConfig={config}
                onNodeSpecCreated={onNodeSpecCreated}
              />
            ) : null}
            {activeTab === "notebook" ? (
              <NotebookToFlowTab
                onApply={(res) => {
                  onNotebookApply(res);
                  onClose();
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
