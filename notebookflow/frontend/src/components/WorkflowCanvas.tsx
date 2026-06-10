import type { MouseEvent } from "react";
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { FlowNodeData } from "../types";
import { FlowNode } from "./FlowNode";

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
}: WorkflowCanvasInnerProps) {
  const empty = nodes.length === 0;

  return (
    <div className="nf-canvas-wrap">
      <div className="nf-canvas-head">
        <h2 className="nf-panel-title">Canvas</h2>
        <span className="nf-canvas-sub">Connect nodes. Double-click a node to edit code.</span>
      </div>
      <div className="nf-flow-host">
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
            <p className="nf-canvas-empty-hint">Click a node on the left to add it here.</p>
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
