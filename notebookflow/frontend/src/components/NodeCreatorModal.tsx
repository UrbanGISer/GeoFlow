import { useState } from "react";
import type { NodeSpec } from "../types";

interface NodeCreatorModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (spec: NodeSpec) => void;
}

const CREATOR_DEFAULT_PARAMS = "{\n  \"example\": \"value\"\n}";
const CREATOR_DEFAULT_PARAMETERS = `[
  { "name": "example", "type": "string", "required": false, "default": "value" }
]`;
const CREATOR_DEFAULT_CODE = `# Use df_in, params, and assign df_out/html_out
df_out = df_in.copy() if df_in is not None else None`;

export function NodeCreatorModal({ open, onClose, onCreate }: NodeCreatorModalProps) {
  const [id, setId] = useState("custom_node");
  const [label, setLabel] = useState("Custom Node");
  const [category, setCategory] = useState("Transform");
  const [color, setColor] = useState("#fbc02d");
  const [needsInput, setNeedsInput] = useState(true);
  const [outputType, setOutputType] = useState<"df_out" | "html_out">("df_out");
  const [parametersJson, setParametersJson] = useState(CREATOR_DEFAULT_PARAMETERS);
  const [defaultParamsJson, setDefaultParamsJson] = useState(CREATOR_DEFAULT_PARAMS);
  const [code, setCode] = useState(CREATOR_DEFAULT_CODE);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submitCreate = () => {
    try {
      const parameters = JSON.parse(parametersJson);
      const defaultParams = JSON.parse(defaultParamsJson);
      if (!Array.isArray(parameters)) {
        throw new Error("Parameters JSON must be an array.");
      }
      const nodeId = id.trim();
      if (!nodeId) throw new Error("id is required.");
      const spec: NodeSpec = {
        id: nodeId,
        name: nodeId,
        label: label.trim() || nodeId,
        category: category.trim() || "Transform",
        color,
        inputs: needsInput ? { df_in: { type: "DataFrame" } } : {},
        outputs:
          outputType === "df_out" ? { df_out: { type: "DataFrame" } } : { html_out: { type: "HTML" } },
        parameters,
        default_params: defaultParams,
        default_code: code,
      };
      onCreate(spec);
      setError(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="nf-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="node-creator-title">
      <button type="button" className="nf-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="nf-modal nf-node-creator-modal">
        <header className="nf-modal-header">
          <div>
            <h2 id="node-creator-title">Node Creator</h2>
            <p className="nf-modal-sub">Define parameters and starter code, then add to node library.</p>
          </div>
          <div className="nf-modal-actions">
            <button type="button" className="nf-btn" onClick={onClose}>
              Close
            </button>
            <button type="button" className="nf-btn nf-btn-primary" onClick={submitCreate}>
              Add to Library
            </button>
          </div>
        </header>
        <div className="nf-modal-body">
          <div className="nf-node-creator-grid">
            <label>id</label>
            <input value={id} onChange={(e) => setId(e.target.value)} />
            <label>label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
            <label>category</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} />
            <label>color</label>
            <input value={color} onChange={(e) => setColor(e.target.value)} />
            <label className="nf-field-row">
              <input type="checkbox" checked={needsInput} onChange={(e) => setNeedsInput(e.target.checked)} />
              <span>needs df_in</span>
            </label>
            <label>output</label>
            <select value={outputType} onChange={(e) => setOutputType(e.target.value as "df_out" | "html_out")}>
              <option value="df_out">df_out</option>
              <option value="html_out">html_out</option>
            </select>
            <label>parameters (JSON array)</label>
            <textarea value={parametersJson} onChange={(e) => setParametersJson(e.target.value)} rows={6} />
            <label>default params (JSON object)</label>
            <textarea value={defaultParamsJson} onChange={(e) => setDefaultParamsJson(e.target.value)} rows={5} />
            <label>default code</label>
            <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={10} />
            {error ? <p className="nf-error-text">{error}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

