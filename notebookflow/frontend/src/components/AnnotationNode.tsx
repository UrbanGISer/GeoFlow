import { useState } from "react";
import { NodeProps, Node, NodeResizer, NodeToolbar, Position } from "@xyflow/react";
import { usePortActions } from "./portActions";

/** Free-floating text box (KNIME workflow annotation): movable, resizable,
 * editable text with configurable fill / border / font color and size.
 * Leave the text empty to use it as a plain color band. Excluded from runs. */

export interface AnnotationBoxData {
  [key: string]: unknown;
  text: string;
  fill: string;
  fontSize: number;
  fontColor: string;
  borderColor: string;
}

export const ANNOTATION_NODE_TYPE = "annotation";

export const DEFAULT_ANNOTATION_DATA: AnnotationBoxData = {
  text: "",
  fill: "#fff9c4",
  fontSize: 13,
  fontColor: "#333333",
  borderColor: "#f9a825",
};

export function AnnotationNode({ id, data, selected }: NodeProps<Node<AnnotationBoxData>>) {
  const { updateNodeData } = usePortActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.text);

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={60}
        minHeight={28}
        lineStyle={{ borderColor: "#1976d2" }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2 }}
      />
      <NodeToolbar
        isVisible={!!selected && !editing}
        position={Position.Top}
        className="nf-anno-toolbar nodrag"
      >
        <label title="Fill color">
          ▨
          <input
            type="color"
            value={data.fill}
            onChange={(e) => updateNodeData(id, { fill: e.target.value })}
          />
        </label>
        <label title="Border color">
          ▢
          <input
            type="color"
            value={data.borderColor}
            onChange={(e) => updateNodeData(id, { borderColor: e.target.value })}
          />
        </label>
        <label title="Font color">
          A
          <input
            type="color"
            value={data.fontColor}
            onChange={(e) => updateNodeData(id, { fontColor: e.target.value })}
          />
        </label>
        <label title="Font size">
          <input
            type="number"
            min={8}
            max={48}
            value={data.fontSize}
            onChange={(e) => updateNodeData(id, { fontSize: Number(e.target.value) || 13 })}
          />
          px
        </label>
      </NodeToolbar>
      <div
        className="nf-annotation-box"
        style={{ background: data.fill, borderColor: data.borderColor }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(data.text);
          setEditing(true);
        }}
        title={editing ? undefined : "Double-click to edit text"}
      >
        {editing ? (
          <textarea
            className="nf-annotation-edit nodrag nopan"
            autoFocus
            value={draft}
            style={{ fontSize: data.fontSize, color: data.fontColor }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              updateNodeData(id, { text: draft });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setDraft(data.text);
                setEditing(false);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div
            className="nf-annotation-text"
            style={{ fontSize: data.fontSize, color: data.fontColor }}
          >
            {data.text}
          </div>
        )}
      </div>
    </>
  );
}
