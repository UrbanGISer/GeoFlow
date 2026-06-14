import { useEffect, useState } from "react";
import { pickFolderNative, workspaceList, workspaceSaveFile } from "../api/client";
import { loadWorkspaceRoot } from "../types";
import { FolderPickerModal } from "./FolderPickerModal";
import { WORKSPACE_REFRESH_EVENT } from "./WorkspacePanel";

interface SaveWorkflowModalProps {
  open: boolean;
  title?: string;
  defaultName?: string;
  /** Default folder; falls back to the workspace folder when unset. */
  defaultFolder?: string;
  /** Enforced file extension, e.g. ".json" / ".ipynb". */
  ext?: string;
  /** When true, a name collision auto-increments: workflow.json → workflow1.json. */
  dedupe?: boolean;
  /** Serialized content to write (may be async, e.g. backend conversion). */
  getContent: () => string | Promise<string>;
  onDownload: () => void | Promise<void>;
  onClose: () => void;
  /** Called with the saved path after a successful save. */
  onSaved?: (path: string) => void;
}

export function SaveWorkflowModal({
  open,
  title = "Save Workflow",
  defaultName = "workflow.json",
  defaultFolder,
  ext = ".json",
  dedupe = false,
  getContent,
  onDownload,
  onClose,
  onSaved,
}: SaveWorkflowModalProps) {
  const [folder, setFolder] = useState("");
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setFolder(defaultFolder ?? loadWorkspaceRoot() ?? "");
      setName(defaultName);
      setMsg(null);
    }
  }, [open, defaultName, defaultFolder]);

  if (!open) return null;

  const handleBrowse = async () => {
    try {
      const res = await pickFolderNative(folder.trim() || loadWorkspaceRoot());
      if (res.path) setFolder(res.path);
    } catch {
      // No GUI available on the backend host — fall back to the in-app browser.
      setPickerOpen(true);
    }
  };

  const handleSave = async () => {
    const fname = name.trim();
    if (!fname) {
      setMsg({ text: "File name is required.", error: true });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      let finalName = fname.endsWith(ext) ? fname : `${fname}${ext}`;
      if (dedupe) {
        // New workflow: avoid overwriting — workflow.json → workflow1.json, …
        try {
          const listing = await workspaceList(folder.trim() || null);
          const names = new Set(listing.entries.map((e) => e.name));
          if (names.has(finalName)) {
            const base = finalName.slice(0, -ext.length);
            let i = 1;
            while (names.has(`${base}${i}${ext}`)) i += 1;
            finalName = `${base}${i}${ext}`;
          }
        } catch {
          // listing failed — save with the requested name
        }
      }
      const content = await getContent();
      const res = await workspaceSaveFile(folder.trim() || null, finalName, content);
      setMsg({ text: `Saved to ${res.path}`, error: false });
      window.dispatchEvent(new CustomEvent(WORKSPACE_REFRESH_EVENT));
      onSaved?.(res.path);
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
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button type="button" className="nf-btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="nf-modal-body">
          <div className="nf-field" style={{ marginBottom: 10 }}>
            <label className="nf-field-label">Folder</label>
            <div className="nf-field-with-btn">
              <input
                type="text"
                value={folder}
                placeholder="Default workspace folder"
                onChange={(e) => setFolder(e.target.value)}
              />
              <button
                type="button"
                className="nf-btn nf-btn-sm"
                disabled={busy}
                onClick={() => void handleBrowse()}
              >
                Browse…
              </button>
            </div>
            <span className="nf-field-hint">
              Defaults to your workspace folder (the folder currently open in the Workspace tab).
            </span>
          </div>
          <div className="nf-field" style={{ marginBottom: 12 }}>
            <label className="nf-field-label">File name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="nf-modal-actions-row">
            <button type="button" className="nf-btn" onClick={() => void onDownload()} disabled={busy}>
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
      <FolderPickerModal
        open={pickerOpen}
        initialPath={folder.trim() || loadWorkspaceRoot()}
        title="Choose Save Folder"
        onSelect={(path) => setFolder(path)}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
