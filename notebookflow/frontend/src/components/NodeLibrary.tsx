import type { NodeSpec } from "../types";
import { useMemo, useState } from "react";

interface NodeLibraryProps {
  specs: NodeSpec[];
  onAdd: (spec: NodeSpec) => void;
}

export function NodeLibrary({ specs, onAdd }: NodeLibraryProps) {
  const [tabularOpen, setTabularOpen] = useState(true);
  const [geoOpen, setGeoOpen] = useState(true);

  const { tabular, geoData } = useMemo(() => {
    const geo = specs.filter((s) => s.id === "geofile_reader" || s.id === "geomap");
    const geoIds = new Set(geo.map((s) => s.id));
    const tab = specs.filter((s) => !geoIds.has(s.id));
    return { tabular: tab, geoData: geo };
  }, [specs]);

  return (
    <aside className="nf-sidebar">
      <h2 className="nf-panel-title">Nodes</h2>
      <div className="nf-node-group">
        <button type="button" className="nf-group-toggle" onClick={() => setTabularOpen((v) => !v)}>
          <span className="nf-group-arrow">{tabularOpen ? "▾" : "▸"}</span>
          <span>Tabular</span>
        </button>
        {tabularOpen ? (
          <ul className="nf-node-list nf-node-list-nested">
            {tabular.map((spec) => (
              <li key={spec.id}>
                <button type="button" className="nf-node-item" onClick={() => onAdd(spec)}>
                  {spec.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="nf-node-group">
        <button type="button" className="nf-group-toggle" onClick={() => setGeoOpen((v) => !v)}>
          <span className="nf-group-arrow">{geoOpen ? "▾" : "▸"}</span>
          <span>GeoData</span>
        </button>
        {geoOpen ? (
          <ul className="nf-node-list nf-node-list-nested">
            {geoData.map((spec) => (
              <li key={spec.id}>
                <button type="button" className="nf-node-item" onClick={() => onAdd(spec)}>
                  {spec.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </aside>
  );
}
