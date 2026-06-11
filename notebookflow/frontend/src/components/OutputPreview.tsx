import { artifactUrl } from "../api/client";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { List, type RowComponentProps } from "react-window";
import type { NodeOutputsEntry } from "../types";

interface OutputPreviewProps {
  title?: string;
  nodeId?: string;
  nodeLabel?: string;
  output?: NodeOutputsEntry;
  errorMessage?: string | null;
  logs?: string[];
  /** Inline layout for use inside the Node Notebook modal */
  variant?: "panel" | "embedded";
  /** Extra class on outer section (e.g. split-panel column) */
  sectionClassName?: string;
}

function OutputPreviewInner({
  title = "Console",
  nodeId,
  nodeLabel,
  output,
  errorMessage,
  logs,
  variant = "panel",
  sectionClassName = "",
}: OutputPreviewProps) {
  const df = output?.df_out;
  const previewRows = df?.preview ?? [];
  const html = output?.html_out;
  const [expanded, setExpanded] = useState<null | "table" | "html">(null);
  const htmlSrcCache = useRef<Record<string, string>>({});

  const wrapClass =
    (variant === "embedded" ? "nf-output-embedded" : "nf-bottom-panel nf-bottom-console") +
    (sectionClassName ? ` ${sectionClassName}` : "");
  const htmlSrc = html ? artifactUrl(html.artifact_url) : undefined;

  useEffect(() => {
    if (nodeId && htmlSrc) {
      htmlSrcCache.current[nodeId] = htmlSrc;
    }
  }, [nodeId, htmlSrc]);

  const cachedHtmlSrc = nodeId
    ? htmlSrcCache.current[nodeId] ?? htmlSrc
    : htmlSrc;

  // Logs live in the left rail's ≣ Logs tab — the bottom panel is
  // output-only (table / map / chart) to stay uncluttered.
  return (
    <section className={wrapClass}>
      <div className="nf-bottom-head">
        {title ? <h2 className="nf-panel-title">{title}</h2> : null}
        {nodeLabel ? <span className="nf-bottom-node-label" title={nodeLabel}>{nodeLabel}</span> : null}
      </div>
      <div className="nf-bottom-body">
        {errorMessage ? (
          <div className="nf-error-banner">{errorMessage}</div>
        ) : null}

        {!output && !errorMessage ? (
          <p className="nf-muted">Select a node or run the workflow. Output and short logs appear here.</p>
        ) : null}

        {df ? (
          <div className="nf-preview-block">
            <div className="nf-preview-headline">
              <p className="nf-preview-meta">
                DataFrame · {df.rows} rows · {df.columns.length} columns
                {df.rows > 0 && previewRows.length === 0 ? (
                  <span className="nf-preview-warn"> · preview rows unavailable</span>
                ) : null}
              </p>
              <button type="button" className="nf-btn nf-btn-sm" onClick={() => setExpanded("table")}>
                Expand
              </button>
            </div>
            <div className="nf-table-wrap">
              <table className="nf-table">
                <thead>
                  <tr>
                    {df.columns.map((c) => (
                      <th key={c}>
                        {c}
                        {df.dtypes?.[c] ? (
                          <span className="nf-col-dtype">{df.dtypes[c]}</span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
              <VirtualTableBody rows={previewRows} columns={df.columns} rowHeight={30} height={300} />
            </div>
          </div>
        ) : null}

        {html ? (
          <div className="nf-preview-block">
            <div className="nf-preview-headline">
              <p className="nf-preview-meta">HTML View</p>
              <button type="button" className="nf-btn nf-btn-sm" onClick={() => setExpanded("html")}>
                Expand
              </button>
            </div>
            {cachedHtmlSrc ? (
              <iframe className="nf-html-frame" title="html-preview" src={cachedHtmlSrc} />
            ) : null}
          </div>
        ) : null}

        {variant === "embedded" && logs && logs.length > 0 ? (
          <details className="nf-logs">
            <summary>Logs ({logs.length})</summary>
            <pre>{logs.join("\n")}</pre>
          </details>
        ) : null}
      </div>

      {expanded && (df || html) ? (
        <div className="nf-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="expanded-output-title">
          <button type="button" className="nf-modal-backdrop" aria-label="Close" onClick={() => setExpanded(null)} />
          <div className="nf-modal nf-expand-modal">
            <header className="nf-modal-header">
              <div>
                <h2 id="expanded-output-title">{expanded === "table" ? "Expanded Table View" : "Expanded Map/View"}</h2>
                {nodeLabel ? <p className="nf-modal-sub">{nodeLabel}</p> : null}
              </div>
              <div className="nf-modal-actions">
                <button type="button" className="nf-btn" onClick={() => setExpanded(null)}>
                  Close
                </button>
              </div>
            </header>
            <div className="nf-modal-body nf-expand-modal-body">
              {expanded === "table" && df ? (
                <div className="nf-expand-table-wrap">
                  <table className="nf-table nf-table-expanded">
                    <thead>
                      <tr>
                        {df.columns.map((c) => (
                          <th key={c}>
                            {c}
                            {df.dtypes?.[c] ? (
                              <span className="nf-col-dtype">{df.dtypes[c]}</span>
                            ) : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                  <VirtualTableBody
                    rows={previewRows}
                    columns={df.columns}
                    rowHeight={34}
                    height={Math.max(220, Math.min(680, previewRows.length * 34))}
                    expanded
                  />
                </div>
              ) : null}

              {expanded === "html" && cachedHtmlSrc ? (
                <iframe className="nf-html-frame nf-html-frame-expanded" title="html-preview-expanded" src={cachedHtmlSrc} />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface VirtualTableBodyProps {
  rows: Record<string, unknown>[];
  columns: string[];
  height: number;
  rowHeight: number;
  expanded?: boolean;
}

interface VirtualRowData {
  rows: Record<string, unknown>[];
  columns: string[];
}

function VirtualTableBody({ rows, columns, height, rowHeight, expanded = false }: VirtualTableBodyProps) {
  const data = useMemo<VirtualRowData>(() => ({ rows, columns }), [rows, columns]);
  const visibleHeight = Math.min(height, Math.max(rowHeight, rows.length * rowHeight));
  return (
    <div className={expanded ? "nf-vtable nf-vtable-expanded" : "nf-vtable"}>
      <List
        rowCount={rows.length}
        rowHeight={rowHeight}
        rowComponent={VirtualRow}
        rowProps={data}
        overscanCount={6}
        style={{ height: visibleHeight }}
      />
    </div>
  );
}

function VirtualRow({
  index,
  style,
  rows,
  columns,
}: RowComponentProps<VirtualRowData>) {
  const row = rows[index];
  return (
    <div className="nf-vtable-row" style={style}>
      {columns.map((c) => (
        <div className="nf-vtable-cell" key={`${index}-${c}`}>
          {formatCell(cellAt(row, c))}
        </div>
      ))}
    </div>
  );
}

function cellAt(row: Record<string, unknown>, col: string): unknown {
  if (col in row) return row[col];
  const alt = String(col);
  if (alt in row) return row[alt];
  return undefined;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function propsEqual(prev: OutputPreviewProps, next: OutputPreviewProps): boolean {
  return (
    prev.title === next.title &&
    prev.nodeId === next.nodeId &&
    prev.nodeLabel === next.nodeLabel &&
    prev.errorMessage === next.errorMessage &&
    prev.variant === next.variant &&
    prev.sectionClassName === next.sectionClassName &&
    prev.output === next.output &&
    prev.logs === next.logs
  );
}

export const OutputPreview = memo(OutputPreviewInner, propsEqual);
