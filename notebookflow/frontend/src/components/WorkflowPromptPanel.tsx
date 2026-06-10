import { useState } from "react";
import { composeWorkflow, importGISLibrary, planWorkflow } from "../api/client";
import type { ComposeWorkflowResponse, WorkflowPlanResponse } from "../types";

interface WorkflowPromptPanelProps {
  onComposed: (res: ComposeWorkflowResponse) => void;
}

export function WorkflowPromptPanel({ onComposed }: WorkflowPromptPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [dataContext, setDataContext] = useState("");
  const [constraints, setConstraints] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<WorkflowPlanResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <section className="nf-ai-panel">
      <h2 className="nf-panel-title">AI Workflow Builder</h2>
      <textarea
        className="nf-textarea"
        rows={4}
        placeholder="Describe the analysis goal..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <textarea
        className="nf-textarea"
        rows={2}
        placeholder="Optional data context"
        value={dataContext}
        onChange={(e) => setDataContext(e.target.value)}
      />
      <textarea
        className="nf-textarea"
        rows={2}
        placeholder="Optional constraints"
        value={constraints}
        onChange={(e) => setConstraints(e.target.value)}
      />
      <div className="nf-toolbar-actions">
        <button
          type="button"
          className="nf-btn"
          disabled={busy || !prompt.trim()}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const p = await planWorkflow({ prompt, data_context: dataContext, constraints, max_steps: 8 });
              setPlan(p);
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Plan
        </button>
        <button
          type="button"
          className="nf-btn nf-btn-primary"
          disabled={busy || !prompt.trim()}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const res = await composeWorkflow({
                prompt,
                data_context: dataContext,
                constraints,
                max_steps: 8,
                allow_temporary_nodes: true,
                confidence_threshold: 0.45,
              });
              onComposed(res);
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Compose
        </button>
        <button
          type="button"
          className="nf-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const imported = await importGISLibrary({
                articles: [
                  {
                    title: "Kernel Density Hotspot Mapping",
                    method: "Convert point events into density surface and classify hotspots",
                    inputs: ["GeoDataFrame"],
                    outputs: ["html map"],
                    pseudo_steps: ["load points", "estimate density", "render map"],
                    example_params: { bandwidth: 500 },
                  },
                ],
              });
              setMsg(`GIS nodes imported: ${imported.imported}`);
            } catch (e) {
              setMsg(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Seed GIS Nodes
        </button>
      </div>
      {plan ? (
        <div className="nf-ai-plan">
          <strong>Plan Steps</strong>
          <ol>
            {plan.steps.map((s, i) => (
              <li key={`${s.title}-${i}`}>{s.title} - {s.intent}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {msg ? <p className="nf-muted">{msg}</p> : null}
    </section>
  );
}
