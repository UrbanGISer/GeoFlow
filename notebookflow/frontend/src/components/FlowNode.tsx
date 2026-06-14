import { useEffect, useRef, useState } from "react";
import { Handle, NodeProps, Node, Position, useUpdateNodeInternals } from "@xyflow/react";
import type { FlowNodeData } from "../types";
import { inputHandleId } from "../types";
import { usePortActions } from "./portActions";

/** KNIME-style note under the node: double-click to edit, Esc cancels, blur commits. */
function EditableAnnotation({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <textarea
        className="nf-node-annotation-edit nodrag nopan"
        value={draft}
        autoFocus
        rows={Math.max(1, draft.split("\n").length)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onCommit(draft.trimEnd());
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <div
      className="nf-node-annotation"
      title="Double-click to edit note"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </div>
  );
}

export function FlowNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { addInput, removeInput, updateNodeData } = usePortActions();
  const updateNodeInternals = useUpdateNodeInternals();
  const [portEdit, setPortEdit] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const inputCount = data.showInput ? Math.max(1, data.inputCount ?? 1) : 0;
  const showOutput = data.showOutput ?? true;
  const inHandleIds = (data.inputHandles as string[] | undefined) ??
    Array.from({ length: inputCount }, (_, i) => inputHandleId(i + 1));
  const outHandleIds: string[] = showOutput
    ? (data.outputHandles as string[] | undefined) ?? [data.outputHandle as string]
    : [];

  // Re-measure handle positions when the port layout changes so existing
  // edges re-anchor to the moved ports. Skipped on mount — calling
  // updateNodeInternals before the node is measured wipes its handle
  // bounds and edges never render.
  const prevCountRef = useRef(inputCount);
  useEffect(() => {
    if (prevCountRef.current !== inputCount) {
      prevCountRef.current = inputCount;
      updateNodeInternals(id);
    }
  }, [id, inputCount, updateNodeInternals]);

  // Port-edit popover dismisses on any click outside the node.
  useEffect(() => {
    if (!portEdit) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) {
        setPortEdit(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [portEdit]);

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

  // Tall core when many ports so handles don't overlap.
  const coreHeight = Math.max(40, Math.max(inputCount, outHandleIds.length) * 16 + 8);

  const openPortEdit = data.dynamicInputs
    ? (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        setPortEdit(true);
      }
    : undefined;

  return (
    <div className="nf-flow-node-root" ref={rootRef} style={{ height: coreHeight }}>
      <div className="nf-flow-node-caption nf-flow-node-caption-top">{data.label}</div>
      <div className="nf-flow-node-core">
        {inHandleIds.map((hid, idx) => (
          <Handle
            key={hid}
            type="target"
            position={Position.Left}
            id={hid}
            className={`nf-flow-handle ${hid.startsWith("img_") ? "nf-handle-img-in" : "nf-handle-in"}`}
            style={{ top: `${((idx + 1 + 0.5) / (inputCount + 2)) * 100}%` }}
            title={hid}
            onClick={openPortEdit}
          />
        ))}
        {data.dynamicInputs ? (
          <button
            type="button"
            className="nf-port-strip nodrag"
            title="Edit input ports"
            onClick={openPortEdit}
            aria-label="Edit input ports"
          />
        ) : null}
        <div
          className={squareClass.trim()}
          style={{ backgroundColor: data.color, height: "100%" }}
        />
        {outHandleIds.map((hid, idx) => (
          <Handle
            key={hid}
            type="source"
            position={Position.Right}
            id={hid}
            className={`nf-flow-handle ${hid === "img_out" ? "nf-handle-img-out" : "nf-handle-out"}`}
            style={outHandleIds.length > 1
              ? { top: `${((idx + 1) / (outHandleIds.length + 1)) * 100}%` }
              : undefined}
            title={hid}
          />
        ))}
        {data.dynamicInputs && portEdit ? (
          <div className="nf-port-popover nodrag">
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
          </div>
        ) : null}
      </div>
      <EditableAnnotation
        value={(data.annotation as string) ?? ""}
        onCommit={(text) => updateNodeData(id, { annotation: text })}
      />
    </div>
  );
}
