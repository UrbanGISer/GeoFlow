import { Handle, NodeProps, Node, Position } from "@xyflow/react";
import type { FlowNodeData } from "../types";
import { inputHandleId } from "../types";
import { usePortActions } from "./portActions";

export function FlowNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { addInput, removeInput } = usePortActions();

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

  const inputCount = data.showInput ? Math.max(1, data.inputCount ?? 1) : 0;
  const handles = Array.from({ length: inputCount }, (_, i) => i + 1);
  // Tall core when many ports so handles don't overlap.
  const coreHeight = Math.max(40, inputCount * 16 + 8);

  return (
    <div className="nf-flow-node-root">
      <div className="nf-flow-node-core" style={{ height: coreHeight }}>
        {handles.map((portIndex) => (
          <Handle
            key={portIndex}
            type="target"
            position={Position.Left}
            id={inputHandleId(portIndex)}
            className="nf-flow-handle"
            style={{
              background: "#111",
              width: 8,
              height: 8,
              border: "none",
              top: `${(portIndex * 100) / (inputCount + 1)}%`,
            }}
            title={inputHandleId(portIndex)}
          />
        ))}
        <div
          className={squareClass.trim()}
          style={{ backgroundColor: data.color, height: "100%" }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id={data.outputHandle}
          className="nf-flow-handle"
          style={{ background: "#111", width: 8, height: 8, border: "none" }}
        />
      </div>
      {data.dynamicInputs ? (
        <div className="nf-flow-port-controls nodrag">
          {inputCount > 1 ? (
            <button
              type="button"
              className="nf-port-btn"
              title="Remove last input port"
              onClick={(e) => {
                e.stopPropagation();
                removeInput(id);
              }}
            >
              −
            </button>
          ) : null}
          <button
            type="button"
            className="nf-port-btn"
            title="Add input port"
            onClick={(e) => {
              e.stopPropagation();
              addInput(id);
            }}
          >
            +
          </button>
        </div>
      ) : null}
      <div className="nf-flow-node-caption">{data.label}</div>
    </div>
  );
}
