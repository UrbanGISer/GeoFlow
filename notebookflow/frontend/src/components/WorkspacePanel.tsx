import { useCallback, useEffect, useRef, useState } from "react";
import {
  pickFolderNative,
  workspaceCreateFile,
  workspaceCopy,
  workspaceDelete,
  workspaceList,
  workspaceMkdir,
  workspaceRead,
  workspaceRename,
  workspaceReveal,
  type WorkspaceListing,
} from "../api/client";
import { loadWorkspaceRoot, saveWorkspaceRoot } from "../types";
import { FolderPickerModal } from "./FolderPickerModal";

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

interface CtxMenu {
  x: number;
  y: number;
  path: string;
  name: string;
  isDir: boolean;
}

interface WorkspacePanelProps {
  /** Called when the user double-clicks a .json workflow file. */
  onOpenFile?: (path: string) => void;
}

export function WorkspacePanel({ onOpenFile }: WorkspacePanelProps) {
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (path?: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await workspaceList(path);
      setListing(res);
      setPathInput(res.path);
      saveWorkspaceRoot(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const stored = loadWorkspaceRoot();
      if (stored) {
        try {
          const res = await workspaceList(stored);
          setListing(res);
          setPathInput(res.path);
          return;
        } catch {
          saveWorkspaceRoot(null);
        }
      }
      void load(null);
    })();
  }, [load]);

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

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: PointerEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [ctxMenu]);

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

  const handleRename = async (path: string, currentName: string) => {
    const newName = prompt("Rename to:", currentName);
    if (!newName?.trim() || newName.trim() === currentName) return;
    try {
      await workspaceRename(path, newName.trim());
      await load(listing?.path);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCopy = async (path: string) => {
    try {
      await workspaceCopy(path);
      await load(listing?.path);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpenAsWorkflow = async (path: string) => {
    try {
      const res = await workspaceRead(path);
      const wf = JSON.parse(res.content);
      if (!Array.isArray(wf.nodes) || !Array.isArray(wf.edges)) {
        throw new Error("Not a GeoFlow workflow JSON (missing nodes/edges).");
      }
      onOpenFile?.(path);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

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
        <button type="button" className="nf-btn nf-btn-sm" disabled={busy}
          title="Browse for a folder"
          onClick={() => {
            void (async () => {
              try {
                const res = await pickFolderNative(listing?.path ?? null);
                if (res.path) void load(res.path);
              } catch {
                setPickerOpen(true);
              }
            })();
          }}>
          Browse…
        </button>
      </div>
      {error ? <p className="nf-error-text" style={{ padding: "4px 10px" }}>{error}</p> : null}
      <div className="nf-workspace-list">
        {listing?.entries.length === 0 && !error ? (
          <p className="nf-muted" style={{ padding: "10px 12px", fontSize: 12 }}>Empty folder.</p>
        ) : null}
        {listing?.entries.map((entry) => (
          <div
            key={entry.path}
            className="nf-workspace-row"
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY, path: entry.path, name: entry.name, isDir: entry.is_dir });
            }}
          >
            <button
              type="button"
              className="nf-workspace-name"
              title={entry.is_dir ? entry.path : `${entry.path}${entry.name.endsWith(".json") ? " — double-click to open as workflow" : ""}`}
              onClick={() => {
                if (entry.is_dir) load(entry.path);
              }}
              onDoubleClick={() => {
                if (!entry.is_dir && entry.name.endsWith(".json")) {
                  void handleOpenAsWorkflow(entry.path);
                }
              }}
              style={{ cursor: entry.is_dir || entry.name.endsWith(".json") ? "pointer" : "default" }}
            >
              <span className="nf-workspace-icon">{fileIcon(entry.name, entry.is_dir)}</span>
              <span className="nf-workspace-label">{entry.name}</span>
            </button>
            <span className="nf-workspace-size">
              {entry.is_dir ? "" : fmtSize(entry.size)}
            </span>
          </div>
        ))}
      </div>

      {/* Right-click context menu */}
      {ctxMenu ? (
        <div
          ref={ctxRef}
          className="nf-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {!ctxMenu.isDir && ctxMenu.name.endsWith(".json") ? (
            <button type="button" className="nf-ctx-item" onClick={() => {
              void handleOpenAsWorkflow(ctxMenu.path);
              setCtxMenu(null);
            }}>
              Open as Workflow
            </button>
          ) : null}
          <button type="button" className="nf-ctx-item" onClick={() => {
            void workspaceReveal(ctxMenu.path).catch((e) =>
              alert(e instanceof Error ? e.message : String(e))
            );
            setCtxMenu(null);
          }}>
            {ctxMenu.isDir ? "Open in Finder" : "Reveal in Finder"}
          </button>
          <div className="nf-ctx-separator" />
          <button type="button" className="nf-ctx-item" onClick={() => {
            void handleRename(ctxMenu.path, ctxMenu.name);
            setCtxMenu(null);
          }}>
            Rename…
          </button>
          {!ctxMenu.isDir ? (
            <button type="button" className="nf-ctx-item" onClick={() => {
              void handleCopy(ctxMenu.path);
              setCtxMenu(null);
            }}>
              Duplicate
            </button>
          ) : null}
          <button type="button" className="nf-ctx-item nf-ctx-item-danger" onClick={() => {
            void handleDelete(ctxMenu.path, ctxMenu.name, ctxMenu.isDir);
            setCtxMenu(null);
          }}>
            Delete
          </button>
        </div>
      ) : null}

      <FolderPickerModal
        open={pickerOpen}
        initialPath={listing?.path ?? null}
        title="Browse Folder"
        onSelect={(path) => void load(path)}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
