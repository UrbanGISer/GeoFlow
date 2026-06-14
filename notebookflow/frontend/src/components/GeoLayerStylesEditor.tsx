import { useEffect, useRef, useState } from "react";

/** Per-input-port layer info supplied by the node panel. */
export interface GeoLayerInfo {
  count: number;
  columns: string[][];
  dtypes: Record<string, string>[];
}

export interface GeoLayerStyle {
  column?: string;
  mode?: "auto" | "continuous" | "class";
  scheme?: string;
  k?: number;
  cmap?: string;
  fill_color?: string;
  fill_alpha?: number;
  edge_color?: string;
  edge_width?: number;
  edge_alpha?: number;
  marker_size?: number;
}

/** Schemes that accept a k parameter. */
const SCHEMES_WITH_K = new Set([
  "EqualInterval", "FisherJenks", "FisherJenksSampled", "JenksCaspall",
  "JenksCaspallForced", "JenksCaspallSampled", "MaximumBreaks",
  "NaturalBreaks", "Quantiles", "StdMean",
]);

const CLASS_SCHEMES = [
  "NaturalBreaks", "EqualInterval", "Quantiles", "FisherJenks",
  "FisherJenksSampled", "JenksCaspall", "JenksCaspallForced",
  "JenksCaspallSampled", "MaximumBreaks", "StdMean",
  "HeadTailBreaks", "BoxPlot", "Percentiles",
];

const DEFAULT_COLORS = ["#1976d2", "#e53935", "#2e7d32", "#f9a825", "#8e24aa",
  "#00838f", "#6d4c41", "#c2185b"];

interface CmapDef { id: string; gradient: string; group: string }

const CMAPS: CmapDef[] = [
  { group: "Sequential (uniform)", id: "viridis",  gradient: "linear-gradient(90deg,#440154,#3b528b,#21918c,#5ec962,#fde725)" },
  { group: "Sequential (uniform)", id: "plasma",   gradient: "linear-gradient(90deg,#0d0887,#7e03a8,#cc4778,#f89540,#f0f921)" },
  { group: "Sequential (uniform)", id: "magma",    gradient: "linear-gradient(90deg,#000004,#51127c,#b73779,#fc8961,#fcfdbf)" },
  { group: "Sequential (uniform)", id: "inferno",  gradient: "linear-gradient(90deg,#000004,#420a68,#932667,#dd513a,#fca50a,#fcffa4)" },
  { group: "Sequential (uniform)", id: "cividis",  gradient: "linear-gradient(90deg,#00224e,#35456c,#666970,#a59c74,#fee838)" },
  { group: "Sequential (uniform)", id: "turbo",    gradient: "linear-gradient(90deg,#30123b,#4777ef,#1ac7c2,#a4fc3c,#fb8022,#7a0403)" },
  { group: "Sequential (single)",  id: "Blues",    gradient: "linear-gradient(90deg,#f7fbff,#c6dbef,#6baed6,#2171b5,#08306b)" },
  { group: "Sequential (single)",  id: "Greens",   gradient: "linear-gradient(90deg,#f7fcf5,#c7e9c0,#74c476,#238b45,#00441b)" },
  { group: "Sequential (single)",  id: "Reds",     gradient: "linear-gradient(90deg,#fff5f0,#fcbba1,#fb6a4a,#cb181d,#67000d)" },
  { group: "Sequential (single)",  id: "Purples",  gradient: "linear-gradient(90deg,#fcfbfd,#dadaeb,#9e9ac8,#6a51a3,#3f007d)" },
  { group: "Sequential (single)",  id: "Oranges",  gradient: "linear-gradient(90deg,#fff5eb,#fdd0a2,#fd8d3c,#d94801,#7f2704)" },
  { group: "Sequential (single)",  id: "Greys",    gradient: "linear-gradient(90deg,#ffffff,#d9d9d9,#969696,#525252,#000000)" },
  { group: "Sequential (single)",  id: "YlOrRd",   gradient: "linear-gradient(90deg,#ffffcc,#fed976,#fd8d3c,#e31a1c,#800026)" },
  { group: "Sequential (single)",  id: "YlGnBu",   gradient: "linear-gradient(90deg,#ffffd9,#c7e9b4,#41b6c4,#1d91c0,#0c2c84)" },
  { group: "Sequential (single)",  id: "BuPu",     gradient: "linear-gradient(90deg,#f7fcfd,#bfd3e6,#8c96c6,#8856a7,#810f7c)" },
  { group: "Sequential (single)",  id: "GnBu",     gradient: "linear-gradient(90deg,#f7fcf0,#ccebc5,#7bccc4,#2b8cbe,#084081)" },
  { group: "Sequential (single)",  id: "PuRd",     gradient: "linear-gradient(90deg,#f7f4f9,#d4b9da,#df65b0,#dd1c77,#67001f)" },
  { group: "Sequential (single)",  id: "OrRd",     gradient: "linear-gradient(90deg,#fff7ec,#fdd49e,#fc8d59,#d7301f,#7f0000)" },
  { group: "Diverging",            id: "coolwarm",  gradient: "linear-gradient(90deg,#3b4cc0,#9abbff,#dddddd,#f49a7b,#b40426)" },
  { group: "Diverging",            id: "RdYlBu",    gradient: "linear-gradient(90deg,#a50026,#f46d43,#fee090,#74add1,#313695)" },
  { group: "Diverging",            id: "RdBu",      gradient: "linear-gradient(90deg,#67001f,#ef8a62,#f7f7f7,#67a9cf,#053061)" },
  { group: "Diverging",            id: "Spectral",  gradient: "linear-gradient(90deg,#9e0142,#f46d43,#ffffbf,#66c2a5,#5e4fa2)" },
  { group: "Diverging",            id: "PiYG",      gradient: "linear-gradient(90deg,#8e0152,#de77ae,#f7f7f7,#7fbc41,#276419)" },
  { group: "Diverging",            id: "PRGn",      gradient: "linear-gradient(90deg,#40004b,#9970ab,#f7f7f7,#5aae61,#00441b)" },
  { group: "Diverging",            id: "BrBG",      gradient: "linear-gradient(90deg,#543005,#bf812d,#f6e8c3,#80cdc1,#003c30)" },
  { group: "Qualitative",          id: "tab10",   gradient: "linear-gradient(90deg,#1f77b4 0 10%,#ff7f0e 0 20%,#2ca02c 0 30%,#d62728 0 40%,#9467bd 0 50%,#8c564b 0 60%,#e377c2 0 70%,#7f7f7f 0 80%,#bcbd22 0 90%,#17becf 0 100%)" },
  { group: "Qualitative",          id: "tab20",   gradient: "linear-gradient(90deg,#1f77b4 0 5%,#aec7e8 0 10%,#ff7f0e 0 15%,#ffbb78 0 20%,#2ca02c 0 25%,#98df8a 0 30%,#d62728 0 35%,#ff9896 0 40%,#9467bd 0 45%,#c5b0d5 0 50%,#8c564b 0 55%,#c49c94 0 60%,#e377c2 0 65%,#f7b6d2 0 70%,#7f7f7f 0 75%,#c7c7c7 0 80%,#bcbd22 0 85%,#dbdb8d 0 90%,#17becf 0 95%,#9edae5 0 100%)" },
  { group: "Qualitative",          id: "Set1",    gradient: "linear-gradient(90deg,#e41a1c 0 14%,#377eb8 0 28%,#4daf4a 0 42%,#984ea3 0 56%,#ff7f00 0 70%,#ffff33 0 84%,#a65628 0 100%)" },
  { group: "Qualitative",          id: "Set2",    gradient: "linear-gradient(90deg,#66c2a5 0 20%,#fc8d62 0 40%,#8da0cb 0 60%,#e78ac3 0 80%,#a6d854 0 100%)" },
  { group: "Qualitative",          id: "Set3",    gradient: "linear-gradient(90deg,#8dd3c7 0 14%,#ffffb3 0 28%,#bebada 0 42%,#fb8072 0 56%,#80b1d3 0 70%,#fdb462 0 84%,#b3de69 0 100%)" },
  { group: "Qualitative",          id: "Paired",  gradient: "linear-gradient(90deg,#a6cee3 0 16%,#1f78b4 0 32%,#b2df8a 0 48%,#33a02c 0 64%,#fb9a99 0 80%,#e31a1c 0 100%)" },
  { group: "Qualitative",          id: "Pastel1", gradient: "linear-gradient(90deg,#fbb4ae 0 20%,#b3cde3 0 40%,#ccebc5 0 60%,#decbe4 0 80%,#fed9a6 0 100%)" },
  { group: "Qualitative",          id: "Dark2",   gradient: "linear-gradient(90deg,#1b9e77 0 20%,#d95f02 0 40%,#7570b3 0 60%,#e7298a 0 80%,#66a61e 0 100%)" },
];

const CMAP_GROUPS = Array.from(new Set(CMAPS.map((c) => c.group)));

const STRING_DTYPES = ["object", "string", "category", "bool"];
function isStringDtype(dtype: string | undefined): boolean {
  if (!dtype) return false;
  return STRING_DTYPES.some((s) => dtype.toLowerCase().includes(s));
}

/** Custom colormap picker showing gradient + name in the dropdown list. */
function CmapSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = CMAPS.find((c) => c.id === value) ?? CMAPS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <div ref={ref} className="nf-cmap-picker">
      <button type="button" className="nf-cmap-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="nf-cmap-bar-sm" style={{ backgroundImage: current.gradient }} />
        <span className="nf-cmap-trigger-name">{current.id}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#888" }}>▾</span>
      </button>
      {open ? (
        <div className="nf-cmap-dropdown">
          {CMAP_GROUPS.map((grp) => (
            <div key={grp} className="nf-cmap-group">
              <div className="nf-cmap-group-label">{grp}</div>
              {CMAPS.filter((c) => c.group === grp).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`nf-cmap-option${c.id === value ? " nf-cmap-option-active" : ""}`}
                  onClick={() => { onChange(c.id); setOpen(false); }}
                >
                  <span className="nf-cmap-bar-sm" style={{ backgroundImage: c.gradient }} />
                  <span>{c.id}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface GeoLayerStylesEditorProps {
  value: unknown;
  info: GeoLayerInfo;
  onChange: (layers: GeoLayerStyle[]) => void;
}

export function GeoLayerStylesEditor({ value, info, onChange }: GeoLayerStylesEditorProps) {
  const layers: GeoLayerStyle[] = Array.isArray(value) ? (value as GeoLayerStyle[]) : [];
  const [openSet, setOpenSet] = useState<Set<number>>(new Set([0]));

  const getLayer = (i: number): GeoLayerStyle => layers[i] ?? {};
  const patchLayer = (i: number, patch: Partial<GeoLayerStyle>) => {
    const next: GeoLayerStyle[] = [];
    for (let k = 0; k < info.count; k += 1) next.push(layers[k] ?? {});
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const toggleOpen = (i: number) =>
    setOpenSet((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <div className="nf-geo-layers">
      {Array.from({ length: info.count }, (_, i) => {
        const st = getLayer(i);
        const cols = info.columns[i] ?? [];
        const dtypes = info.dtypes[i] ?? {};
        const col = st.column ?? "";
        const colIsString = col ? isStringDtype(dtypes[col]) : false;
        const cmap = st.cmap ?? "viridis";
        const fill = st.fill_color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
        const isClassMode = colIsString || st.mode !== "continuous";
        const open = openSet.has(i);
        const swatchGradient = col ? (CMAPS.find((c) => c.id === cmap)?.gradient ?? "") : "";

        return (
          <div key={i} className="nf-geo-layer">
            <button type="button" className="nf-geo-layer-head" onClick={() => toggleOpen(i)}>
              <span className="nf-group-arrow">{open ? "▾" : "▸"}</span>
              <span
                className="nf-geo-layer-swatch"
                style={{ background: col ? undefined : fill, backgroundImage: swatchGradient }}
              />
              <span className="nf-geo-layer-title">{`Layer ${i + 1}`}</span>
              <span className="nf-muted" style={{ fontSize: 11 }}>
                {col ? `${col} · ${colIsString ? "Classified" : (st.mode === "continuous" ? "Continuous" : "Classified")}` : "solid color"}
              </span>
            </button>

            {open ? (
              <div className="nf-geo-layer-body">
                {/* Column selector */}
                <label className="nf-field">
                  <span className="nf-field-label">column (empty = solid color)</span>
                  {cols.length > 0 ? (
                    <select value={col} onChange={(e) => patchLayer(i, { column: e.target.value })}>
                      <option value="">— solid color —</option>
                      {cols.map((c) => (
                        <option key={c} value={c}>{c}{isStringDtype(dtypes[c]) ? " (text)" : ""}</option>
                      ))}
                    </select>
                  ) : (
                    <input type="text" value={col} placeholder="Run upstream node to list columns"
                      onChange={(e) => patchLayer(i, { column: e.target.value })} />
                  )}
                </label>

                {col ? (
                  <>
                    {/* Color mode */}
                    <label className="nf-field">
                      <span className="nf-field-label">color mode</span>
                      <select
                        value={colIsString ? "class" : (st.mode === "continuous" ? "continuous" : "class")}
                        disabled={colIsString}
                        onChange={(e) => patchLayer(i, { mode: e.target.value as GeoLayerStyle["mode"] })}
                      >
                        <option value="class">Classified</option>
                        <option value="continuous">Continuous</option>
                      </select>
                      {colIsString ? (
                        <span className="nf-field-hint">Text column — Classified automatically.</span>
                      ) : null}
                    </label>

                    {/* Scheme + k (only for Classified) */}
                    {isClassMode ? (
                      <div className="nf-field-row-2">
                        <label className="nf-field">
                          <span className="nf-field-label">scheme</span>
                          <select
                            value={st.scheme ?? "NaturalBreaks"}
                            onChange={(e) => patchLayer(i, { scheme: e.target.value })}
                          >
                            {CLASS_SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                        {SCHEMES_WITH_K.has(st.scheme ?? "NaturalBreaks") ? (
                          <label className="nf-field">
                            <span className="nf-field-label">classes (k)</span>
                            <input type="number" min={2} max={20} step={1} value={st.k ?? 5}
                              onChange={(e) => patchLayer(i, { k: Math.max(2, Math.min(20, Number(e.target.value))) })} />
                          </label>
                        ) : (
                          <div className="nf-field">
                            <span className="nf-field-label" style={{ color: "#aaa" }}>classes (k)</span>
                            <span className="nf-field-hint">n/a for {st.scheme ?? "this scheme"}</span>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {/* Color ramp */}
                    <div className="nf-field">
                      <span className="nf-field-label">color ramp</span>
                      <CmapSelect value={cmap} onChange={(v) => patchLayer(i, { cmap: v })} />
                    </div>

                    {/* Fill alpha */}
                    <label className="nf-field">
                      <span className="nf-field-label">fill alpha ({(st.fill_alpha ?? 0.75).toFixed(2)})</span>
                      <input type="range" min={0} max={1} step={0.05} value={st.fill_alpha ?? 0.75}
                        onChange={(e) => patchLayer(i, { fill_alpha: Number(e.target.value) })} />
                    </label>
                  </>
                ) : (
                  /* Solid color mode */
                  <div className="nf-field-row-2">
                    <label className="nf-field">
                      <span className="nf-field-label">fill color</span>
                      <input type="color" value={fill}
                        onChange={(e) => patchLayer(i, { fill_color: e.target.value })} />
                    </label>
                    <label className="nf-field">
                      <span className="nf-field-label">fill alpha ({(st.fill_alpha ?? 0.75).toFixed(2)})</span>
                      <input type="range" min={0} max={1} step={0.05} value={st.fill_alpha ?? 0.75}
                        onChange={(e) => patchLayer(i, { fill_alpha: Number(e.target.value) })} />
                    </label>
                  </div>
                )}

                {/* Boundary */}
                <div className="nf-field-row-2">
                  <label className="nf-field">
                    <span className="nf-field-label">boundary color</span>
                    <input type="color" value={st.edge_color ?? "#333333"}
                      onChange={(e) => patchLayer(i, { edge_color: e.target.value })} />
                  </label>
                  <label className="nf-field">
                    <span className="nf-field-label">boundary width</span>
                    <input type="number" min={0} step={0.1} value={st.edge_width ?? 0.4}
                      onChange={(e) => patchLayer(i, { edge_width: Number(e.target.value) })} />
                  </label>
                </div>
                <label className="nf-field">
                  <span className="nf-field-label">boundary alpha ({(st.edge_alpha ?? 1).toFixed(2)})</span>
                  <input type="range" min={0} max={1} step={0.05} value={st.edge_alpha ?? 1}
                    onChange={(e) => patchLayer(i, { edge_alpha: Number(e.target.value) })} />
                </label>
                <label className="nf-field">
                  <span className="nf-field-label">marker size (points only)</span>
                  <input type="number" min={1} step={1} value={st.marker_size ?? 20}
                    onChange={(e) => patchLayer(i, { marker_size: Number(e.target.value) })} />
                </label>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
