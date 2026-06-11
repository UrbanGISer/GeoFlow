import { useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { uploadCsv } from "../api/client";
import type { FlowNodeData, NodeOutputsMap, NodeSpec } from "../types";
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
        <div className="nf-expand-modal-body">
          <CodeEditor value={code} onChange={onChange} height="100%" />
        </div>
      </div>
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
  onDelete,
  running,
}: SelectedNodePanelProps) {
  const [codeExpanded, setCodeExpanded] = useState(false);

  const cols = useMemo(
    () => (node ? upstreamColumns(edges, node.id, nodeOutputs) : []),
    [edges, node, nodeOutputs],
  );

  const paramsList = spec?.parameters ?? [];

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
          <div className="nf-node-editor-actions">
            <button type="button" className="nf-btn" onClick={onApply} disabled={running}>
              Apply
            </button>
            <button type="button" className="nf-btn nf-btn-primary" onClick={onRun} disabled={running}>
              {running ? "Running…" : "Run"}
            </button>
            <button type="button" className="nf-btn nf-btn-danger" onClick={onDelete} disabled={running}>
              Delete
            </button>
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
          <div className="nf-node-editor-section">
            <div className="nf-node-editor-h3-row">
              <h3 className="nf-node-editor-h3">Code</h3>
              <button
                type="button"
                className="nf-btn nf-btn-sm"
                title="Expand code editor"
                onClick={() => setCodeExpanded(true)}
              >
                ⤢ Expand
              </button>
            </div>
            <CodeEditor value={draftCode} onChange={onDraftCode} height="180px" />
          </div>
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
