import type { ComposeWorkflowResponse } from "../types";

interface PlanReviewPanelProps {
  composeResult: ComposeWorkflowResponse | null;
}

export function PlanReviewPanel({ composeResult }: PlanReviewPanelProps) {
  if (!composeResult) return null;
  return (
    <section className="nf-ai-review">
      <h3 className="nf-panel-title">Compose Review</h3>
      <p className="nf-muted">
        Nodes: {composeResult.workflow.nodes.length} · Temp nodes: {composeResult.generated_node_specs.length}
      </p>
      {composeResult.validation.warnings.length ? (
        <ul className="nf-warn-list">
          {composeResult.validation.warnings.map((w, i) => (
            <li key={`${w}-${i}`}>{w}</li>
          ))}
        </ul>
      ) : null}
      <ul className="nf-warn-list">
        {composeResult.suggestions.map((s, i) => (
          <li key={`${s.step_title}-${i}`}>
            {s.step_title} → {s.chosen_node_id} ({Math.round(s.confidence * 100)}%)
            {s.used_temporary ? " [temporary]" : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
