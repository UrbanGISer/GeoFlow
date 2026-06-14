import type { DragEvent } from "react";
import type { NodeSpec } from "../types";
import { useMemo, useState } from "react";

interface NodeLibraryProps {
  specs: NodeSpec[];
  onAdd: (spec: NodeSpec) => void;
  selectedSpecId?: string | null;
  onSelectSpec?: (spec: NodeSpec) => void;
}

const CATEGORY_ORDER = [
  "Input",
  "Transform",
  "GIS",
  "Visualization",
  "Nature View",
  "Python Script",
];

export const DRAG_TYPE = "application/geoflow-node-id";

export function NodeLibrary({ specs, onAdd, selectedSpecId, onSelectSpec }: NodeLibraryProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, NodeSpec[]>();
    for (const spec of specs) {
      const cat = spec.category || "Other";
      if (cat === "Group") continue; // internal bar nodes, not user-draggable
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(spec);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [specs]);

  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set());

  const [search, setSearch] = useState("");

  const filteredGrouped = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    return grouped
      .map(([cat, catSpecs]) => [cat, catSpecs.filter((s) => s.label.toLowerCase().includes(q) || s.id.includes(q))] as [string, NodeSpec[]])
      .filter(([, catSpecs]) => catSpecs.length > 0);
  }, [grouped, search]);

  const toggleCat = (cat: string) => {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, spec: NodeSpec) => {
    e.dataTransfer.setData(DRAG_TYPE, spec.id);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="nf-sidebar">
      <div className="nf-sidebar-search">
        <input
          type="text"
          className="nf-search-input"
          placeholder="Search nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {filteredGrouped.map(([cat, catSpecs]) => (
        <div key={cat} className="nf-node-group">
          <button type="button" className="nf-group-toggle" onClick={() => toggleCat(cat)}>
            <span className="nf-group-arrow">{openCats.has(cat) || search ? "▾" : "▸"}</span>
            <span>{cat}</span>
            <span className="nf-group-count">{catSpecs.length}</span>
          </button>
          {(openCats.has(cat) || search) ? (
            <ul className="nf-node-list nf-node-list-nested">
              {catSpecs.map((spec) => (
                <li key={spec.id}>
                  <div
                    className={`nf-node-item nf-node-item-draggable${selectedSpecId === spec.id ? " nf-node-item-selected" : ""}`}
                    draggable
                    role="button"
                    tabIndex={0}
                    title="Double-click to add to canvas (auto-connects from the selected node); drag also works"
                    style={{ borderLeftColor: spec.color, borderLeftWidth: "3px", borderLeftStyle: "solid" }}
                    onClick={() => onSelectSpec?.(spec)}
                    onDoubleClick={() => onAdd(spec)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onAdd(spec);
                        onSelectSpec?.(spec);
                      }
                    }}
                    onDragStart={(e) => handleDragStart(e, spec)}
                  >
                    {spec.label}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </aside>
  );
}
