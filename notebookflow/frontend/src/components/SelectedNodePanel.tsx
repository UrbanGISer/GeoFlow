import { useEffect, useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { generateCode, uploadCsv } from "../api/client";
import type { FlowNodeData, NodeOutputsMap, NodeSpec } from "../types";
import { loadAIConfig } from "../types";
import { CodeEditor } from "./CodeEditor";
import { ParameterEditor } from "./ParameterEditor";

function upstreamColumns(
  edges: Edge[],
  nodeId: string,
  outputs: NodeOutputsMap,
): string[] {
  const incoming = edges.find(
    (e) => e.target === nodeId && (e.targetHandle === "df_in" || !e.targetHandle),
  );
  if (!incoming) return [];
  return outputs[incoming.source]?.df_out?.columns ?? [];
}

/** Node types that get the in-panel AI Coding helper. */
const AI_CODING_TYPES = new Set(["python_script_data", "python_script_html"]);

interface SelectedNodePanelProps {
  node: Node<FlowNodeData> | null;
  spec: NodeSpec | undefined;
  edges: Edge[];
  nodeOutputs: NodeOutputsMap;
  draftParams: Record<string, unknown>;
  draftCode: string;
  onDraftParams: (p: Record<string, unknown>) => void;
  onDraftCode: (code: string) => void;
  onApply: () => void;
  onRun: () => void;
  onReset?: () => void;
  onDelete: () => void;
  running?: boolean;
}

function CodeExpandModal({
  code,
  onChange,
  onClose,
}: {
  code: string;
  onChange: (c: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="nf-modal-overlay">
      <button type="button" className="nf-modal-backdrop" onClick={onClose} aria-label="Close" />
      <div className="nf-modal nf-expand-modal" style={{ zIndex: 3 }}>
        <div className="nf-modal-header">
          <h2 style={{ margin: 0, fontSize: 16 }}>Code Editor</h2>
          <button type="button" className="nf-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="nf-expand-modal-body nf-expand-code-body">
          {/* Monaco needs a concrete height — 100% inside an auto-height
              wrapper collapses to nothing. */}
          <CodeEditor value={code} onChange={onChange} height="calc(92vh - 140px)" />
        </div>
      </div>
    </div>
  );
}

function AICodingSection({
  mode,
  currentCode,
  upstreamCols,
  onCode,
}: {
  mode: "data" | "html";
  currentCode: string;
  upstreamCols: string[];
  onCode: (code: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  const handleGenerate = async () => {
    const cfg = loadAIConfig();
    if (!cfg.api_key) {
      setMsg({ text: "Set your API key in the left panel's AI tab first.", error: true });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await generateCode({
        description: prompt,
        mode,
        current_code: currentCode,
        data_context: upstreamCols.length ? `Upstream columns: ${upstreamCols.join(", ")}` : "",
        ai_config: cfg,
      });
      onCode(res.code);
      setMsg({
        text: res.warnings.length ? res.warnings.join("; ") : "Code generated — review, then Apply / Run.",
        error: false,
      });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nf-node-editor-section nf-ai-coding">
      <h3 className="nf-node-editor-h3">✦ AI Coding</h3>
      <textarea
        className="nf-textarea"
        rows={3}
        placeholder={
          mode === "html"
            ? "Describe the view, e.g. plot a bar chart of sales by region with plotly"
            : "Describe the transformation, e.g. add a column profit = revenue - cost, drop rows with nulls"
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <button
        type="button"
        className="nf-btn nf-btn-sm nf-btn-primary"
        disabled={busy || !prompt.trim()}
        onClick={() => void handleGenerate()}
      >
        {busy ? "Generating…" : "Generate Code"}
      </button>
      {msg ? (
        <p className={msg.error ? "nf-error-text" : "nf-muted"} style={{ marginTop: 6, fontSize: 12 }}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

export function SelectedNodePanel({
  node,
  spec,
  edges,
  nodeOutputs,
  draftParams,
  draftCode,
  onDraftParams,
  onDraftCode,
  onApply,
  onRun,
  onReset,
  onDelete,
  running,
}: SelectedNodePanelProps) {
  // Code section: folded by default; "open" inline; "expand" = fullscreen modal.
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeExpanded, setCodeExpanded] = useState(false);

  // New node selection → back to folded.
  useEffect(() => {
    setCodeOpen(false);
    setCodeExpanded(false);
  }, [node?.id]);

  const cols = useMemo(
    () => (node ? upstreamColumns(edges, node.id, nodeOutputs) : []),
    [edges, node, nodeOutputs],
  );

  const paramsList = spec?.parameters ?? [];
  const aiCoding = node ? AI_CODING_TYPES.has(node.data.type) : false;
  const aiMode: "data" | "html" = node?.data.type === "python_script_html" ? "html" : "data";

  if (!node) {
    return (
      <section className="nf-bottom-panel nf-bottom-editor nf-node-editor-empty">
        <div className="nf-bottom-head">
          <h2 className="nf-panel-title">Node</h2>
        </div>
        <div className="nf-bottom-body nf-node-editor-placeholder">
          <p className="nf-muted">Select a node on the canvas to edit parameters and code.</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="nf-bottom-panel nf-bottom-editor">
        <div className="nf-bottom-head nf-node-editor-toolbar">
          <div className="nf-node-editor-title">
            <h2 className="nf-panel-title">{node.data.label}</h2>
            <span className="nf-muted nf-node-editor-type">{spec?.label ?? node.data.type}</span>
          </div>
        </div>
        <div className="nf-node-editor-scroll">
          <div className="nf-node-editor-section">
            <h3 className="nf-node-editor-h3">Parameters</h3>
            <ParameterEditor
              parameters={paramsList}
              params={draftParams}
              upstreamColumns={cols}
              onChange={onDraftParams}
              onUploadFile={async (file) => {
                const res = await uploadCsv(file);
                onDraftParams({ ...draftParams, file_path: res.file_path });
              }}
            />
          </div>
          {aiCoding ? (
            <AICodingSection
              mode={aiMode}
              currentCode={draftCode}
              upstreamCols={cols}
              onCode={(code) => {
                onDraftCode(code);
                setCodeOpen(true); // show the result
              }}
            />
          ) : null}
          <div className="nf-node-editor-section">
            <div className="nf-node-editor-h3-row">
              <button
                type="button"
                className="nf-code-fold-toggle"
                title={codeOpen ? "Fold code" : "Show code"}
                onClick={() => setCodeOpen((v) => !v)}
              >
                <span className="nf-group-arrow">{codeOpen ? "▾" : "▸"}</span>
                <h3 className="nf-node-editor-h3" style={{ margin: 0 }}>Code</h3>
              </button>
              <button
                type="button"
                className="nf-btn nf-btn-sm"
                title="Expand code editor"
                onClick={() => setCodeExpanded(true)}
              >
                ⤢ Expand
              </button>
            </div>
            {codeOpen ? (
              <CodeEditor value={draftCode} onChange={onDraftCode} height="180px" />
            ) : (
              <button
                type="button"
                className="nf-code-folded-hint"
                onClick={() => setCodeOpen(true)}
              >
                {draftCode.split("\n").length} lines — click to show
              </button>
            )}
          </div>
        </div>
        {/* KNIME-style action bar at the bottom of the configure panel. */}
        <div className="nf-node-editor-footer">
          <button type="button" className="nf-btn" onClick={onApply} disabled={running}>
            Apply
          </button>
          <button type="button" className="nf-btn nf-btn-primary" onClick={onRun} disabled={running}>
            {running ? "Running…" : "Run"}
          </button>
          {onReset ? (
            <button type="button" className="nf-btn" onClick={onReset} disabled={running}>
              Reset
            </button>
          ) : null}
          <button type="button" className="nf-btn nf-btn-danger" onClick={onDelete} disabled={running}>
            Delete
          </button>
        </div>
      </section>
      {codeExpanded ? (
        <CodeExpandModal
          code={draftCode}
          onChange={onDraftCode}
          onClose={() => setCodeExpanded(false)}
        />
      ) : null}
    </>
  );
}
