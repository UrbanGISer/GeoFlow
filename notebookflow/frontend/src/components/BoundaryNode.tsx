import { Handle, NodeProps, Node, Position } from "@xyflow/react";
import type { FlowNodeData } from "../types";

export function BoundaryNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const isPortIn = (data.type as string) === "port_in";
  return (
    <div className={`nf-boundary-node${isPortIn ? " nf-boundary-in" : " nf-boundary-out"}${selected ? " nf-boundary-selected" : ""}`}>
      {isPortIn ? (
        <>
          <div className="nf-boundary-label">▶ Port In</div>
          <Handle
            type="source"
            position={Position.Right}
            id="df_out"
            className="nf-flow-handle nf-handle-out"
          />
        </>
      ) : (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="df_in"
            className="nf-flow-handle nf-handle-in"
          />
          <div className="nf-boundary-label">Port Out ▶</div>
        </>
      )}
    </div>
  );
}
