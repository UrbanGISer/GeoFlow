import { useEffect, useState } from "react";
import { workspaceSaveFile } from "../api/client";
import { loadWorkspaceRoot } from "../types";
import { WORKSPACE_REFRESH_EVENT } from "./WorkspacePanel";

interface SaveWorkflowModalProps {
  open: boolean;
  /** Serialized workflow JSON to write. */
  getContent: () => string;
  onDownload: () => void;
  onClose: () => void;
}

export function SaveWorkflowModal({ open, getContent, onDownload, onClose }: SaveWorkflowModalProps) {
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("workflow.json");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    if (open) {
      setFolder(loadWorkspaceRoot() ?? "");
      setMsg(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    const fname = name.trim();
    if (!fname) {
      setMsg({ text: "File name is required.", error: true });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const finalName = fname.endsWith(".json") ? fname : `${fname}.json`;
      const res = await workspaceSaveFile(folder.trim() || null, finalName, getContent());
      setMsg({ text: `Saved to ${res.path}`, error: false });
      window.dispatchEvent(new CustomEvent(WORKSPACE_REFRESH_EVENT));
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nf-modal-overlay">
      <button type="button" className="nf-modal-backdrop" onClick={onClose} aria-label="Close" />
      <div className="nf-modal nf-save-modal" style={{ zIndex: 3 }}>
        <div className="nf-modal-header">
          <h2 style={{ margin: 0, fontSize: 16 }}>Save Workflow</h2>
          <button type="button" className="nf-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="nf-modal-body">
          <div className="nf-field" style={{ marginBottom: 10 }}>
            <label className="nf-field-label">Folder</label>
            <input
              type="text"
              value={folder}
              placeholder="Default workspace folder"
              onChange={(e) => setFolder(e.target.value)}
            />
            <span className="nf-field-hint">
              Empty = default workspace. Pin a folder via the Workspace tab’s 📌 Set Root to change the default.
            </span>
          </div>
          <div className="nf-field" style={{ marginBottom: 12 }}>
            <label className="nf-field-label">File name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="nf-modal-actions-row">
            <button type="button" className="nf-btn" onClick={onDownload} disabled={busy}>
              Download instead
            </button>
            <button
              type="button"
              className="nf-btn nf-btn-primary"
              onClick={() => void handleSave()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save to Workspace"}
            </button>
          </div>
          {msg ? (
            <p className={msg.error ? "nf-error-text" : "nf-muted"} style={{ marginTop: 8 }}>
              {msg.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
