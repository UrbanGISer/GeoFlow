import { useEffect, useRef, useState } from "react";
import { standardizeNotebookFromFile } from "../api/client";
import type { NotebookStandardizeResponse } from "../types";

interface NotebookImportModalProps {
  open: boolean;
  onClose: () => void;
  onApply: (res: NotebookStandardizeResponse) => void;
}

export function NotebookImportModal({ open, onClose, onApply }: NotebookImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setErr(null);
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="nf-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="notebook-import-title">
      <button type="button" className="nf-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="nf-modal nf-node-creator-modal">
        <header className="nf-modal-header">
          <h2 id="notebook-import-title">Import Notebook to Workflow</h2>
          <button type="button" className="nf-btn" onClick={onClose}>Close</button>
        </header>
        <div className="nf-modal-body">
          <p className="nf-muted">Choose a Jupyter notebook file (<code>.ipynb</code>), then standardize it into nodes on the canvas.</p>
          <div className="nf-notebook-file-row">
            <input
              ref={fileInputRef}
              type="file"
              accept=".ipynb,application/json,.json"
              className="nf-hidden-input"
              id="notebook-import-file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setErr(null);
              }}
            />
            <label htmlFor="notebook-import-file" className="nf-btn">
              Choose file…
            </label>
            <span className="nf-muted nf-notebook-file-name">
              {file ? file.name : "No file selected"}
            </span>
          </div>
          {err ? <p className="nf-error-text">{err}</p> : null}
          <div className="nf-modal-actions-row">
            <button
              type="button"
              className="nf-btn nf-btn-primary"
              disabled={busy || !file}
              onClick={async () => {
                if (!file) return;
                setBusy(true);
                setErr(null);
                try {
                  const res = await standardizeNotebookFromFile(file);
                  onApply(res);
                  onClose();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Standardizing..." : "Standardize"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
