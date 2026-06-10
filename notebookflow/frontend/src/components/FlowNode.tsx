import { Handle, NodeProps, Position } from "@xyflow/react";
import type { FlowNodeData } from "../types";

export function FlowNode({ data, selected }: NodeProps<FlowNodeData>) {
  const statusRing =
    data.status === "running"
      ? "nf-flow-node-square--running"
      : data.status === "success"
        ? "nf-flow-node-square--success"
        : data.status === "error"
          ? "nf-flow-node-square--error"
          : "";

  const squareClass =
    "nf-flow-node-square " +
    (selected ? "nf-flow-node-square--selected " : "") +
    statusRing;

  return (
    <div className="nf-flow-node-root">
      <div className="nf-flow-node-core">
        {data.showInput ? (
          <Handle
            type="target"
            position={Position.Left}
            id="df_in"
            className="nf-flow-handle"
            style={{ background: "#111", width: 8, height: 8, border: "none" }}
          />
        ) : null}
        <div className={squareClass.trim()} style={{ backgroundColor: data.color }} />
        <Handle
          type="source"
          position={Position.Right}
          id={data.outputHandle}
          className="nf-flow-handle"
          style={{ background: "#111", width: 8, height: 8, border: "none" }}
        />
      </div>
      <div className="nf-flow-node-caption">{data.label}</div>
    </div>
  );
}
