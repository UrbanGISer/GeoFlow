import type { DragEvent, MouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Node,
  NodeTypes,
  OnConnect,
  OnConnectStart,
  OnEdgesChange,
  OnNodesChange,
  OnNodesDelete,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type OnConnectEnd,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import "@xyflow/react/dist/style.css";
import type { FlowNodeData } from "../types";
import { AnnotationNode } from "./AnnotationNode";
import { GroupBarNode } from "./GroupBarNode";
import { FlowNode } from "./FlowNode";
import { GroupNode } from "./GroupNode";
import { DRAG_TYPE } from "./NodeLibrary";
import { PortActionsContext, type PortActions } from "./portActions";
import { groupBridge } from "../groupBridge";

const nodeTypes: NodeTypes = {
  notebook: FlowNode,
  annotation: AnnotationNode,
  flowGroup: GroupNode,
  group_input_bar: GroupBarNode,
  group_output_bar: GroupBarNode,
};

// Cap fit-to-view zoom so small workflows don't open at the 2× max. ~3 zoom-out
// clicks (factor 1.2 each) below the default max: 2 / 1.2³ ≈ 1.15.
const FIT_VIEW_OPTIONS = { maxZoom: 1.15, minZoom: 0.2 } as const;

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
  onAddInput?: (nodeId: string) => void;
  onRemoveInput?: (nodeId: string) => void;
  onAddGroupInput?: (nodeId: string) => void;
  onRemoveGroupInput?: (nodeId: string) => void;
  onAddGroupOutput?: (nodeId: string) => void;
  onRemoveGroupOutput?: (nodeId: string) => void;
  onUpdateNodeData?: (nodeId: string, patch: Record<string, unknown>) => void;
  onNodeMenu?: (pos: { x: number; y: number }, node: Node<FlowNodeData>) => void;
  onSelectionMenu?: (pos: { x: number; y: number }, nodes: Node<FlowNodeData>[]) => void;
  onEdgeMenu?: (pos: { x: number; y: number }, edge: Edge) => void;
  onPaneMenu?: (pos: { x: number; y: number }, flowPos: { x: number; y: number }) => void;
  onConnectStart?: (nodeId: string, handleId: string | null) => void;
  /** Called when a drag-connection is released. When dropped on empty space,
   *  isValid is false/null — the caller can show an "add node" picker. */
  onConnectEnd?: (info: {
    x: number;
    y: number;
    flowPos: { x: number; y: number };
    fromNodeId: string;
    fromHandleId: string | null;
    isValid: boolean | null;
  }) => void;
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
  onAddInput,
  onRemoveInput,
  onAddGroupInput,
  onRemoveGroupInput,
  onAddGroupOutput,
  onRemoveGroupOutput,
  onUpdateNodeData,
  onNodeMenu,
  onSelectionMenu,
  onEdgeMenu,
  onPaneMenu,
  onConnectStart,
  onConnectEnd,
}: WorkflowCanvasInnerProps) {
  const empty = nodes.length === 0;
  const { screenToFlowPosition, getViewport, setViewport, fitView } = useReactFlow();

  // Let App save/restore the viewport per level so entering/exiting a subflow
  // returns to exactly where the user left off.
  useEffect(() => {
    groupBridge.getViewport = () => getViewport();
    groupBridge.setViewport = (vp) => setViewport(vp);
    groupBridge.fitView = () => fitView(FIT_VIEW_OPTIONS);
    return () => {
      groupBridge.getViewport = () => ({ x: 0, y: 0, zoom: 1 });
      groupBridge.setViewport = () => {};
      groupBridge.fitView = () => {};
    };
  }, [getViewport, setViewport, fitView]);

  const portActions = useMemo<PortActions>(
    () => ({
      addInput: (nodeId) => onAddInput?.(nodeId),
      removeInput: (nodeId) => onRemoveInput?.(nodeId),
      addGroupInput: (nodeId) => onAddGroupInput?.(nodeId),
      removeGroupInput: (nodeId) => onRemoveGroupInput?.(nodeId),
      addGroupOutput: (nodeId) => onAddGroupOutput?.(nodeId),
      removeGroupOutput: (nodeId) => onRemoveGroupOutput?.(nodeId),
      updateNodeData: (nodeId, patch) => onUpdateNodeData?.(nodeId, patch),
    }),
    [onAddInput, onRemoveInput, onAddGroupInput, onRemoveGroupInput, onAddGroupOutput, onRemoveGroupOutput, onUpdateNodeData],
  );

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
          Double-click or drag library nodes to add (auto-connects from the selected node). Double-click a canvas node to edit code.
        </span>
      </div>
      <div
        className="nf-flow-host"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <PortActionsContext.Provider value={portActions}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart as OnConnectStart | undefined}
          onConnectEnd={((event, connectionState) => {
            if (!onConnectEnd) return;
            const e = event as MouseEvent | TouchEvent;
            const clientX = "touches" in e ? e.changedTouches[0].clientX : (e as MouseEvent).clientX;
            const clientY = "touches" in e ? e.changedTouches[0].clientY : (e as MouseEvent).clientY;
            const fromNode = (connectionState as { fromNode?: { id: string } }).fromNode;
            const fromHandle = (connectionState as { fromHandle?: { id: string } }).fromHandle;
            onConnectEnd({
              x: clientX,
              y: clientY,
              flowPos: screenToFlowPosition({ x: clientX, y: clientY }),
              fromNodeId: fromNode?.id ?? "",
              fromHandleId: fromHandle?.id ?? null,
              isValid: (connectionState as { isValid?: boolean | null }).isValid ?? null,
            });
          }) as OnConnectEnd}
          onNodesDelete={onNodesDelete}
          nodeTypes={nodeTypes}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeClick={onNodeClick}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            onNodeMenu?.({ x: e.clientX, y: e.clientY }, node);
          }}
          onSelectionContextMenu={(e, selNodes) => {
            e.preventDefault();
            onSelectionMenu?.({ x: e.clientX, y: e.clientY }, selNodes as Node<FlowNodeData>[]);
          }}
          onEdgeContextMenu={(e, edge) => {
            e.preventDefault();
            onEdgeMenu?.({ x: e.clientX, y: e.clientY }, edge);
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            const pos = { x: e.clientX, y: e.clientY };
            onPaneMenu?.(pos, screenToFlowPosition(pos));
          }}
          deleteKeyCode={["Delete", "Backspace"]}
          // KNIME-style rubber-band: left-drag on empty canvas selects;
          // pan with middle-button drag or scroll/trackpad. Right button
          // stays reserved for the context menu. Partial overlap selects.
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1]}
          panOnScroll
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.2}
          defaultEdgeOptions={{ style: { stroke: "#222", strokeWidth: 1.5 } }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d0d0d0" />
          <Controls showInteractive={false} />
        </ReactFlow>
        </PortActionsContext.Provider>
        {empty ? (
          <div className="nf-canvas-empty" aria-hidden="true">
            <p className="nf-canvas-empty-title">Canvas</p>
            <p className="nf-canvas-empty-hint">Double-click or drag a node from the left panel to add it here.</p>
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
