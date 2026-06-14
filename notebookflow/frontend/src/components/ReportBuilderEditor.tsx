import { useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
type CellType = "heading" | "text" | "image";
type TextAlign = "left" | "center" | "right";

interface ReportCell {
  id: string;
  type: CellType;
  // heading / text
  content?: string;
  fontSize?: number;
  fontColor?: string;
  textAlign?: TextAlign;
  lineHeight?: number;
  showDivider?: boolean;
  // image
  imgPort?: number;
  caption?: string;
  fit?: "contain" | "cover";
  // common
  bg?: string;
  padding?: number;
}

interface ReportSection {
  id: string;
  columns: ReportCell[];
  gap?: number;
  bg?: string;
}

interface Props {
  params: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  /** Number of connected img_in ports (for port selector range) */
  imgPortCount?: number;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function defaultCell(type: CellType, imgPort = 1): ReportCell {
  if (type === "heading") return { id: uid(), type: "heading", content: "Section Heading", fontSize: 16, fontColor: "#222", textAlign: "left", showDivider: true };
  if (type === "image")   return { id: uid(), type: "image", imgPort, caption: "" };
  return { id: uid(), type: "text", content: "Text block.", fontSize: 13, fontColor: "#333", textAlign: "left", lineHeight: 1.6 };
}

// ── Small inline controls ─────────────────────────────────────────────────────
function Sel({ value, opts, onChange }: { value: string; opts: [string, string][]; onChange: (v: string) => void }) {
  return (
    <select className="nf-param-input" style={{ fontSize: 11, padding: "2px 4px", height: 22 }} value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
function Num({ value, min, max, onChange }: { value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <input type="number" className="nf-param-input" style={{ width: 52, fontSize: 11, padding: "2px 4px", height: 22 }}
      value={value} min={min} max={max}
      onChange={(e) => { const n = parseFloat(e.target.value); if (!isNaN(n)) onChange(n); }} />
  );
}
function Txt({ value, placeholder, onChange, multiline }: { value: string; placeholder?: string; onChange: (v: string) => void; multiline?: boolean }) {
  if (multiline) return (
    <textarea className="nf-param-input" style={{ fontSize: 11, padding: "3px 6px", resize: "vertical", minHeight: 52, width: "100%", boxSizing: "border-box" }}
      value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  );
  return (
    <input type="text" className="nf-param-input" style={{ fontSize: 11, padding: "2px 6px", height: 22, width: "100%", boxSizing: "border-box" }}
      value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  );
}
function Chk({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input type="color" value={value || "#333333"} onChange={(e) => onChange(e.target.value)}
        style={{ width: 24, height: 22, padding: 1, border: "1px solid #ccc", borderRadius: 3, cursor: "pointer" }} />
      <input type="text" className="nf-param-input" value={value || ""} placeholder="#333333"
        style={{ width: 72, fontSize: 11, padding: "2px 4px", height: 22 }}
        onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

// ── Cell editor ───────────────────────────────────────────────────────────────
function CellEditor({ cell, imgPortCount, onChange, onRemove, isOnly }: {
  cell: ReportCell;
  imgPortCount: number;
  onChange: (patch: Partial<ReportCell>) => void;
  onRemove: () => void;
  isOnly: boolean;
}) {
  const ta = cell.textAlign ?? "left";
  return (
    <div className="nf-rb-cell-editor">
      <div className="nf-rb-cell-header">
        <Sel value={cell.type} opts={[["heading", "Heading"], ["text", "Text"], ["image", "Image"]]} onChange={(v) => onChange({ type: v as CellType })} />
        {!isOnly && (
          <button type="button" className="nf-rb-icon-btn nf-rb-remove-btn" title="Remove cell" onClick={onRemove}>×</button>
        )}
      </div>

      {cell.type === "image" && (
        <div className="nf-rb-cell-body">
          <div className="nf-rb-field-row">
            <span className="nf-rb-label">Port</span>
            <Sel value={String(cell.imgPort ?? 1)}
              opts={Array.from({ length: Math.max(imgPortCount, cell.imgPort ?? 1) }, (_, i) => [String(i + 1), `img_in${i === 0 ? "" : `_${i + 1}`}`])}
              onChange={(v) => onChange({ imgPort: parseInt(v) })} />
          </div>
          <div className="nf-rb-field-row">
            <span className="nf-rb-label">Caption</span>
            <Txt value={cell.caption ?? ""} placeholder="optional caption" onChange={(v) => onChange({ caption: v })} />
          </div>
          <div className="nf-rb-field-row">
            <span className="nf-rb-label">Fit</span>
            <Sel value={cell.fit ?? "contain"} opts={[["contain", "Contain"], ["cover", "Cover"]]} onChange={(v) => onChange({ fit: v as "contain" | "cover" })} />
          </div>
        </div>
      )}

      {(cell.type === "heading" || cell.type === "text") && (
        <div className="nf-rb-cell-body">
          <Txt value={cell.content ?? ""} placeholder="Enter content…" multiline onChange={(v) => onChange({ content: v })} />
          <div className="nf-rb-field-row">
            <span className="nf-rb-label">Size</span>
            <Num value={cell.fontSize ?? 13} min={8} max={48} onChange={(v) => onChange({ fontSize: v })} />
            <span className="nf-rb-label" style={{ marginLeft: 8 }}>Color</span>
            <ColorInput value={cell.fontColor ?? "#333"} onChange={(v) => onChange({ fontColor: v })} />
          </div>
          <div className="nf-rb-field-row">
            <span className="nf-rb-label">Align</span>
            <Sel value={ta} opts={[["left", "Left"], ["center", "Center"], ["right", "Right"]]} onChange={(v) => onChange({ textAlign: v as TextAlign })} />
            {cell.type === "text" && <>
              <span className="nf-rb-label" style={{ marginLeft: 8 }}>Line-H</span>
              <Num value={cell.lineHeight ?? 1.6} min={1} max={3} onChange={(v) => onChange({ lineHeight: v })} />
            </>}
          </div>
          {cell.type === "heading" && (
            <Chk checked={cell.showDivider !== false} label="Show divider line" onChange={(v) => onChange({ showDivider: v })} />
          )}
        </div>
      )}

      <div className="nf-rb-cell-footer">
        <span className="nf-rb-label">BG</span>
        <ColorInput value={cell.bg ?? ""} onChange={(v) => onChange({ bg: v })} />
        <span className="nf-rb-label" style={{ marginLeft: 8 }}>Pad</span>
        <Num value={cell.padding ?? 12} min={0} max={48} onChange={(v) => onChange({ padding: v })} />
      </div>
    </div>
  );
}

// ── Section row ───────────────────────────────────────────────────────────────
function SectionRow({ sec, idx, total, imgPortCount, onChange, onRemove, onMove }: {
  sec: ReportSection;
  idx: number;
  total: number;
  imgPortCount: number;
  onChange: (s: ReportSection) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const updateCell = (ci: number, patch: Partial<ReportCell>) => {
    const cols = sec.columns.map((c, i) => i === ci ? { ...c, ...patch } : c);
    onChange({ ...sec, columns: cols });
  };
  const removeCell = (ci: number) => {
    if (sec.columns.length <= 1) return;
    onChange({ ...sec, columns: sec.columns.filter((_, i) => i !== ci) });
  };
  const addCell = (type: CellType) => {
    if (sec.columns.length >= 4) return;
    const nextPort = sec.columns.filter(c => c.type === "image").length + 1;
    onChange({ ...sec, columns: [...sec.columns, defaultCell(type, nextPort)] });
  };

  const colLabels: Record<number, string> = { 1: "1 col", 2: "2 col", 3: "3 col", 4: "4 col" };
  const n = sec.columns.length;

  return (
    <div className="nf-rb-section">
      <div className="nf-rb-section-header">
        <span className="nf-rb-section-title">Row {idx + 1} — {colLabels[n]}</span>
        <div className="nf-rb-section-actions">
          {[1, 2, 3, 4].map((k) => (
            <button key={k} type="button"
              className={`nf-rb-cols-btn${n === k ? " nf-rb-cols-btn--active" : ""}`}
              title={`${k} column${k > 1 ? "s" : ""}`}
              onClick={() => {
                if (k === n) return;
                let cols = [...sec.columns];
                while (cols.length < k) cols.push(defaultCell("text"));
                if (cols.length > k) cols = cols.slice(0, k);
                onChange({ ...sec, columns: cols });
              }}>
              {k}
            </button>
          ))}
          <span style={{ width: 8 }} />
          <button type="button" className="nf-rb-icon-btn" title="Move up" disabled={idx === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" className="nf-rb-icon-btn" title="Move down" disabled={idx === total - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" className="nf-rb-icon-btn nf-rb-remove-btn" title="Remove row" onClick={onRemove}>×</button>
        </div>
      </div>

      <div className="nf-rb-cells" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {sec.columns.map((cell, ci) => (
          <CellEditor key={cell.id} cell={cell} imgPortCount={imgPortCount}
            onChange={(p) => updateCell(ci, p)}
            onRemove={() => removeCell(ci)}
            isOnly={n === 1} />
        ))}
      </div>

      {n < 4 && (
        <div className="nf-rb-add-cell-row">
          <span style={{ fontSize: 10, color: "#888" }}>Add cell:</span>
          {(["image", "text", "heading"] as CellType[]).map((t) => (
            <button key={t} type="button" className="nf-rb-add-cell-btn" onClick={() => addCell(t)}>+ {t}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────
export function ReportBuilderEditor({ params, onChange, imgPortCount = 1 }: Props) {
  const title = String(params.title ?? "Report");
  const accentColor = String(params.accent_color ?? "#1976d2");
  const sections: ReportSection[] = (params.sections as ReportSection[] | undefined) ?? [];

  const update = useCallback((key: string, value: unknown) => {
    onChange({ [key]: value });
  }, [onChange]);

  const updateSection = useCallback((i: number, s: ReportSection) => {
    const next = sections.map((x, j) => j === i ? s : x);
    update("sections", next);
  }, [sections, update]);

  const removeSection = useCallback((i: number) => {
    update("sections", sections.filter((_, j) => j !== i));
  }, [sections, update]);

  const moveSection = useCallback((i: number, dir: -1 | 1) => {
    const next = [...sections];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    update("sections", next);
  }, [sections, update]);

  const addSection = useCallback((type: CellType) => {
    const imgPort = sections.flatMap(s => s.columns).filter(c => c.type === "image").length + 1;
    update("sections", [...sections, {
      id: uid(),
      columns: [defaultCell(type, imgPort)],
    }]);
  }, [sections, update]);

  return (
    <div className="nf-rb-editor">
      {/* Global settings */}
      <div className="nf-rb-global">
        <div className="nf-rb-field-row">
          <span className="nf-rb-label" style={{ fontWeight: 600 }}>Title</span>
          <Txt value={title} placeholder="Report title" onChange={(v) => update("title", v)} />
        </div>
        <div className="nf-rb-field-row">
          <span className="nf-rb-label" style={{ fontWeight: 600 }}>Accent</span>
          <ColorInput value={accentColor} onChange={(v) => update("accent_color", v)} />
        </div>
      </div>

      <div className="nf-rb-divider" />

      {/* Sections */}
      {sections.length === 0 && (
        <div style={{ padding: "12px 8px", color: "#999", fontSize: 12, textAlign: "center" }}>
          No rows yet — add one below.
        </div>
      )}
      {sections.map((sec, i) => (
        <SectionRow key={sec.id} sec={sec} idx={i} total={sections.length}
          imgPortCount={imgPortCount}
          onChange={(s) => updateSection(i, s)}
          onRemove={() => removeSection(i)}
          onMove={(dir) => moveSection(i, dir)} />
      ))}

      {/* Add row buttons */}
      <div className="nf-rb-add-row">
        <span style={{ fontSize: 11, color: "#666", fontWeight: 600 }}>Add row:</span>
        {(["image", "text", "heading"] as CellType[]).map((t) => (
          <button key={t} type="button" className="nf-rb-add-row-btn" onClick={() => addSection(t)}>
            + {t}
          </button>
        ))}
      </div>
    </div>
  );
}
