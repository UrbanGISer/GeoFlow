import { useEffect, useRef, useState } from "react";
import { Handle, NodeProps, Node, Position } from "@xyflow/react";
import type { FlowNodeData } from "../types";
import { groupBridge } from "../groupBridge";
import { usePortActions } from "./portActions";

function EditableAnnotation({ value, onCommit }: { value: string; onCommit: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <textarea
        className="nf-node-annotation-edit nodrag nopan"
        value={draft}
        rows={Math.max(1, draft.split("\n").length)}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); onCommit(draft.trimEnd()); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") { setEditing(false); setDraft(value); }
          // Enter inserts newline — do NOT exit
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <div
      className="nf-node-annotation nodrag"
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(value); }}
      title="Double-click to edit"
    >
      {value || <span style={{ color: "#bbb" }}>Node</span>}
    </div>
  );
}

export function GroupNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { updateNodeData, addGroupInput, removeGroupInput, addGroupOutput, removeGroupOutput } = usePortActions();
  const groupType = (data.groupType as "group" | "component") ?? "group";
  const inputHandles = (data.inputHandles as string[] | undefined) ?? [];
  const outputHandles = (data.outputHandles as string[] | undefined) ?? [];
  const annotation = (data.annotation as string) ?? "";

  const [inputPortEdit, setInputPortEdit] = useState(false);
  const [outputPortEdit, setOutputPortEdit] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss popovers on click outside
  useEffect(() => {
    if (!inputPortEdit && !outputPortEdit) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) {
        setInputPortEdit(false);
        setOutputPortEdit(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [inputPortEdit, outputPortEdit]);

  const inputCount = inputHandles.length;
  const coreHeight = Math.max(40, Math.max(inputCount, outputHandles.length) * 16 + 8);
  const nodeColor = groupType === "component" ? "#7b1fa2" : "#9c27b0";

  return (
    <div
      className="nf-flow-node-root"
      ref={rootRef}
      style={{ height: coreHeight }}
      onDoubleClick={(e) => { e.stopPropagation(); groupBridge.enterGroup(id); }}
    >
      {/* Top label: type name */}
      <div className={`nf-flow-node-caption nf-flow-node-caption-top${selected ? " nf-group-caption--selected" : ""}`}>
        {groupType === "component" ? "Component" : "Group"}
      </div>

      {/* Core: same square as FlowNode, fills root */}
      <div className="nf-flow-node-core">
        {inputHandles.map((hid, idx) => (
          <Handle
            key={hid}
            type="target"
            position={Position.Left}
            id={hid}
            className="nf-flow-handle nf-handle-in"
            style={{ top: `${((idx + 1 + 0.5) / (inputCount + 2)) * 100}%` }}
            title={hid}
            onClick={(e) => { e.stopPropagation(); setInputPortEdit(true); }}
          />
        ))}

        {/* Input port strip — always visible for groups (even at 0 ports) */}
        <button
          type="button"
          className="nf-port-strip nodrag"
          title="Edit input ports"
          onClick={(e) => { e.stopPropagation(); setInputPortEdit((v) => !v); }}
          aria-label="Edit input ports"
          style={{ left: 0 }}
        />

        <div
          className={`nf-flow-node-square${selected ? " nf-flow-node-square--selected" : ""}`}
          style={{ backgroundColor: nodeColor, height: "100%" }}
        />

        {/* Output port strip */}
        <button
          type="button"
          className="nf-port-strip nf-port-strip-right nodrag"
          title="Edit output ports"
          onClick={(e) => { e.stopPropagation(); setOutputPortEdit((v) => !v); }}
          aria-label="Edit output ports"
          style={{ right: 0, left: "auto" }}
        />

        {outputHandles.map((hid, idx) => (
          <Handle
            key={hid}
            type="source"
            position={Position.Right}
            id={hid}
            className={`nf-flow-handle ${hid === "img_out" ? "nf-handle-img-out" : "nf-handle-out"}`}
            style={outputHandles.length > 1
              ? { top: `${((idx + 1) / (outputHandles.length + 1)) * 100}%` }
              : undefined}
            title={hid}
            onClick={(e) => { e.stopPropagation(); setOutputPortEdit(true); }}
          />
        ))}

        {/* Input popover */}
        {inputPortEdit && (
          <div className="nf-port-popover nf-port-popover-left nodrag">
            <button type="button" className="nf-port-btn" title="Add input port"
              onClick={(e) => { e.stopPropagation(); addGroupInput(id); }}>+</button>
            {inputCount > 0 && (
              <button type="button" className="nf-port-btn" title="Remove last input port"
                onClick={(e) => { e.stopPropagation(); removeGroupInput(id); }}>−</button>
            )}
          </div>
        )}

        {/* Output popover */}
        {outputPortEdit && (
          <div className="nf-port-popover nf-port-popover-right nodrag">
            <button type="button" className="nf-port-btn" title="Add output port"
              onClick={(e) => { e.stopPropagation(); addGroupOutput(id); }}>+</button>
            {outputHandles.length > 0 && (
              <button type="button" className="nf-port-btn" title="Remove last output port"
                onClick={(e) => { e.stopPropagation(); removeGroupOutput(id); }}>−</button>
            )}
          </div>
        )}
      </div>

      {/* Bottom annotation: editable */}
      <EditableAnnotation
        value={annotation}
        onCommit={(text) => updateNodeData(id, { annotation: text })}
      />
    </div>
  );
}
