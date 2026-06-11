import { useState } from "react";
import type { NodeSpec } from "../types";
import { loadAIConfig, type AIConfig } from "../types";
import { AISettingsPanel } from "./AISettingsPanel";
import { Markdown } from "./Markdown";
import { NodeLibrary } from "./NodeLibrary";
import { WorkspacePanel } from "./WorkspacePanel";

type LeftTab = "nodes" | "info" | "workspace" | "ai";

interface LeftPanelProps {
  specs: NodeSpec[];
  onAdd: (spec: NodeSpec) => void;
  selectedSpec?: NodeSpec | null;
}

function InfoTab({ spec }: { spec?: NodeSpec | null }) {
  if (!spec) {
    return (
      <div className="nf-left-tab-body">
        <p className="nf-muted" style={{ padding: "16px 12px" }}>
          Click a node in the library or select one on the canvas to see its description.
        </p>
      </div>
    );
  }
  return (
    <div className="nf-left-tab-body" style={{ overflowY: "auto" }}>
      <div className="nf-info-header" style={{ borderLeft: `4px solid ${spec.color}` }}>
        <div className="nf-info-label">{spec.label}</div>
        <div className="nf-info-category">{spec.category}</div>
      </div>
      {spec.description ? (
        <div className="nf-info-section nf-info-desc">
          <Markdown source={spec.description} />
        </div>
      ) : null}
      <div className="nf-info-section">
        <h4 className="nf-info-h4">Inputs</h4>
        {Object.keys(spec.inputs).length === 0 ? (
          <p className="nf-muted">None (source node)</p>
        ) : (
          <ul className="nf-info-port-list">
            {Object.entries(spec.inputs).map(([k, v]) => (
              <li key={k}>
                <code>{k}</code>: {(v as { type?: string })?.type ?? "any"}
                {(v as { label?: string })?.label ? ` — ${(v as { label: string }).label}` : ""}
              </li>
            ))}
            {spec.dynamic_inputs ? (
              <li className="nf-muted">+ more ports via the node’s +/− buttons</li>
            ) : null}
          </ul>
        )}
      </div>
      <div className="nf-info-section">
        <h4 className="nf-info-h4">Outputs</h4>
        {Object.keys(spec.outputs).length === 0 ? (
          <p className="nf-muted">None</p>
        ) : (
          <ul className="nf-info-port-list">
            {Object.entries(spec.outputs).map(([k, v]) => (
              <li key={k}><code>{k}</code>: {(v as { type?: string })?.type ?? "any"}</li>
            ))}
          </ul>
        )}
      </div>
      {spec.parameters.length > 0 ? (
        <div className="nf-info-section">
          <h4 className="nf-info-h4">Parameters</h4>
          <ul className="nf-info-param-list">
            {spec.parameters.map((p) => (
              <li key={p.name}>
                <span className="nf-info-param-name">{p.name}</span>
                <span className="nf-info-param-type"> ({p.type})</span>
                {p.required ? <span className="nf-required"> *</span> : null}
                {p.default !== undefined && p.default !== null && p.default !== "" ? (
                  <span className="nf-muted"> — default: {String(p.default)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function LeftPanel({ specs, onAdd, selectedSpec }: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<LeftTab>("nodes");
  const [librarySpec, setLibrarySpec] = useState<NodeSpec | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => loadAIConfig());

  // Canvas selection wins; otherwise last library click.
  const displaySpec = selectedSpec ?? librarySpec;

  const tabs: Array<{ id: LeftTab; label: string }> = [
    { id: "nodes", label: "Nodes" },
    { id: "info", label: "Info" },
    { id: "workspace", label: "Workspace" },
    { id: "ai", label: "AI" },
  ];

  return (
    <div className="nf-left-panel">
      <div className="nf-left-tab-bar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nf-left-tab-btn${activeTab === t.id ? " nf-left-tab-btn-active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="nf-left-tab-content">
        {activeTab === "nodes" ? (
          <NodeLibrary
            specs={specs}
            onAdd={onAdd}
            selectedSpecId={displaySpec?.id}
            onSelectSpec={(spec) => setLibrarySpec(spec)}
          />
        ) : null}
        {activeTab === "info" ? <InfoTab spec={displaySpec} /> : null}
        {activeTab === "workspace" ? <WorkspacePanel /> : null}
        {activeTab === "ai" ? (
          <div className="nf-left-tab-body" style={{ overflowY: "auto", padding: "10px" }}>
            <AISettingsPanel config={aiConfig} onChange={setAiConfig} compact />
          </div>
        ) : null}
      </div>
    </div>
  );
}
