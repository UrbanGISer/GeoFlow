import { Handle, NodeProps, Node, Position } from "@xyflow/react";
import type { FlowNodeData } from "../types";

/** KNIME-style vertical input/output bar inside a group/component subflow. */
export function GroupBarNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const isInput = (data.type as string) === "group_input_bar";
  const portCount = Math.max(1, (data.params?.portCount as number) ?? 1);
  const handles = Array.from({ length: portCount }, (_, i) =>
    i === 0 ? (isInput ? "df_out" : "df_in") : (isInput ? `df_out_${i + 1}` : `df_in_${i + 1}`)
  );
  const barHeight = Math.max(56, (portCount + 2) * 24);

  // Same even, centered distribution as FlowNode ports: split the height into
  // (n + 2) slots so the first/last slots act as top/bottom padding.
  const pct = (idx: number) => ((idx + 1.5) / (portCount + 2)) * 100;

  return (
    <div
      className={`nf-bar-node${isInput ? " nf-bar-node--in" : " nf-bar-node--out"}${selected ? " nf-bar-node--selected" : ""}`}
      style={{ height: barHeight }}
    >
      <div className="nf-bar-node-label">{isInput ? "IN" : "OUT"}</div>

      {/* Port number labels (visual only), aligned with each handle */}
      {handles.map((hid, idx) => (
        <div key={`num-${hid}`} className="nf-bar-port-row" style={{ top: `${pct(idx)}%`, transform: "translateY(-50%)" }}>
          <span className="nf-bar-port-num">{idx + 1}</span>
        </div>
      ))}

      {/* Handles — left/right come from the shared .nf-handle-in/.nf-handle-out CSS
          (flush triangle), vertical spread via the (n+2) percentage. */}
      {handles.map((hid, idx) => (
        <Handle
          key={hid}
          type={isInput ? "source" : "target"}
          position={isInput ? Position.Right : Position.Left}
          id={hid}
          className={`nf-flow-handle nf-handle-${isInput ? "out" : "in"}`}
          style={{ top: `${pct(idx)}%` }}
          title={hid}
        />
      ))}
    </div>
  );
}
