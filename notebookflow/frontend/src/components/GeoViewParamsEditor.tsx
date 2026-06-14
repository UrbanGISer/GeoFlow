import { useState } from "react";

type Params = Record<string, unknown>;

interface SectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="nf-gvp-section">
      <button type="button" className="nf-gvp-section-head" onClick={() => setOpen((v) => !v)}>
        <span className="nf-group-arrow">{open ? "▾" : "▸"}</span>
        <span className="nf-gvp-section-title">{title}</span>
      </button>
      {open ? <div className="nf-gvp-section-body">{children}</div> : null}
    </div>
  );
}

const LEGEND_LOCS = [
  "best", "upper right", "upper left", "lower right", "lower left",
  "center right", "center left", "upper center", "lower center", "center",
];
const BASEMAP_OPTIONS = [
  { value: "none",           label: "None" },
  { value: "osm",            label: "OpenStreetMap" },
  { value: "satellite",      label: "Satellite (Esri)" },
  { value: "topo",           label: "Topo (Esri)" },
  { value: "cartodb_light",  label: "CartoDB Light" },
  { value: "cartodb_dark",   label: "CartoDB Dark" },
  { value: "stamen_terrain", label: "Stamen Terrain" },
  { value: "stamen_toner",   label: "Stamen Toner" },
];

interface GeoViewParamsEditorProps {
  params: Params;
  onChange: (next: Params) => void;
}

export function GeoViewParamsEditor({ params, onChange }: GeoViewParamsEditorProps) {
  const set = (key: string, val: unknown) => onChange({ ...params, [key]: val });
  const num = (key: string, def: number) => {
    const v = params[key];
    return v === undefined || v === null ? def : Number(v);
  };
  const str = (key: string, def = "") => {
    const v = params[key];
    return v === undefined || v === null ? def : String(v);
  };
  const bool = (key: string, def: boolean) => {
    const v = params[key];
    return v === undefined || v === null ? def : Boolean(v);
  };

  const basemap = str("basemap", "none");

  return (
    <div className="nf-gvp">
      {/* Figure */}
      <Section title="Figure" defaultOpen={true}>
        <label className="nf-field">
          <span className="nf-field-label">title</span>
          <input type="text" value={str("title")} placeholder="Map title (optional)"
            onChange={(e) => set("title", e.target.value)} />
        </label>
        <label className="nf-field nf-field-row">
          <input type="checkbox" checked={bool("axis_off", true)}
            onChange={(e) => set("axis_off", e.target.checked)} />
          <span>hide axes</span>
        </label>
        <div className="nf-field-row-3">
          <label className="nf-field">
            <span className="nf-field-label">width (in)</span>
            <input type="number" min={1} step={0.5} value={num("fig_width", 10)}
              onChange={(e) => set("fig_width", Number(e.target.value))} />
          </label>
          <label className="nf-field">
            <span className="nf-field-label">height (in)</span>
            <input type="number" min={1} step={0.5} value={num("fig_height", 8)}
              onChange={(e) => set("fig_height", Number(e.target.value))} />
          </label>
          <label className="nf-field">
            <span className="nf-field-label">DPI (PNG)</span>
            <input type="number" min={72} max={600} step={10} value={num("dpi", 200)}
              onChange={(e) => set("dpi", Number(e.target.value))} />
          </label>
        </div>
      </Section>

      {/* Basemap */}
      <Section title="Basemap">
        <div className="nf-field-row-2">
          <label className="nf-field">
            <span className="nf-field-label">source</span>
            <select value={basemap} onChange={(e) => set("basemap", e.target.value)}>
              {BASEMAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="nf-field">
            <span className="nf-field-label">alpha ({num("basemap_alpha", 0.5).toFixed(2)})</span>
            <input type="range" min={0} max={1} step={0.05}
              disabled={basemap === "none"}
              value={num("basemap_alpha", 0.5)}
              onChange={(e) => set("basemap_alpha", Number(e.target.value))} />
          </label>
        </div>
        {basemap !== "none" ? (
          <p className="nf-field-hint" style={{ marginTop: 4 }}>
            Basemap requires internet access and the <code>contextily</code> package. Layer CRS is reprojected automatically.
          </p>
        ) : null}
      </Section>

      {/* Legend */}
      <Section title="Legend">
        <label className="nf-field nf-field-row">
          <input type="checkbox" checked={bool("legend_show", true)}
            onChange={(e) => set("legend_show", e.target.checked)} />
          <span>show legend</span>
        </label>
        {bool("legend_show", true) ? (
          <>
            <div className="nf-field-row-2">
              <label className="nf-field">
                <span className="nf-field-label">location</span>
                <select value={str("legend_loc", "best")}
                  onChange={(e) => set("legend_loc", e.target.value)}>
                  {LEGEND_LOCS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className="nf-field">
                <span className="nf-field-label">font size</span>
                <input type="number" min={6} max={24} step={1} value={num("legend_fontsize", 10)}
                  onChange={(e) => set("legend_fontsize", Number(e.target.value))} />
              </label>
            </div>
            <label className="nf-field nf-field-row">
              <input type="checkbox" checked={bool("legend_frame", true)}
                onChange={(e) => set("legend_frame", e.target.checked)} />
              <span>legend frame</span>
            </label>
            <label className="nf-field">
              <span className="nf-field-label">
                legend bbox <span className="nf-field-hint-inline">(x, y — figure coords 0–1, e.g. "1.02, 0.5" places legend just outside right edge)</span>
              </span>
              <input type="text" value={str("legend_bbox")} placeholder="e.g. 1.02, 0.5"
                onChange={(e) => set("legend_bbox", e.target.value)} />
            </label>
          </>
        ) : null}
      </Section>

    </div>
  );
}
