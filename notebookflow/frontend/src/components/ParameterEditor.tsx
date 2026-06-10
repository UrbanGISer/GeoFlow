import type { ParameterSpec } from "../types";

interface ParameterEditorProps {
  parameters: ParameterSpec[];
  params: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  upstreamColumns: string[];
  onUploadFile: (file: File) => Promise<void>;
}

export function ParameterEditor({
  parameters,
  params,
  onChange,
  upstreamColumns,
  onUploadFile,
}: ParameterEditorProps) {
  const setField = (name: string, value: unknown) => {
    onChange({ ...params, [name]: value });
  };

  return (
    <div className="nf-params">
      {parameters.map((p) => {
        const key = p.name;
        const val = params[key];

        if (p.type === "file") {
          return (
            <label key={key} className="nf-field">
              <span className="nf-field-label">
                {key}
                {p.required ? " *" : ""}
              </span>
              <input
                type="file"
                accept=".csv,.json,.geojson,.gpkg,.shp,.parquet,text/csv,application/json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) await onUploadFile(f);
                }}
              />
              {typeof val === "string" && val ? (
                <span className="nf-field-hint">{val}</span>
              ) : null}
            </label>
          );
        }

        if (p.type === "boolean") {
          return (
            <label key={key} className="nf-field nf-field-row">
              <input
                type="checkbox"
                checked={Boolean(val)}
                onChange={(e) => setField(key, e.target.checked)}
              />
              <span>
                {key}
                {p.required ? " *" : ""}
              </span>
            </label>
          );
        }

        if (p.type === "number") {
          return (
            <label key={key} className="nf-field">
              <span className="nf-field-label">
                {key}
                {p.required ? " *" : ""}
              </span>
              <input
                type="number"
                value={val === undefined || val === null ? "" : Number(val)}
                onChange={(e) => setField(key, e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
          );
        }

        if (p.type === "enum" && p.options) {
          return (
            <label key={key} className="nf-field">
              <span className="nf-field-label">
                {key}
                {p.required ? " *" : ""}
              </span>
              <select
                value={String(val ?? p.default ?? "")}
                onChange={(e) => setField(key, e.target.value)}
              >
                {p.options.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        if (p.type === "column") {
          if (upstreamColumns.length > 0) {
            return (
              <label key={key} className="nf-field">
                <span className="nf-field-label">
                  {key}
                  {p.required ? " *" : ""}
                </span>
                <select
                  value={String(val ?? "")}
                  onChange={(e) => setField(key, e.target.value || null)}
                >
                  <option value="">—</option>
                  {upstreamColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <label key={key} className="nf-field">
              <span className="nf-field-label">
                {key}
                {p.required ? " *" : ""}
              </span>
              <input
                type="text"
                value={val === undefined || val === null ? "" : String(val)}
                onChange={(e) => setField(key, e.target.value)}
                placeholder="Column name"
              />
            </label>
          );
        }

        if (p.type === "column_list") {
          if (upstreamColumns.length > 0) {
            const selected = Array.isArray(val) ? (val as unknown[]) : [];
            const setSel = (col: string, checked: boolean) => {
              const cur = new Set(selected.map(String));
              if (checked) cur.add(col);
              else cur.delete(col);
              setField(key, Array.from(cur));
            };
            return (
              <fieldset key={key} className="nf-field">
                <legend className="nf-field-label">
                  {key}
                  {p.required ? " *" : ""}
                </legend>
                <div className="nf-multi">
                  {upstreamColumns.map((c) => (
                    <label key={c} className="nf-field-row">
                      <input
                        type="checkbox"
                        checked={selected.map(String).includes(c)}
                        onChange={(e) => setSel(c, e.target.checked)}
                      />
                      <span>{c}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          }
          return (
            <label key={key} className="nf-field">
              <span className="nf-field-label">
                {key}
                {p.required ? " *" : ""}
              </span>
              <input
                type="text"
                value={
                  Array.isArray(val)
                    ? val.join(", ")
                    : val === undefined || val === null
                      ? ""
                      : String(val)
                }
                onChange={(e) =>
                  setField(
                    key,
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="col_a, col_b"
              />
            </label>
          );
        }

        return (
          <label key={key} className="nf-field">
            <span className="nf-field-label">
              {key}
              {p.required ? " *" : ""}
            </span>
            <input
              type="text"
              value={val === undefined || val === null ? "" : String(val)}
              onChange={(e) => setField(key, e.target.value)}
            />
          </label>
        );
      })}
    </div>
  );
}
