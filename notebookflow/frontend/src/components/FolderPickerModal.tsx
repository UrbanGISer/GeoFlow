import { useCallback, useEffect, useState } from "react";
import { workspaceList, workspaceMkdir, type WorkspaceListing } from "../api/client";

interface FolderPickerModalProps {
  open: boolean;
  /** Folder to start browsing from (null → backend default workspace). */
  initialPath?: string | null;
  title?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

/** Visual folder browser over the backend filesystem — pick a folder for
 * the Workspace tab or as a save target. */
export function FolderPickerModal({
  open,
  initialPath = null,
  title = "Choose Folder",
  onSelect,
  onClose,
}: FolderPickerModalProps) {
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (path: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await workspaceList(path);
      setListing(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const folders = listing?.entries.filter((e) => e.is_dir) ?? [];

  const handleNewFolder = async () => {
    if (!listing) return;
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    try {
      const res = await workspaceMkdir(listing.path, name.trim());
      await load(res.path); // jump into the new folder
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="nf-modal-overlay" style={{ zIndex: 70 }}>
      <button type="button" className="nf-modal-backdrop" onClick={onClose} aria-label="Close" />
      <div className="nf-modal nf-folder-picker" style={{ zIndex: 3 }}>
        <div className="nf-modal-header">
          <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
          <button type="button" className="nf-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="nf-modal-body">
          <div className="nf-folder-picker-path" title={listing?.path}>
            {listing?.path ?? "…"}
          </div>
          <div className="nf-workspace-actions" style={{ borderBottom: "none", padding: "6px 0" }}>
            <button type="button" className="nf-btn nf-btn-sm" disabled={busy || !listing?.parent}
              onClick={() => listing?.parent && load(listing.parent)}>
              ↑ Up
            </button>
            <button type="button" className="nf-btn nf-btn-sm" disabled={busy} onClick={() => load(listing?.path ?? null)}>
              ⟳
            </button>
            <button type="button" className="nf-btn nf-btn-sm" disabled={busy} onClick={handleNewFolder}>
              + Folder
            </button>
          </div>
          {error ? <p className="nf-error-text">{error}</p> : null}
          <div className="nf-folder-picker-list">
            {folders.length === 0 && !error ? (
              <p className="nf-muted" style={{ padding: "8px 4px", fontSize: 12 }}>No subfolders.</p>
            ) : null}
            {folders.map((f) => (
              <button
                key={f.path}
                type="button"
                className="nf-folder-picker-item"
                title={f.path}
                onClick={() => load(f.path)}
              >
                📁 {f.name}
              </button>
            ))}
          </div>
          <div className="nf-modal-actions-row">
            <button
              type="button"
              className="nf-btn nf-btn-primary"
              disabled={busy || !listing}
              onClick={() => {
                if (listing) {
                  onSelect(listing.path);
                  onClose();
                }
              }}
            >
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
