import { Fragment, type ReactNode } from "react";

/** Minimal markdown renderer for node descriptions — no external deps.
 * Supports: ### headings, **bold**, *italic*, `inline code`, fenced ``` blocks,
 * - bullet lists, and paragraphs. Enough for Info-tab docs.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Tokenize by code first so ** inside backticks isn't styled.
  const parts = text.split(/(`[^`]+`)/g);
  parts.forEach((part, pi) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out.push(<code key={`${keyPrefix}-c${pi}`}>{part.slice(1, -1)}</code>);
      return;
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    boldParts.forEach((bp, bi) => {
      const key = `${keyPrefix}-${pi}-${bi}`;
      if (bp.startsWith("**") && bp.endsWith("**") && bp.length > 4) {
        out.push(<strong key={key}>{bp.slice(2, -2)}</strong>);
      } else if (bp) {
        const italicParts = bp.split(/(\*[^*]+\*)/g);
        italicParts.forEach((ip, ii) => {
          const ikey = `${key}-${ii}`;
          if (ip.startsWith("*") && ip.endsWith("*") && ip.length > 2) {
            out.push(<em key={ikey}>{ip.slice(1, -1)}</em>);
          } else if (ip) {
            out.push(<Fragment key={ikey}>{ip}</Fragment>);
          }
        });
      }
    });
  });
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push(
        <pre key={`b${key++}`} className="nf-md-pre">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h${key}`);
      blocks.push(
        level <= 2 ? (
          <h3 key={`b${key++}`} className="nf-md-h">{content}</h3>
        ) : (
          <h4 key={`b${key++}`} className="nf-md-h">{content}</h4>
        ),
      );
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={`b${key++}`} className="nf-md-ul">
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `li${key}-${ii}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Paragraph: gather consecutive non-empty, non-special lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`b${key++}`} className="nf-md-p">
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return <div className="nf-md">{blocks}</div>;
}
