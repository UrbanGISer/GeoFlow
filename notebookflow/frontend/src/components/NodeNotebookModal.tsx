import { useEffect, useMemo, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { runSingleNode, uploadCsv } from "../api/client";
import type {
  FlowNodeData,
  NodeOutputsMap,
  NodeSpec,
  ParameterSpec,
  WorkflowEdgePayload,
  WorkflowNodePayload,
} from "../types";
import { CodeEditor } from "./CodeEditor";
import { OutputPreview } from "./OutputPreview";
import { ParameterEditor } from "./ParameterEditor";

interface NodeNotebookModalProps {
  open: boolean;
  node: Node<FlowNodeData> | null;
  spec: NodeSpec | undefined;
  edges: Edge[];
  nodeOutputs: NodeOutputsMap;
  lastRunLogs: string[];
  workflowPayload: () => { nodes: WorkflowNodePayload[]; edges: WorkflowEdgePayload[] };
  onClose: () => void;
  onSave: (nodeId: string, data: FlowNodeData) => void;
  onOutputsUpdate: (outputs: NodeOutputsMap, logs: string[]) => void;
  onNodeStatus: (nodeId: string, status: FlowNodeData["status"]) => void;
}

function upstreamColumnsFor(
  edges: Edge[],
  nodeId: string,
  outputs: NodeOutputsMap,
): string[] {
  const incoming = edges.find((e) => e.target === nodeId && (e.targetHandle === "df_in" || !e.targetHandle));
  if (!incoming) return [];
  const summary = outputs[incoming.source]?.df_out;
  return summary?.columns ?? [];
}

export function NodeNotebookModal({
  open,
  node,
  spec,
  edges,
  nodeOutputs,
  lastRunLogs,
  workflowPayload,
  onClose,
  onSave,
  onOutputsUpdate,
  onNodeStatus,
}: NodeNotebookModalProps) {
  const [local, setLocal] = useState<FlowNodeData | null>(null);
  const [singleRunError, setSingleRunError] = useState<string | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);

  useEffect(() => {
    if (node) {
      setLocal({ ...node.data });
      setSingleRunError(null);
      setCodeOpen(false); // code folded by default
    }
  }, [node]);

  const paramsSpec: ParameterSpec[] = spec?.parameters ?? [];

  const cols = useMemo(() => {
    if (!node) return [];
    return upstreamColumnsFor(edges, node.id, nodeOutputs);
  }, [edges, node, nodeOutputs]);

  if (!open || !node || !local) return null;

  const modalOutput = nodeOutputs[node.id];

  const persistAndClose = () => {
    onSave(node.id, local);
    onClose();
  };

  const handleRunThisNode = async () => {
    setSingleRunError(null);
    onSave(node.id, local);
    onNodeStatus(node.id, "running");
    try {
      const base = workflowPayload();
      const res = await runSingleNode({
        nodes: base.nodes,
        edges: base.edges,
        node_id: node.id,
      });
      if (res.status === "error") {
        onNodeStatus(node.id, "error");
        setSingleRunError(res.message ?? "Execution failed");
        onOutputsUpdate(res.node_outputs ?? {}, res.logs ?? []);
      } else {
        onNodeStatus(node.id, "success");
        onOutputsUpdate(res.node_outputs ?? {}, res.logs ?? []);
      }
    } catch (e) {
      onNodeStatus(node.id, "error");
      setSingleRunError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="nf-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="nn-title">
      <button type="button" className="nf-modal-backdrop" aria-label="Close" onClick={persistAndClose} />
      <div className="nf-modal">
        <header className="nf-modal-header">
          <div>
            <h2 id="nn-title">Node Notebook</h2>
            <p className="nf-modal-sub">
              <strong>{local.label}</strong>
              <span className="nf-muted"> · {spec?.label ?? local.type}</span>
              <span className="nf-muted"> · {local.category}</span>
            </p>
          </div>
          <div className="nf-modal-actions">
            <button type="button" className="nf-btn nf-btn-secondary" onClick={handleRunThisNode}>
              Run This Node
            </button>
            <button type="button" className="nf-btn" onClick={persistAndClose}>
              Close
            </button>
          </div>
        </header>

        <div className="nf-modal-body">
          <section className="nf-modal-section">
            <h3>Parameters</h3>
            <ParameterEditor
              parameters={paramsSpec}
              params={local.params}
              upstreamColumns={cols}
              onChange={(next) => setLocal({ ...local, params: next })}
              onUploadFile={async (file) => {
                const res = await uploadCsv(file);
                setLocal({
                  ...local,
                  params: { ...local.params, file_path: res.file_path },
                });
              }}
            />
          </section>

          <section className="nf-modal-section">
            <div className="nf-node-editor-h3-row">
              <button
                type="button"
                className="nf-code-fold-toggle"
                title={codeOpen ? "Fold code" : "Show code"}
                onClick={() => setCodeOpen((v) => !v)}
              >
                <span className="nf-group-arrow">{codeOpen ? "▾" : "▸"}</span>
                <h3 style={{ margin: 0 }}>Python</h3>
              </button>
            </div>
            {codeOpen ? (
              <>
                <p className="nf-help">
                  Use <code>df_in</code>, <code>params</code>, assign <code>df_out</code> and/or{" "}
                  <code>html_out</code>.
                </p>
                <CodeEditor value={local.code} onChange={(code) => setLocal({ ...local, code })} height="280px" />
              </>
            ) : (
              <button
                type="button"
                className="nf-code-folded-hint"
                onClick={() => setCodeOpen(true)}
              >
                {local.code.split("\n").length} lines — click to show
              </button>
            )}
          </section>

          <section className="nf-modal-section nf-modal-output">
            <h3>Node output</h3>
            {singleRunError ? <div className="nf-error-banner">{singleRunError}</div> : null}
            <OutputPreview
              title=""
              nodeLabel={local.label}
              output={modalOutput}
              logs={lastRunLogs.length ? lastRunLogs : undefined}
              variant="embedded"
            />
          </section>
        </div>
      </div>
    </div>
  );
}
