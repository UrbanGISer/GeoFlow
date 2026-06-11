import { useCallback, useEffect, useState } from "react";
import {
  workspaceCreateFile,
  workspaceDelete,
  workspaceList,
  workspaceMkdir,
  type WorkspaceListing,
} from "../api/client";
import { loadWorkspaceRoot, saveWorkspaceRoot } from "../types";

/** Other components (e.g. the Save dialog) dispatch this to refresh the listing. */
export const WORKSPACE_REFRESH_EVENT = "geoflow-workspace-refresh";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

const FILE_ICONS: Record<string, string> = {
  csv: "▤", xlsx: "▤", xls: "▤", parquet: "▤",
  json: "{}", geojson: "🌐", shp: "🌐", gpkg: "🌐", zip: "▣",
  png: "▦", jpg: "▦", jpeg: "▦", svg: "▦", html: "◇",
  ipynb: "✎", py: "✎", md: "✎", txt: "✎",
};

function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? "·";
}

interface WorkspacePanelProps {
  /** Called when the user clicks a file (App opens .json files as workflows). */
  onOpenFile?: (path: string) => void;
}

export function WorkspacePanel({ onOpenFile }: WorkspacePanelProps) {
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [root, setRoot] = useState<string | null>(() => loadWorkspaceRoot());

  const load = useCallback(async (path?: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await workspaceList(path);
      setListing(res);
      setPathInput(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Pinned root wins; otherwise the backend default workspace.
    load(loadWorkspaceRoot());
  }, [load]);

  // External refresh (e.g. after Save Workflow writes a file here).
  useEffect(() => {
    const onRefresh = () => {
      setListing((cur) => {
        if (cur) void load(cur.path);
        return cur;
      });
    };
    window.addEventListener(WORKSPACE_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(WORKSPACE_REFRESH_EVENT, onRefresh);
  }, [load]);

  const handleNewFolder = async () => {
    if (!listing) return;
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    try {
      await workspaceMkdir(listing.path, name.trim());
      await load(listing.path);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleNewFile = async () => {
    if (!listing) return;
    const name = prompt("New file name (e.g. notes.txt):");
    if (!name?.trim()) return;
    try {
      await workspaceCreateFile(listing.path, name.trim());
      await load(listing.path);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (path: string, name: string, isDir: boolean) => {
    const kind = isDir ? "folder (and all its contents)" : "file";
    if (!confirm(`Delete ${kind} "${name}"?`)) return;
    try {
      await workspaceDelete(path);
      await load(listing?.path);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const isRoot = listing != null && root === listing.path;

  return (
    <div className="nf-workspace-panel">
      <div className="nf-workspace-toolbar">
        <input
          type="text"
          className="nf-workspace-path"
          value={pathInput}
          title={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") load(pathInput.trim() || null);
          }}
          placeholder="Folder path…"
        />
      </div>
      <div className="nf-workspace-actions">
        <button type="button" className="nf-btn nf-btn-sm" disabled={busy} title="Refresh"
          onClick={() => load(listing?.path)}>
          ⟳
        </button>
        <button type="button" className="nf-btn nf-btn-sm" disabled={busy || !listing?.parent} title="Up one level"
          onClick={() => listing?.parent && load(listing.parent)}>
          ↑ Up
        </button>
        <button type="button" className="nf-btn nf-btn-sm" disabled={busy} title="New folder"
          onClick={handleNewFolder}>
          + Folder
        </button>
        <button type="button" className="nf-btn nf-btn-sm" disabled={busy} title="New file"
          onClick={handleNewFile}>
          + File
        </button>
        <button
          type="button"
          className={`nf-btn nf-btn-sm${isRoot ? " nf-btn-pinned" : ""}`}
          disabled={busy || !listing}
          title={isRoot ? "This folder is the workspace root (click to unpin)" : "Pin this folder as the workspace root — default for browsing and Save Workflow"}
          onClick={() => {
            if (!listing) return;
            if (isRoot) {
              saveWorkspaceRoot(null);
              setRoot(null);
            } else {
              saveWorkspaceRoot(listing.path);
              setRoot(listing.path);
            }
          }}
        >
          {isRoot ? "📌 Root ✓" : "📌 Set Root"}
        </button>
      </div>
      {error ? <p className="nf-error-text" style={{ padding: "4px 10px" }}>{error}</p> : null}
      <div className="nf-workspace-list">
        {listing?.entries.length === 0 && !error ? (
          <p className="nf-muted" style={{ padding: "10px 12px", fontSize: 12 }}>Empty folder.</p>
        ) : null}
        {listing?.entries.map((entry) => (
          <div key={entry.path} className="nf-workspace-row">
            <button
              type="button"
              className="nf-workspace-name"
              title={entry.is_dir ? entry.path : `${entry.path}${entry.name.endsWith(".json") ? " — click to open as workflow" : ""}`}
              onClick={() => {
                if (entry.is_dir) load(entry.path);
                else onOpenFile?.(entry.path);
              }}
              style={{ cursor: entry.is_dir || entry.name.endsWith(".json") ? "pointer" : "default" }}
            >
              <span className="nf-workspace-icon">{fileIcon(entry.name, entry.is_dir)}</span>
              <span className="nf-workspace-label">{entry.name}</span>
            </button>
            <span className="nf-workspace-size">
              {entry.is_dir ? "" : fmtSize(entry.size)}
            </span>
            <button
              type="button"
              className="nf-workspace-del"
              title={`Delete ${entry.name}`}
              onClick={() => handleDelete(entry.path, entry.name, entry.is_dir)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
