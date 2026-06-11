import type { DragEvent, MouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Node,
  NodeTypes,
  OnConnect,
  OnEdgesChange,
  OnNodesChange,
  OnNodesDelete,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowNodeData } from "../types";
import { FlowNode } from "./FlowNode";
import { DRAG_TYPE } from "./NodeLibrary";

const nodeTypes: NodeTypes = { notebook: FlowNode };

interface WorkflowCanvasInnerProps {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node<FlowNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onNodesDelete?: OnNodesDelete<Node<FlowNodeData>>;
  onNodeDoubleClick: (_: MouseEvent, node: Node<FlowNodeData>) => void;
  onNodeClick: (_: MouseEvent, node: Node<FlowNodeData>) => void;
  onDropSpec?: (specId: string, position: { x: number; y: number }) => void;
}

function WorkflowCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodesDelete,
  onNodeDoubleClick,
  onNodeClick,
  onDropSpec,
}: WorkflowCanvasInnerProps) {
  const empty = nodes.length === 0;
  const { screenToFlowPosition } = useReactFlow();

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const specId = e.dataTransfer.getData(DRAG_TYPE);
    if (!specId || !onDropSpec) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onDropSpec(specId, position);
  };

  return (
    <div className="nf-canvas-wrap">
      <div className="nf-canvas-head">
        <h2 className="nf-panel-title">Canvas</h2>
        <span className="nf-canvas-sub">
          Click or drag nodes from the left panel. Double-click a node to edit code.
        </span>
      </div>
      <div
        className="nf-flow-host"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          nodeTypes={nodeTypes}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeClick={onNodeClick}
          deleteKeyCode="Delete"
          fitView
          defaultEdgeOptions={{ style: { stroke: "#222", strokeWidth: 1.5 } }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d0d0d0" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {empty ? (
          <div className="nf-canvas-empty" aria-hidden="true">
            <p className="nf-canvas-empty-title">Canvas</p>
            <p className="nf-canvas-empty-hint">Click or drag a node from the left panel to add it here.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasInnerProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
