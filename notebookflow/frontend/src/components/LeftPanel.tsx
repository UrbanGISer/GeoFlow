import { useState } from "react";
import type { NodeSpec } from "../types";
import { NodeLibrary } from "./NodeLibrary";

type LeftTab = "nodes" | "info" | "files";

interface LeftPanelProps {
  specs: NodeSpec[];
  onAdd: (spec: NodeSpec) => void;
  selectedSpec?: NodeSpec | null;
  recentFiles?: string[];
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
      <div className="nf-info-section">
        <h4 className="nf-info-h4">Inputs</h4>
        {Object.keys(spec.inputs).length === 0 ? (
          <p className="nf-muted">None (source node)</p>
        ) : (
          <ul className="nf-info-port-list">
            {Object.entries(spec.inputs).map(([k, v]) => (
              <li key={k}><code>{k}</code>: {(v as { type?: string })?.type ?? "any"}</li>
            ))}
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
                {p.default !== undefined && p.default !== null ? (
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

function FilesTab({ recentFiles }: { recentFiles?: string[] }) {
  return (
    <div className="nf-left-tab-body" style={{ overflowY: "auto", padding: "12px" }}>
      <p className="nf-muted" style={{ marginBottom: 12 }}>
        Recent uploads (session only):
      </p>
      {recentFiles && recentFiles.length > 0 ? (
        <ul className="nf-info-port-list">
          {recentFiles.map((f, i) => (
            <li key={i} title={f} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <code>{f.split(/[/\\]/).pop()}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nf-muted" style={{ fontSize: 12 }}>
          No files uploaded yet. Use a Read CSV / GeoFile Reader node and upload a file via its parameter editor.
        </p>
      )}
    </div>
  );
}

export function LeftPanel({ specs, onAdd, selectedSpec, recentFiles }: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState<LeftTab>("nodes");
  const [hoveredSpec, setHoveredSpec] = useState<NodeSpec | null>(null);

  const displaySpec = hoveredSpec ?? selectedSpec;

  const tabs: Array<{ id: LeftTab; label: string }> = [
    { id: "nodes", label: "Nodes" },
    { id: "info", label: "Info" },
    { id: "files", label: "Files" },
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
            selectedSpecId={selectedSpec?.id}
            onSelectSpec={(spec) => setHoveredSpec(spec)}
          />
        ) : null}
        {activeTab === "info" ? (
          <InfoTab spec={displaySpec} />
        ) : null}
        {activeTab === "files" ? (
          <FilesTab recentFiles={recentFiles} />
        ) : null}
      </div>
    </div>
  );
}
