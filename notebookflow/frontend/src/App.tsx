import type { ChangeEvent, MouseEvent } from "react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";
import { exportIpynb, fetchNodeSpecs, runNodeInGroup, runSingleNode, runWorkflow, workspaceRead, workspaceSaveFile } from "./api/client";
import { AIStudioPage } from "./components/AIStudioPage";
import {
  ANNOTATION_NODE_TYPE,
  DEFAULT_ANNOTATION_DATA,
  type AnnotationBoxData,
} from "./components/AnnotationNode";
import { CanvasContextMenu, type ContextMenuItem } from "./components/CanvasContextMenu";
import { LeftPanel, SideRail, type LeftTab } from "./components/LeftPanel";
import { NodeNotebookModal } from "./components/NodeNotebookModal";
import { OutputPreview } from "./components/OutputPreview";
import { PlanReviewPanel } from "./components/PlanReviewPanel";
import { SaveWorkflowModal } from "./components/SaveWorkflowModal";
import { SelectedNodePanel } from "./components/SelectedNodePanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import { groupBridge, type ViewportState } from "./groupBridge";
import { inputHandleId } from "./types";
import type {
  AnnotationBoxPayload,
  ComposeWorkflowResponse,
  DataFrameOutputSummary,
  FlowNodeData,
  NodeOutputsMap,
  NodeSpec,
  NotebookStandardizeResponse,
  SubflowData,
  WorkflowEdgePayload,
  WorkflowNodePayload,
} from "./types";
import { Group, Panel, Separator } from "react-resizable-panels";
import "./styles.css";

function newNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Returns true for img_in, img_in_2, … handles. */
function isImgHandle(h: string | null | undefined): boolean {
  return h === "img_in" || (typeof h === "string" && h.startsWith("img_in_"));
}

function flowExtras(
  spec: NodeSpec,
): Pick<FlowNodeData, "showInput" | "outputHandle" | "showOutput" | "inputCount" | "dynamicInputs" | "outputHandles" | "inputHandles"> {
  const inputKeys = Object.keys(spec.inputs);
  const inputCount = inputKeys.length;
  const hasDf = Object.keys(spec.outputs).includes("df_out");
  const hasImg = Object.keys(spec.outputs).includes("img_out");

  // Connectable output handles (html_out is view-only, no downstream port)
  const outputHandles: string[] = [];
  if (hasDf) outputHandles.push("df_out");
  if (hasImg) outputHandles.push("img_out");

  return {
    showInput: inputCount > 0,
    outputHandle: hasDf ? "df_out" : hasImg ? "img_out" : "html_out",
    showOutput: hasDf || hasImg,
    outputHandles: outputHandles.length > 0 ? outputHandles : undefined,
    inputHandles: inputKeys.length > 0 ? inputKeys : undefined,
    inputCount: Math.max(1, inputCount),
    dynamicInputs: Boolean(spec.dynamic_inputs),
  };
}

function isAnnotation(n: Node<FlowNodeData>): boolean {
  return n.type === ANNOTATION_NODE_TYPE;
}

function buildPayload(nodes: Node<FlowNodeData>[], edges: Edge[]): {
  nodes: WorkflowNodePayload[];
  edges: WorkflowEdgePayload[];
} {
  return {
    // Text boxes are UI-only — never sent to the engine.
    nodes: nodes.filter((n) => !isAnnotation(n)).map((n) => ({
      id: n.id,
      type: n.data.type,
      label: n.data.label,
      category: n.data.category,
      position: { x: n.position.x, y: n.position.y },
      params: n.data.params,
      code: n.data.code,
      input_count: n.data.inputCount,
      annotation: n.data.annotation ?? "",
      ...(n.data.groupType ? { group_type: n.data.groupType } : {}),
      ...(n.data.subflow ? { subflow: n.data.subflow as SubflowData } : {}),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };
}

interface SavedWorkflow {
  nodes: Array<WorkflowNodePayload & { position: { x: number; y: number } }>;
  edges: WorkflowEdgePayload[];
  annotations?: AnnotationBoxPayload[];
}

/** Reconstruct a live flowGroup node from a saved/subflow group/component payload.
 *  Ports come from the subflow's input_map/output_map (the actual wired ports),
 *  falling back to input_count. Used by restore, enter-group, and expand so nested
 *  components render correctly at every level instead of as gray notebook nodes. */
function buildGroupNode(
  sn: WorkflowNodePayload,
  annotation: string,
  position: { x: number; y: number },
  status: FlowNodeData["status"] = "idle",
): Node<FlowNodeData> {
  const gType = (sn.group_type ?? sn.type) as "group" | "component";
  const idxOf = (h: string) => (h === "df_in" || h === "df_out" ? 1 : Number(h.split("_").pop()) || 1);
  const distinct = (arr: SubflowData["input_map"]) =>
    [...new Set((arr ?? []).map((m) => m.groupHandle))].sort((a, b) => idxOf(a) - idxOf(b));
  let inHandles = distinct(sn.subflow?.input_map);
  if (inHandles.length === 0 && sn.input_count && sn.input_count > 0) {
    inHandles = Array.from({ length: sn.input_count }, (_, k) => (k === 0 ? "df_in" : `df_in_${k + 1}`));
  }
  const outHandles = distinct(sn.subflow?.output_map);
  return {
    id: sn.id,
    type: "flowGroup",
    position,
    data: {
      label: sn.label,
      type: gType,
      category: "Group",
      params: sn.params ?? {},
      code: "",
      status,
      color: "#7b1fa2",
      annotation,
      groupType: gType,
      subflow: sn.subflow,
      showInput: inHandles.length > 0,
      showOutput: outHandles.length > 0,
      outputHandle: "df_out",
      inputHandles: inHandles.length > 0 ? inHandles : undefined,
      outputHandles: outHandles.length > 0 ? outHandles : undefined,
      inputCount: inHandles.length,
    },
  };
}

interface ClipboardContent {
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    width?: number;
    height?: number;
    zIndex?: number;
    data: FlowNodeData;
  }>;
  edges: Array<{
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
}

interface CtxMenuState {
  kind: "node" | "edge" | "pane";
  x: number;
  y: number;
  targetId?: string;
  targetType?: string;
  flowPos?: { x: number; y: number };
  /** All selected node IDs when the menu was opened (for multi-select ops) */
  selectionIds?: string[];
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Returns all ancestor node IDs that are upstream of (feed into) the given node. */
function getUpstreamIds(nodeId: string, edges: Edge[]): string[] {
  const visited = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.target === id && !visited.has(e.source)) {
        visited.add(e.source);
        queue.push(e.source);
      }
    }
  }
  return [...visited];
}

const CUSTOM_NODES_STORAGE_KEY = "notebookflow.customNodeSpecs.v1";

interface GroupStackEntry {
  groupNodeId: string;
  groupLabel: string;
  groupType: "group" | "component";
  parentNodes: Node<FlowNodeData>[];
  parentEdges: Edge[];
  /** Viewport of the parent level at the moment we entered this group. */
  parentViewport?: ViewportState;
}

interface WorkflowTab {
  id: string;
  name: string;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  /** Workspace path the workflow was opened from / last saved to. */
  filePath?: string;
  /** Navigation stack for drilling into group subflows. */
  groupStack?: GroupStackEntry[];
}

const INIT_TAB_ID = "tab-1";

/** Build bar node output entries from a group's input_map + outer workflow outputs. */
function buildBarOutputs(
  inputMap: import("./types").SubflowPortMapping[],
  parentEdges: import("@xyflow/react").Edge[],
  groupNodeId: string,
  outerOutputs: NodeOutputsMap,
): NodeOutputsMap {
  const barNodeHandleMap = new Map<string, Record<string, DataFrameOutputSummary>>();
  for (const mapping of inputMap) {
    const outerEdge = parentEdges.find(
      (e) => e.target === groupNodeId && e.targetHandle === mapping.groupHandle,
    );
    if (outerEdge) {
      const srcOut = outerOutputs[outerEdge.source];
      if (srcOut?.df_out) {
        const hMap = barNodeHandleMap.get(mapping.nodeId) ?? {};
        hMap[mapping.nodeHandle] = srcOut.df_out;
        barNodeHandleMap.set(mapping.nodeId, hMap);
      }
    }
  }
  const result: NodeOutputsMap = {};
  for (const [nodeId, hMap] of barNodeHandleMap) {
    const entries = Object.entries(hMap);
    result[nodeId] = entries.length === 1
      ? { df_out: entries[0][1] }
      : { extra_dfs: hMap };
  }
  return result;
}

export default function App() {
  const [specs, setSpecs] = useState<NodeSpec[]>([]);
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  // Workflow tabs — KNIME-style multi-workflow support
  const [tabs, setTabs] = useState<WorkflowTab[]>([
    { id: INIT_TAB_ID, name: "Workflow 1", nodes: [], edges: [] },
  ]);
  const [activeTabId, setActiveTabId] = useState(INIT_TAB_ID);
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);
  const [nodeOutputs, setNodeOutputs] = useState<NodeOutputsMap>({});
  const [lastRunLogs, setLastRunLogs] = useState<string[]>([]);
  const [workflowError, setWorkflowError] = useState<{ nodeId: string | null; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draftParams, setDraftParams] = useState<Record<string, unknown> | null>(null);
  const [draftCode, setDraftCode] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  // Close-tab confirmation dialog
  const [closeTabConfirm, setCloseTabConfirm] = useState<{ tabId: string; tabName: string } | null>(null);
  // Node picker: right-click "Add Node" on canvas, optionally auto-connecting
  const [nodePicker, setNodePicker] = useState<{
    x: number; y: number;
    flowPos: { x: number; y: number };
    connectFrom?: { nodeId: string; handleId: string | null };
  } | null>(null);
  const [nodePickerSearch, setNodePickerSearch] = useState("");
  const nodePickerRef = useRef<HTMLDivElement>(null);
  // Dismiss the node picker when clicking outside it
  useEffect(() => {
    if (!nodePicker) return;
    const onDown = (e: PointerEvent) => {
      if (nodePickerRef.current && !nodePickerRef.current.contains(e.target as HTMLElement)) {
        setNodePicker(null);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [nodePicker]);
  // Track an in-progress connection drag so right-click can auto-connect
  const connectingFromRef = useRef<{ nodeId: string; handleId: string | null } | null>(null);
  const [composeResult, setComposeResult] = useState<ComposeWorkflowResponse | null>(null);
  const [aiStudioOpen, setAiStudioOpen] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState<NodeSpec | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  // KNIME-style icon rail: null = panel collapsed (default).
  const [leftTab, setLeftTab] = useState<LeftTab | null>(null);
  // Right node panel + bottom console fold away to maximize the canvas.
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const clipboardRef = useRef<ClipboardContent | null>(null);
  const pasteCountRef = useRef(0);

  const specById = useMemo(() => {
    const m: Record<string, NodeSpec> = {};
    for (const s of specs) m[s.id] = s;
    return m;
  }, [specs]);

  useEffect(() => {
    fetchNodeSpecs()
      .then((baseSpecs) => {
        const raw = localStorage.getItem(CUSTOM_NODES_STORAGE_KEY);
        if (!raw) { setSpecs(baseSpecs); return; }
        try {
          const custom = JSON.parse(raw) as NodeSpec[];
          const merged = [...baseSpecs];
          const seen = new Set(baseSpecs.map((s) => s.id));
          for (const c of custom) { if (!seen.has(c.id)) merged.push(c); }
          setSpecs(merged);
        } catch { setSpecs(baseSpecs); }
      })
      .catch((e) => console.error(e));
  }, []);

  const mergeSpecs = useCallback((incoming: NodeSpec[]) => {
    if (!incoming.length) return;
    setSpecs((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      incoming.forEach((s) => { if (!byId.has(s.id)) byId.set(s.id, s); });
      return [...byId.values()];
    });
  }, []);

  useEffect(() => {
    if (!selectedId) { setDraftParams(null); setDraftCode(""); return; }
    const n = nodes.find((x) => x.id === selectedId);
    if (!n) { setDraftParams(null); setDraftCode(""); return; }
    setDraftParams(structuredClone(n.data.params));
    setDraftCode(n.data.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ── Undo / Redo ──────────────────────────────────────────────────────────
  const undoStackRef = useRef<Array<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }>>([]);
  const redoStackRef = useRef<Array<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }>>([]);
  const draggingRef = useRef(false);
  const dragSnapshotRef = useRef<{ nodes: Node<FlowNodeData>[]; edges: Edge[] } | null>(null);

  const pushHistory = useCallback(() => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), { nodes: nodesRef.current, edges: edgesRef.current }];
    redoStackRef.current = [];
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, { nodes: nodesRef.current, edges: edgesRef.current }];
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, []);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, { nodes: nodesRef.current, edges: edgesRef.current }];
    setNodes(next.nodes);
    setEdges(next.edges);
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    const posChanges = changes.filter((c) => c.type === "position") as Array<{ type: "position"; dragging?: boolean }>;
    const isDragStart = posChanges.some((c) => c.dragging) && !draggingRef.current;
    const isDragEnd = posChanges.some((c) => !c.dragging) && draggingRef.current;
    const isDelete = changes.some((c) => c.type === "remove");
    if (isDragStart) {
      draggingRef.current = true;
      dragSnapshotRef.current = { nodes: nodesRef.current, edges: edgesRef.current };
    }
    if (isDragEnd && dragSnapshotRef.current) {
      draggingRef.current = false;
      undoStackRef.current = [...undoStackRef.current.slice(-49), dragSnapshotRef.current];
      redoStackRef.current = [];
      dragSnapshotRef.current = null;
    }
    if (isDelete) pushHistory();
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, [pushHistory]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some((c) => c.type === "remove")) pushHistory();
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, [pushHistory]);

  const onConnect = useCallback((params: Connection) => {
    pushHistory();
    const srcH = params.sourceHandle ?? "df_out";
    const tgtH = params.targetHandle ?? "df_in";
    // Type-check: img_out can only connect to img_in, and vice versa
    const srcIsImg = srcH === "img_out";
    const tgtIsImg = isImgHandle(tgtH);
    if (srcIsImg !== tgtIsImg) return;
    const isImg = srcIsImg;
    setEdges((eds) => {
      // Remove any existing edge already connected to the same input port
      const filtered = eds.filter(
        (e) => !(e.target === params.target && e.targetHandle === tgtH),
      );
      return addEdge({
        ...params,
        id: `edge_${params.source}_${params.target}_${Date.now()}`,
        sourceHandle: srcH,
        targetHandle: tgtH,
        style: isImg ? { stroke: "#f57c00", strokeWidth: 2 } : { stroke: "#222", strokeWidth: 1.5 },
      }, filtered);
    });
  }, []);

  const onNodesDelete = useCallback((deleted: Node<FlowNodeData>[]) => {
    const ids = new Set(deleted.map((d) => d.id));
    setEdges((es) => es.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedId((sid) => (sid && ids.has(sid) ? null : sid));
    setModalNodeId((mid) => (mid && ids.has(mid) ? null : mid));
    setNodeOutputs((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { delete next[id]; });
      return next;
    });
  }, []);

  // Default node notes ("Node 1", "Node 2", …) always continue from the
  // highest existing number, so copy/paste and load renumber correctly.
  const nodesRef = useRef<Node<FlowNodeData>[]>([]);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>([]);
  edgesRef.current = edges;
  const nodeOutputsRef = useRef<NodeOutputsMap>({});
  nodeOutputsRef.current = nodeOutputs;
  // Saved viewport per group subflow (keyed by group node id) so re-entering a
  // group restores the last position the user left it at.
  const subflowViewportsRef = useRef<Record<string, ViewportState>>({});

  const switchTab = useCallback((tabId: string) => {
    if (tabId === activeTabId) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, nodes: nodesRef.current, edges: edgesRef.current }
          : t,
      ),
    );
    const target = tabsRef.current.find((t) => t.id === tabId);
    setNodes(target ? structuredClone(target.nodes) : []);
    setEdges(target ? structuredClone(target.edges) : []);
    setActiveTabId(tabId);
    setSelectedId(null);
    setNodeOutputs({});
    setWorkflowError(null);
  }, [activeTabId]);

  const addTab = useCallback(() => {
    const newId = `tab-${Date.now()}`;
    const newName = `Workflow ${tabsRef.current.length + 1}`;
    setTabs((prev) => [
      ...prev.map((t) =>
        t.id === activeTabId
          ? { ...t, nodes: nodesRef.current, edges: edgesRef.current }
          : t,
      ),
      { id: newId, name: newName, nodes: [], edges: [] },
    ]);
    setNodes([]);
    setEdges([]);
    setActiveTabId(newId);
    setSelectedId(null);
    setNodeOutputs({});
    setWorkflowError(null);
  }, [activeTabId]);

  const renameActiveTab = useCallback((name: string) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, name } : t)));
  }, [activeTabId]);


  const closeTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    const hasNodes = tabId === activeTabId ? nodesRef.current.length > 0 : tab.nodes.length > 0;
    if (hasNodes) {
      setCloseTabConfirm({ tabId, tabName: tab.name });
    } else {
      doCloseTab(tabId);
    }
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Must be defined before closeTab is called from the dialog
  function doCloseTab(tabId: string) {
    setCloseTabConfirm(null);
    setTabs((prev) => {
      if (prev.length <= 1) {
        // Last tab — clear canvas instead of removing the tab
        setNodes([]);
        setEdges([]);
        setSelectedId(null);
        setNodeOutputs({});
        setWorkflowError(null);
        return prev.map((t) => (t.id === tabId ? { ...t, name: "Workflow 1", nodes: [], edges: [] } : t));
      }
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      if (tabId === activeTabId) {
        const newActive = next[Math.min(idx, next.length - 1)];
        setNodes(structuredClone(newActive.nodes));
        setEdges(structuredClone(newActive.edges));
        setActiveTabId(newActive.id);
        setSelectedId(null);
        setNodeOutputs({});
        setWorkflowError(null);
      }
      return next;
    });
  }

  // Open a workflow JSON in a NEW tab (used when loading from workspace panel)
  const openWorkflowInNewTab = useCallback((wf: SavedWorkflow, name: string, filePath?: string) => {
    const newId = `tab-${Date.now()}`;
    // Snapshot current tab first
    setTabs((prev) => [
      ...prev.map((t) =>
        t.id === activeTabId
          ? { ...t, nodes: nodesRef.current, edges: edgesRef.current }
          : t,
      ),
      { id: newId, name, nodes: [], edges: [], filePath },
    ]);
    setActiveTabId(newId);
    setSelectedId(null);
    setNodeOutputs({});
    setWorkflowError(null);
    // restoreWorkflow will call setNodes/setEdges for us; call after state settles
    // We store the wf to apply via a ref trick
    pendingLoadRef.current = wf;
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingLoadRef = useRef<SavedWorkflow | null>(null);
  useEffect(() => {
    if (pendingLoadRef.current) {
      restoreWorkflow(pendingLoadRef.current);
      pendingLoadRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  const nextNodeNumber = useCallback((ns: Node<FlowNodeData>[]): number => {
    let max = 0;
    for (const n of ns) {
      const m = /^Node (\d+)$/.exec(String(n.data.annotation ?? ""));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  }, []);

  const buildNode = useCallback(
    (spec: NodeSpec, position: { x: number; y: number }): Node<FlowNodeData> => {
      const extras = flowExtras(spec);
      return {
        id: newNodeId(),
        type: "notebook",
        position,
        data: {
          label: spec.label,
          type: spec.id,
          category: spec.category,
          params: structuredClone(spec.default_params),
          code: spec.default_code,
          status: "idle",
          color: spec.color,
          annotation: `Node ${nextNodeNumber(nodesRef.current)}`,
          ...extras,
        },
      };
    },
    [nextNodeNumber],
  );

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)),
    );
  }, []);

  const addAnnotationBox = useCallback((flowPos: { x: number; y: number }) => {
    const data: AnnotationBoxData & FlowNodeData = {
      ...DEFAULT_ANNOTATION_DATA,
      label: "",
      type: ANNOTATION_NODE_TYPE,
      category: "",
      params: {},
      code: "",
      status: "idle",
      color: "",
      showInput: false,
      outputHandle: "df_out",
      showOutput: false,
    };
    setNodes((ns) => [
      ...ns,
      {
        id: newNodeId(),
        type: ANNOTATION_NODE_TYPE,
        position: flowPos,
        width: 220,
        height: 110,
        zIndex: -1, // behind workflow nodes
        data,
      },
    ]);
  }, []);

  // Node square is 40px; new nodes land 1.5 box-widths to the right of the
  // selected node (gap = 1.5 × 40, so x advances by 2.5 × 40).
  const NODE_BOX = 40;

  const handleAddNode = useCallback(
    (spec: NodeSpec) => {
      const flowNodes = nodes.filter((n) => !isAnnotation(n));
      const sel =
        selectedId !== null
          ? flowNodes.find((n) => n.id === selectedId)
          : undefined;
      let pos: { x: number; y: number };
      if (sel) {
        pos = { x: sel.position.x + NODE_BOX * 2.5, y: sel.position.y };
      } else if (flowNodes.length) {
        const rightmost = flowNodes.reduce((a, b) => (a.position.x >= b.position.x ? a : b));
        pos = { x: rightmost.position.x + NODE_BOX * 2.5, y: rightmost.position.y };
      } else {
        pos = { x: 100, y: 140 };
      }
      // Nudge down while the spot is occupied (e.g. adding several nodes
      // from the same selected source).
      const occupied = (p: { x: number; y: number }) =>
        nodes.some(
          (n) => Math.abs(n.position.x - p.x) < NODE_BOX && Math.abs(n.position.y - p.y) < NODE_BOX,
        );
      while (occupied(pos)) {
        pos = { x: pos.x, y: pos.y + NODE_BOX * 1.5 };
      }
      const node = buildNode(spec, pos);
      setNodes((nds) => [...nds, node]);
      // Auto-connect selected node → new node when the selected node carries
      // data out and the new node accepts an input.
      if (
        sel &&
        (sel.data.showOutput ?? true) &&
        sel.data.outputHandle === "df_out" &&
        node.data.showInput
      ) {
        setEdges((es) => [
          ...es,
          {
            id: `edge_${sel.id}_${node.id}_${Date.now()}`,
            source: sel.id,
            target: node.id,
            sourceHandle: "df_out",
            targetHandle: "df_in",
          },
        ]);
      }
    },
    [nodes, selectedId, buildNode],
  );

  const handleDropSpec = useCallback(
    (specId: string, position: { x: number; y: number }) => {
      const spec = specById[specId];
      if (!spec) return;
      pushHistory();
      setNodes((nds) => [...nds, buildNode(spec, position)]);
    },
    [specById, buildNode, pushHistory],
  );

  const handleAddInputPort = useCallback((nodeId: string) => {
    setNodes((ns) =>
      ns.map((n) => {
        if (!n.data.dynamicInputs || n.id !== nodeId) return n;
        const newCount = Math.max(1, n.data.inputCount ?? 1) + 1;
        const baseHandle = (n.data.inputHandles as string[] | undefined)?.[0] ?? "df_in";
        const isImg = baseHandle.startsWith("img_");
        const newHandle = isImg
          ? (newCount === 1 ? "img_in" : `img_in_${newCount}`)
          : (newCount === 1 ? "df_in" : `df_in_${newCount}`);
        const prevHandles = (n.data.inputHandles as string[] | undefined) ??
          Array.from({ length: n.data.inputCount ?? 1 }, (_, i) => i === 0 ? baseHandle : `${isImg ? "img_in" : "df_in"}_${i + 1}`);
        return {
          ...n,
          data: {
            ...n.data,
            inputCount: newCount,
            inputHandles: [...prevHandles, newHandle],
          },
        };
      }),
    );
  }, []);

  const handleRemoveInputPort = useCallback((nodeId: string) => {
    setNodes((ns) => {
      const node = ns.find((n) => n.id === nodeId);
      if (!node || !node.data.dynamicInputs) return ns;
      const count = Math.max(1, node.data.inputCount ?? 1);
      if (count <= 1) return ns; // last port cannot be removed
      const prevHandles = (node.data.inputHandles as string[] | undefined) ??
        Array.from({ length: count }, (_, i) => inputHandleId(i + 1));
      const removedHandle = prevHandles[prevHandles.length - 1];
      setEdges((es) =>
        es.filter((e) => !(e.target === nodeId && e.targetHandle === removedHandle)),
      );
      return ns.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, inputCount: count - 1, inputHandles: prevHandles.slice(0, -1) } }
          : n,
      );
    });
  }, []);

  const handleAddGroupInput = useCallback((nodeId: string) => {
    setNodes((ns) => ns.map((n) => {
      if (n.id !== nodeId || !n.data.groupType) return n;
      const oldHandles = (n.data.inputHandles as string[] | undefined) ?? [];
      const newIdx = oldHandles.length;
      const newHandle = newIdx === 0 ? "df_in" : `df_in_${newIdx + 1}`;
      const inputHandles = [...oldHandles, newHandle];
      const subflow = n.data.subflow as SubflowData | undefined;
      let updatedSubflow = subflow;
      if (subflow) {
        const gibHandle = newIdx === 0 ? "df_out" : `df_out_${newIdx + 1}`;
        let gib = subflow.nodes.find((sn) => sn.type === "group_input_bar");
        let subNodes: WorkflowNodePayload[];
        if (!gib) {
          // 0-input group gained its first input — create the input bar.
          const minX = Math.min(0, ...subflow.nodes.map((sn) => sn.position?.x ?? 0));
          gib = {
            id: `gib_${Date.now()}`, type: "group_input_bar", label: "Input", category: "Group",
            position: { x: minX - 160, y: 0 }, params: { portCount: inputHandles.length }, code: "",
          };
          subNodes = [...subflow.nodes, gib];
        } else {
          subNodes = subflow.nodes.map((sn) =>
            sn.type === "group_input_bar" ? { ...sn, params: { ...sn.params, portCount: inputHandles.length } } : sn,
          );
        }
        updatedSubflow = {
          ...subflow,
          nodes: subNodes,
          input_map: [...(subflow.input_map ?? []), { groupHandle: newHandle, nodeId: gib.id, nodeHandle: gibHandle }],
        };
      }
      return { ...n, data: { ...n.data, inputHandles, inputCount: inputHandles.length, showInput: true, subflow: updatedSubflow } };
    }));
  }, []);

  const handleRemoveGroupInput = useCallback((nodeId: string) => {
    setNodes((ns) => {
      const node = ns.find((n) => n.id === nodeId);
      if (!node || !node.data.groupType) return ns;
      const oldHandles = (node.data.inputHandles as string[] | undefined) ?? [];
      if (oldHandles.length === 0) return ns;
      const removedHandle = oldHandles[oldHandles.length - 1];
      const inputHandles = oldHandles.slice(0, -1);
      setEdges((es) => es.filter((e) => !(e.target === nodeId && e.targetHandle === removedHandle)));
      const subflow = node.data.subflow as import("./types").SubflowData | undefined;
      const removedGibHandle = oldHandles.length === 1 ? "df_out" : `df_out_${oldHandles.length}`;
      const updatedSubflow = subflow ? {
        ...subflow,
        nodes: subflow.nodes.map((sn) =>
          sn.type === "group_input_bar" ? { ...sn, params: { ...sn.params, portCount: inputHandles.length } } : sn
        ),
        edges: subflow.edges.filter((e) => {
          const gibId = subflow.nodes.find((sn) => sn.type === "group_input_bar")?.id;
          return !(gibId && e.source === gibId && (e.sourceHandle ?? "df_out") === removedGibHandle);
        }),
        input_map: subflow.input_map?.filter((m) => m.groupHandle !== removedHandle),
        direct_input_map: subflow.direct_input_map?.filter((m) => m.groupHandle !== removedHandle),
      } : subflow;
      return ns.map((n) => n.id === nodeId
        ? { ...n, data: { ...n.data, inputHandles, inputCount: inputHandles.length, showInput: inputHandles.length > 0, subflow: updatedSubflow } }
        : n
      );
    });
  }, []);

  const handleAddGroupOutput = useCallback((nodeId: string) => {
    setNodes((ns) => ns.map((n) => {
      if (n.id !== nodeId || !n.data.groupType) return n;
      const oldHandles = (n.data.outputHandles as string[] | undefined) ?? [];
      const newIdx = oldHandles.length;
      const newHandle = newIdx === 0 ? "df_out" : `df_out_${newIdx + 1}`;
      const outputHandles = [...oldHandles, newHandle];
      const subflow = n.data.subflow as SubflowData | undefined;
      let updatedSubflow = subflow;
      if (subflow) {
        const gobHandle = newIdx === 0 ? "df_in" : `df_in_${newIdx + 1}`;
        let gob = subflow.nodes.find((sn) => sn.type === "group_output_bar");
        let subNodes: WorkflowNodePayload[];
        if (!gob) {
          // 0-output group gained its first output — create the output bar.
          const maxX = Math.max(0, ...subflow.nodes.map((sn) => sn.position?.x ?? 0));
          gob = {
            id: `gob_${Date.now()}`, type: "group_output_bar", label: "Output", category: "Group",
            position: { x: maxX + 160, y: 0 }, params: { portCount: outputHandles.length }, code: "",
          };
          subNodes = [...subflow.nodes, gob];
        } else {
          subNodes = subflow.nodes.map((sn) =>
            sn.type === "group_output_bar" ? { ...sn, params: { ...sn.params, portCount: outputHandles.length } } : sn,
          );
        }
        updatedSubflow = {
          ...subflow,
          nodes: subNodes,
          output_map: [...(subflow.output_map ?? []), { groupHandle: newHandle, nodeId: gob.id, nodeHandle: gobHandle }],
        };
      }
      return { ...n, data: { ...n.data, outputHandles, showOutput: true, subflow: updatedSubflow } };
    }));
  }, []);

  const handleRemoveGroupOutput = useCallback((nodeId: string) => {
    setNodes((ns) => {
      const node = ns.find((n) => n.id === nodeId);
      if (!node || !node.data.groupType) return ns;
      const oldHandles = (node.data.outputHandles as string[] | undefined) ?? [];
      if (oldHandles.length === 0) return ns;
      const removedHandle = oldHandles[oldHandles.length - 1];
      const outputHandles = oldHandles.slice(0, -1);
      setEdges((es) => es.filter((e) => !(e.source === nodeId && e.sourceHandle === removedHandle)));
      const subflow = node.data.subflow as import("./types").SubflowData | undefined;
      const removedGobHandle = oldHandles.length === 1 ? "df_in" : `df_in_${oldHandles.length}`;
      const updatedSubflow = subflow ? {
        ...subflow,
        nodes: subflow.nodes.map((sn) =>
          sn.type === "group_output_bar" ? { ...sn, params: { ...sn.params, portCount: outputHandles.length } } : sn
        ),
        edges: subflow.edges.filter((e) => {
          const gobId = subflow.nodes.find((sn) => sn.type === "group_output_bar")?.id;
          return !(gobId && e.target === gobId && (e.targetHandle ?? "df_in") === removedGobHandle);
        }),
        output_map: subflow.output_map?.filter((m) => m.groupHandle !== removedHandle),
        direct_output_map: subflow.direct_output_map?.filter((m) => m.groupHandle !== removedHandle),
      } : subflow;
      return ns.map((n) => n.id === nodeId
        ? { ...n, data: { ...n.data, outputHandles, showOutput: outputHandles.length > 0, subflow: updatedSubflow } }
        : n
      );
    });
  }, []);

  const deleteNodeById = useCallback((nodeId: string) => {
    pushHistory();
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setNodeOutputs((prev) => { const next = { ...prev }; delete next[nodeId]; return next; });
    setSelectedId((sid) => (sid === nodeId ? null : sid));
    setModalNodeId((mid) => (mid === nodeId ? null : mid));
    setWorkflowError((we) => (we?.nodeId === nodeId ? null : we));
  }, [pushHistory]);

  const deleteEdgeById = useCallback((edgeId: string) => {
    pushHistory();
    setEdges((es) => es.filter((e) => e.id !== edgeId));
  }, [pushHistory]);

  const resetNodeById = useCallback((nodeId: string) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: "idle" as const } } : n)),
    );
    setNodeOutputs((prev) => { const next = { ...prev }; delete next[nodeId]; return next; });
    setWorkflowError((we) => (we?.nodeId === nodeId ? null : we));
  }, []);

  const copyNodes = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      const chosen = nodes.filter((n) => idSet.has(n.id));
      if (!chosen.length) return;
      clipboardRef.current = {
        nodes: chosen.map((n) => ({
          id: n.id,
          type: n.type,
          position: { x: n.position.x, y: n.position.y },
          width: n.width,
          height: n.height,
          zIndex: n.zIndex,
          data: structuredClone({ ...n.data, status: "idle" as const }),
        })),
        edges: edges
          .filter((e) => idSet.has(e.source) && idSet.has(e.target))
          .map((e) => ({
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          })),
      };
      pasteCountRef.current = 0;
    },
    [nodes, edges],
  );

  const pasteNodes = useCallback((at?: { x: number; y: number }) => {
    const clip = clipboardRef.current;
    if (!clip?.nodes.length) return;
    pushHistory();
    pasteCountRef.current += 1;
    const minX = Math.min(...clip.nodes.map((n) => n.position.x));
    const minY = Math.min(...clip.nodes.map((n) => n.position.y));
    const offset = at
      ? { x: at.x - minX, y: at.y - minY }
      : { x: 40 * pasteCountRef.current, y: 40 * pasteCountRef.current };
    const idMap = new Map<string, string>();
    // Pasted copies of "Node N" notes get fresh numbers (Node 4 → Node 5 …).
    let seq = nextNodeNumber(nodesRef.current);
    const newNodes: Node<FlowNodeData>[] = clip.nodes.map((cn) => {
      const nid = newNodeId();
      idMap.set(cn.id, nid);
      const data = structuredClone(cn.data);
      if (cn.type !== ANNOTATION_NODE_TYPE && /^Node \d+$/.test(String(data.annotation ?? ""))) {
        data.annotation = `Node ${seq++}`;
      }
      return {
        id: nid,
        type: cn.type ?? "notebook",
        position: { x: cn.position.x + offset.x, y: cn.position.y + offset.y },
        width: cn.width,
        height: cn.height,
        zIndex: cn.zIndex,
        selected: true,
        data,
      };
    });
    const newEdges: Edge[] = clip.edges.map((ce, i) => ({
      id: `edge_${idMap.get(ce.source)}_${idMap.get(ce.target)}_${Date.now()}_${i}`,
      source: idMap.get(ce.source)!,
      target: idMap.get(ce.target)!,
      sourceHandle: ce.sourceHandle ?? "df_out",
      targetHandle: ce.targetHandle ?? "df_in",
    }));
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes]);
    setEdges((es) => [...es, ...newEdges]);
  }, [nextNodeNumber, pushHistory]);

  // Build a payload that always represents the ROOT workflow, even when inside a group.
  // Walks up the groupStack syncing inner changes back into the outer group node's subflow.
  // Optional overrides let callers inject just-edited inner nodes/edges (draft applied)
  // without waiting for the async setNodes to flush.
  const buildRootPayload = useCallback((overrideNodes?: Node<FlowNodeData>[], overrideEdges?: Edge[]) => {
    const innerNodes = overrideNodes ?? nodes;
    const innerEdges = overrideEdges ?? edges;
    const stack = tabs.find((t) => t.id === activeTabId)?.groupStack ?? [];
    if (stack.length === 0) return buildPayload(innerNodes, innerEdges);
    let currentNodes = innerNodes;
    let currentEdges = innerEdges;
    const stackCopy = [...stack];
    while (stackCopy.length > 0) {
      const entry = stackCopy.pop()!;
      const originalGroupNode = entry.parentNodes.find((n) => n.id === entry.groupNodeId);
      const originalSubflow = originalGroupNode?.data.subflow as SubflowData | undefined;
      const payload = buildPayload(currentNodes, currentEdges);
      const updatedSubflow: SubflowData = {
        ...originalSubflow,
        nodes: payload.nodes,
        edges: payload.edges,
      };
      currentNodes = entry.parentNodes.map((n) =>
        n.id === entry.groupNodeId
          ? { ...n, data: { ...n.data, subflow: updatedSubflow } }
          : n,
      );
      currentEdges = entry.parentEdges;
    }
    return buildPayload(currentNodes, currentEdges);
  }, [nodes, edges, tabs, activeTabId]);

  const runNodeById = useCallback(
    async (nodeId: string) => {
      setRunBusy(true);
      setWorkflowError(null);
      setNodes((ns) =>
        ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: "running" as const } } : n)),
      );
      try {
        const stack = tabs.find((t) => t.id === activeTabId)?.groupStack ?? [];
        const res = stack.length > 0
          ? await runNodeInGroup({
              ...buildRootPayload(),
              group_path: stack.map((e) => e.groupNodeId),
              node_id: nodeId,
              use_cache: false,
            })
          : await (async () => {
              const payload = buildPayload(nodes, edges);
              return runSingleNode({ nodes: payload.nodes, edges: payload.edges, node_id: nodeId });
            })();
        setLastRunLogs(res.logs ?? []);
        setNodeOutputs((prev) => ({ ...prev, ...(res.node_outputs ?? {}) }));
        if (res.status === "error") {
          setWorkflowError({ nodeId: res.node_id ?? nodeId, message: res.message ?? "Error" });
          setNodes((ns) =>
            ns.map((n) => ({
              ...n,
              data: {
                ...n.data,
                status:
                  n.id === res.node_id
                    ? ("error" as const)
                    : n.id === nodeId
                      ? ("idle" as const)
                      : n.data.status,
              },
            })),
          );
        } else {
          // Mark the target node and all its upstream ancestors as success.
          const upstreamIds = getUpstreamIds(nodeId, edges);
          const successSet = new Set([nodeId, ...upstreamIds]);
          setNodes((ns) =>
            ns.map((n) =>
              successSet.has(n.id) ? { ...n, data: { ...n.data, status: "success" as const } } : n,
            ),
          );
        }
      } catch (e) {
        setWorkflowError({ nodeId, message: e instanceof Error ? e.message : String(e) });
        setNodes((ns) =>
          ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: "idle" as const } } : n)),
        );
      } finally {
        setRunBusy(false);
      }
    },
    [nodes, edges, tabs, activeTabId, buildRootPayload],
  );

  // Ctrl/Cmd+C copies selected nodes, Ctrl/Cmd+V pastes (skipped while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isEditableTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "c") {
        const ids = nodes.filter((n) => n.selected).map((n) => n.id);
        if (!ids.length && selectedId) ids.push(selectedId);
        if (ids.length) {
          copyNodes(ids);
          e.preventDefault();
        }
      } else if (k === "v") {
        if (clipboardRef.current?.nodes.length) {
          pasteNodes();
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, selectedId, copyNodes, pasteNodes]);

  const handleRunWorkflow = async () => {
    setWorkflowError(null);
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, status: "running" as const } })));
    try {
      const payload = buildRootPayload();
      const res = await runWorkflow(payload);
      setLastRunLogs(res.logs ?? []);
      const outerOutputs = res.node_outputs ?? {};
      // If inside a group, also build barOutputs so Input bar console data is visible
      const stack = tabs.find((t) => t.id === activeTabId)?.groupStack ?? [];
      let barOutputs: NodeOutputsMap = {};
      if (stack.length > 0) {
        const entry = stack[stack.length - 1];
        const groupNode = entry.parentNodes.find((n) => n.id === entry.groupNodeId);
        const inputMap = (groupNode?.data.subflow as SubflowData | undefined)?.input_map ?? [];
        barOutputs = buildBarOutputs(inputMap, entry.parentEdges, entry.groupNodeId, outerOutputs);
      }
      if (res.status === "error") {
        setWorkflowError({ nodeId: res.node_id ?? null, message: res.message ?? "Error" });
        setNodeOutputs({ ...outerOutputs, ...barOutputs });
        setNodes((ns) =>
          ns.map((n) => ({
            ...n,
            data: {
              ...n.data,
              status: n.id === res.node_id ? "error" : outerOutputs[n.id] ? "success" : "idle",
            },
          })),
        );
        return;
      }
      setNodeOutputs({ ...outerOutputs, ...barOutputs });
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, status: "success" as const } })));
    } catch (e) {
      setWorkflowError({ nodeId: null, message: e instanceof Error ? e.message : String(e) });
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, status: "idle" as const } })));
    }
  };

  const handleClearCanvas = () => {
    setNodes([]); setEdges([]); setSelectedId(null);
    setModalNodeId(null); setNodeOutputs({}); setLastRunLogs([]); setWorkflowError(null);
  };

  const buildSavedWorkflow = useCallback((): SavedWorkflow => {
    const flowNodes = nodes.filter((n) => !isAnnotation(n));
    const annoNodes = nodes.filter(isAnnotation);
    return {
      nodes: flowNodes.map((n) => ({
        id: n.id, type: n.data.type, label: n.data.label, category: n.data.category,
        position: { x: n.position.x, y: n.position.y }, params: n.data.params, code: n.data.code,
        input_count: n.data.inputCount, annotation: n.data.annotation ?? "",
        ...(n.data.groupType ? { group_type: n.data.groupType } : {}),
        ...(n.data.subflow ? { subflow: n.data.subflow as SubflowData } : {}),
      })),
      edges: buildPayload(nodes, edges).edges,
      annotations: annoNodes.map((n) => ({
        id: n.id,
        position: { x: n.position.x, y: n.position.y },
        width: n.width ?? n.measured?.width ?? 220,
        height: n.height ?? n.measured?.height ?? 110,
        text: String(n.data.text ?? ""),
        fill: String(n.data.fill ?? DEFAULT_ANNOTATION_DATA.fill),
        fontSize: Number(n.data.fontSize ?? DEFAULT_ANNOTATION_DATA.fontSize),
        fontColor: String(n.data.fontColor ?? DEFAULT_ANNOTATION_DATA.fontColor),
        borderColor: String(n.data.borderColor ?? DEFAULT_ANNOTATION_DATA.borderColor),
      })),
    };
  }, [nodes, edges]);

  const downloadWorkflow = useCallback(() => {
    const blob = new Blob([JSON.stringify(buildSavedWorkflow(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "geoflow-workflow.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [buildSavedWorkflow]);

  // Workflow → equivalent .ipynb (backend converts: topo order, deduped
  // imports, df_in/df_out variable bridging between cells).
  const notebookContent = useCallback(async (): Promise<string> => {
    const payload = buildPayload(nodes, edges);
    if (!payload.nodes.length) throw new Error("Canvas is empty — nothing to export.");
    const nb = await exportIpynb(payload);
    return JSON.stringify(nb, null, 1);
  }, [nodes, edges]);

  const downloadNotebook = useCallback(async () => {
    try {
      const content = await notebookContent();
      const blob = new Blob([content], { type: "application/x-ipynb+json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "geoflow-workflow.ipynb";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }, [notebookContent]);

  // ── Smart Save / Save As ────────────────────────────────────────────────
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId]);

  const handleSave = useCallback(async () => {
    const fp = activeTab?.filePath;
    if (fp) {
      try {
        const lastSlash = fp.lastIndexOf("/");
        const parent = lastSlash >= 0 ? fp.substring(0, lastSlash) : null;
        const name = lastSlash >= 0 ? fp.substring(lastSlash + 1) : fp;
        await workspaceSaveFile(parent, name, JSON.stringify(buildSavedWorkflow(), null, 2));
      } catch (err) {
        alert("Save failed: " + String(err));
      }
    } else {
      setSaveModalOpen(true);
    }
  }, [activeTab, buildSavedWorkflow]);

  const handleSaveAs = useCallback(() => {
    setSaveModalOpen(true);
  }, []);

  // ── Keyboard shortcuts: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, Ctrl+S save ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); handleRedo(); }
      if (e.key === "s") { e.preventDefault(); void handleSave(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo, handleSave]);

  // ── Group / Component creation ────────────────────────────────────────────

  const createGroupFromSelection = useCallback((groupType: "group" | "component") => {
    const selNodes = nodes.filter((n) => n.selected && !isAnnotation(n));
    if (selNodes.length < 2) { alert("Select at least 2 nodes to create a group."); return; }
    pushHistory();
    const selIds = new Set(selNodes.map((n) => n.id));
    const incomingEdges = edges.filter((e) => !selIds.has(e.source) && selIds.has(e.target));
    const outgoingEdges = edges.filter((e) => selIds.has(e.source) && !selIds.has(e.target));
    const internalEdges = edges.filter((e) => selIds.has(e.source) && selIds.has(e.target));
    const incomingDf = incomingEdges.filter((e) => !isImgHandle(e.targetHandle));
    const outgoingDf = outgoingEdges.filter((e) => !isImgHandle(e.sourceHandle));

    // Deduplicate incoming by (source, sourceHandle) — unique external sources only
    const seenInKeys = new Set<string>();
    const uniqueIn: Edge[] = [];
    const inKeyToIdx = new Map<string, number>();
    for (const e of incomingDf) {
      const k = `${e.source}:${e.sourceHandle ?? "df_out"}`;
      if (!seenInKeys.has(k)) {
        inKeyToIdx.set(k, uniqueIn.length);
        seenInKeys.add(k);
        uniqueIn.push(e);
      }
    }

    // Deduplicate outgoing by (source, sourceHandle) — only first outgoing edge per source port
    const seenOutKeys = new Set<string>();
    const uniqueOut: Edge[] = [];
    for (const e of outgoingDf) {
      const k = `${e.source}:${e.sourceHandle ?? "df_out"}`;
      if (!seenOutKeys.has(k)) { seenOutKeys.add(k); uniqueOut.push(e); }
    }

    const inputHandles: string[] = uniqueIn.map((_, i) => (i === 0 ? "df_in" : `df_in_${i + 1}`));
    const outputHandles: string[] = uniqueOut.map((_, i) => i === 0 ? "df_out" : `df_out_${i + 1}`);

    // Bar nodes: KNIME-style vertical input/output bars inside the subflow
    const ts = Date.now();
    const gibId = `gib_${ts}`;
    const gobId = `gob_${ts}_2`;
    const gibOutHandles = uniqueIn.map((_, i) => (i === 0 ? "df_out" : `df_out_${i + 1}`));
    const gobInHandles = uniqueOut.map((_, i) => (i === 0 ? "df_in" : `df_in_${i + 1}`));

    // Positions: place bars around the bbox of selected nodes
    const minX = Math.min(...selNodes.map((n) => n.position.x));
    const maxX = Math.max(...selNodes.map((n) => n.position.x));
    const avgY = selNodes.reduce((s, n) => s + n.position.y, 0) / selNodes.length;

    // Centroid used as group node position AND subflow origin (positions stored relative to it)
    const cx = selNodes.reduce((s, n) => s + n.position.x, 0) / selNodes.length;
    const cy = selNodes.reduce((s, n) => s + n.position.y, 0) / selNodes.length;

    const gibNode: WorkflowNodePayload = {
      id: gibId, type: "group_input_bar", label: "Input", category: "Group",
      position: { x: minX - 80 - cx, y: avgY - cy },
      params: { portCount: uniqueIn.length }, code: "",
    };
    const gobNode: WorkflowNodePayload = {
      id: gobId, type: "group_output_bar", label: "Output", category: "Group",
      position: { x: maxX + 160 - cx, y: avgY - cy },
      params: { portCount: uniqueOut.length }, code: "",
    };

    const subflowNodes: WorkflowNodePayload[] = [
      ...selNodes.map((n) => ({
        id: n.id, type: n.data.type, label: n.data.label, category: n.data.category,
        position: { x: n.position.x - cx, y: n.position.y - cy },
        params: n.data.params, code: n.data.code,
        input_count: n.data.inputCount, annotation: n.data.annotation ?? "",
        // Preserve nested group/component so it stays enterable inside the new group.
        ...(n.data.groupType ? { group_type: n.data.groupType } : {}),
        ...(n.data.subflow ? { subflow: n.data.subflow as SubflowData } : {}),
      })),
      ...(incomingDf.length > 0 ? [gibNode] : []),
      ...(uniqueOut.length > 0 ? [gobNode] : []),
    ];

    const subflowEdges: WorkflowEdgePayload[] = [
      ...internalEdges.map((e) => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
      })),
      // gib → original target nodes (multiple inner targets share the same gib output handle)
      ...incomingDf.map((e, i) => {
        const idx = inKeyToIdx.get(`${e.source}:${e.sourceHandle ?? "df_out"}`) ?? 0;
        return {
          id: `e_gib_${i}_${ts}`,
          source: gibId, sourceHandle: gibOutHandles[idx],
          target: e.target, targetHandle: e.targetHandle,
        };
      }),
      // original source nodes → gob
      ...uniqueOut.map((e, i) => ({
        id: `e_gob_${i}_${ts}`,
        source: e.source, sourceHandle: e.sourceHandle ?? "df_out",
        target: gobId, targetHandle: gobInHandles[i],
      })),
    ];

    // input_map: groupHandle → input bar's output handle (for backend execution)
    const input_map = uniqueIn.map((_, i) => ({
      groupHandle: inputHandles[i],
      nodeId: gibId,
      nodeHandle: gibOutHandles[i],
    }));
    // output_map: groupHandle → output bar's input handle (for backend execution)
    const output_map = uniqueOut.map((_, i) => ({
      groupHandle: outputHandles[i] ?? "df_out",
      nodeId: gobId,
      nodeHandle: gobInHandles[i],
    }));
    // direct maps: skip the bars, for Expand to restore original connections
    // Each incomingDf edge maps groupHandle by unique-source index (multiple inner targets per source allowed)
    const direct_input_map = incomingDf.map((e) => {
      const idx = inKeyToIdx.get(`${e.source}:${e.sourceHandle ?? "df_out"}`) ?? 0;
      return {
        groupHandle: inputHandles[idx],
        nodeId: e.target,
        nodeHandle: e.targetHandle ?? "df_in",
      };
    });
    const direct_output_map = uniqueOut.map((e, i) => ({
      groupHandle: outputHandles[i] ?? "df_out",
      nodeId: e.source,
      nodeHandle: e.sourceHandle ?? "df_out",
    }));

    const groupNode: Node<FlowNodeData> = {
      id: newNodeId(),
      type: "flowGroup",
      position: { x: cx, y: cy },
      data: {
        label: groupType === "component" ? "Component" : "Group",
        type: groupType,
        category: "Group",
        params: {},
        code: "",
        status: "idle",
        color: "#7b1fa2",
        annotation: `${groupType === "component" ? "Component" : "Group"} ${nodes.filter((n) => n.type === "flowGroup").length + 1}`,
        groupType,
        subflow: { nodes: subflowNodes, edges: subflowEdges, input_map, output_map, direct_input_map, direct_output_map },
        showInput: inputHandles.length > 0,
        showOutput: outputHandles.length > 0,
        outputHandle: "df_out",
        inputHandles: inputHandles.length > 0 ? inputHandles : undefined,
        outputHandles: outputHandles.length > 0 ? outputHandles : undefined,
        inputCount: inputHandles.length,
      },
    };

    const removedEdgeIds = new Set([
      ...incomingEdges.map((e) => e.id),
      ...outgoingEdges.map((e) => e.id),
      ...internalEdges.map((e) => e.id),
    ]);
    const remainingNodes = nodes.filter((n) => !selIds.has(n.id));
    const remainingEdges = edges.filter((e) => !removedEdgeIds.has(e.id));

    const newIncomingEdges: Edge[] = uniqueIn.map((e, i) => ({
      id: `e_grp_in_${i}_${Date.now()}`,
      source: e.source,
      target: groupNode.id,
      sourceHandle: e.sourceHandle ?? "df_out",
      targetHandle: inputHandles[i],
      style: { stroke: "#222", strokeWidth: 1.5 },
    }));

    const outKeyToPortOut = new Map<string, string>();
    uniqueOut.forEach((e, i) => {
      outKeyToPortOut.set(`${e.source}:${e.sourceHandle ?? "df_out"}`, outputHandles[i] ?? "df_out");
    });
    const newOutgoingEdges: Edge[] = outgoingDf.map((e, i) => ({
      id: `e_grp_out_${i}_${Date.now()}`,
      source: groupNode.id,
      target: e.target,
      sourceHandle: outKeyToPortOut.get(`${e.source}:${e.sourceHandle ?? "df_out"}`) ?? "df_out",
      targetHandle: e.targetHandle ?? "df_in",
      style: { stroke: "#222", strokeWidth: 1.5 },
    }));

    setNodes([...remainingNodes, groupNode]);
    setEdges([...remainingEdges, ...newIncomingEdges, ...newOutgoingEdges]);
    setSelectedId(groupNode.id);
  }, [nodes, edges, pushHistory]);

  // ── Group navigation ──────────────────────────────────────────────────────

  const enterGroup = useCallback((groupNodeId: string) => {
    const groupNode = nodesRef.current.find((n) => n.id === groupNodeId);
    if (!groupNode?.data.subflow) return;
    const subflow = groupNode.data.subflow as SubflowData;
    // Remember the parent level's viewport so we can restore it on exit.
    const parentViewport = groupBridge.getViewport();

    // Convert subflow payload → live Node<FlowNodeData>[]
    // Derive status from existing outputs so a node that was already run shows green.
    const outs = nodeOutputsRef.current;
    const statusFor = (id: string): FlowNodeData["status"] => (outs[id] ? "success" : "idle");
    const BAR_TYPES = new Set(["group_input_bar", "group_output_bar"]);
    const subflowNodes: Node<FlowNodeData>[] = subflow.nodes.map((sn) => {
      if (BAR_TYPES.has(sn.type)) {
        const isInput = sn.type === "group_input_bar";
        const portCount = (sn.params?.portCount as number) ?? 1;
        const outHandles = isInput ? Array.from({ length: portCount }, (_, i) => i === 0 ? "df_out" : `df_out_${i + 1}`) : undefined;
        const inHandles = !isInput ? Array.from({ length: portCount }, (_, i) => i === 0 ? "df_in" : `df_in_${i + 1}`) : undefined;
        return {
          id: sn.id, type: sn.type,
          position: sn.position ?? { x: 60, y: 100 },
          data: {
            label: isInput ? "Input" : "Output", type: sn.type, category: "Group",
            params: sn.params ?? {}, code: "", status: statusFor(sn.id), color: "#7b1fa2",
            annotation: "", showInput: !isInput, showOutput: isInput,
            outputHandle: "df_out" as const, inputCount: isInput ? 0 : portCount,
            inputHandles: inHandles, outputHandles: outHandles,
          },
        };
      }
      // Nested group/component → reconstruct as a flowGroup so it stays interactive
      // (renders correctly, can be entered) instead of a gray notebook node.
      if (sn.group_type || sn.type === "group" || sn.type === "component") {
        return buildGroupNode(sn, sn.annotation ?? "", sn.position ?? { x: 100, y: 140 }, statusFor(sn.id));
      }
      const spec = specs.find((s) => s.id === sn.type);
      const extras = spec
        ? flowExtras(spec)
        : { showInput: true, outputHandle: "df_out" as const, showOutput: true, inputCount: 1, dynamicInputs: false };
      if (sn.input_count && sn.input_count > (extras.inputCount ?? 1)) extras.inputCount = sn.input_count;
      return {
        id: sn.id, type: "notebook",
        position: sn.position ?? { x: 100, y: 140 },
        data: {
          label: sn.label, type: sn.type, category: sn.category ?? spec?.category ?? "Unknown",
          params: sn.params ?? {}, code: sn.code ?? spec?.default_code ?? "",
          status: statusFor(sn.id), color: spec?.color ?? "#bdbdbd",
          annotation: sn.annotation ?? "", ...extras,
        },
      };
    });

    const subflowEdges: Edge[] = subflow.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle ?? "df_out",
      targetHandle: e.targetHandle ?? "df_in",
      style: { stroke: "#222", strokeWidth: 1.5 },
    }));

    setTabs((prev) => prev.map((t) => {
      if (t.id !== activeTabId) return t;
      return {
        ...t,
        groupStack: [
          ...(t.groupStack ?? []),
          {
            groupNodeId,
            groupLabel: String(groupNode.data.label),
            groupType: (groupNode.data.groupType as "group" | "component") ?? "group",
            parentNodes: nodesRef.current,
            parentEdges: edgesRef.current,
            parentViewport,
          },
        ],
      };
    }));

    setNodes(subflowNodes);
    setEdges(subflowEdges);
    setSelectedId(null);
    // Keep nodeOutputs — node IDs are globally unique, so outer + inner outputs
    // coexist. Clearing here was wiping the workflow's run results on navigation.
    setWorkflowError(null);

    // Restore this group's last-known viewport, or fit-to-view on first entry.
    const savedVp = subflowViewportsRef.current[groupNodeId];
    requestAnimationFrame(() => {
      if (savedVp) groupBridge.setViewport(savedVp);
      else groupBridge.fitView();
    });
  }, [activeTabId, specs]);

  const exitGroup = useCallback((targetDepth: number = 0) => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === activeTabId);
      if (!tab?.groupStack?.length) return prev;
      const stack = [...tab.groupStack];
      let currentNodes = nodesRef.current;
      let currentEdges = edgesRef.current;

      // Save the current (innermost) subflow viewport so re-entering restores it.
      const innermostGroupId = stack[stack.length - 1]?.groupNodeId;
      if (innermostGroupId) subflowViewportsRef.current[innermostGroupId] = groupBridge.getViewport();

      // Walk up the stack, saving subflow changes back into group node data.
      // The last entry popped (at index targetDepth) carries the viewport of the
      // level we land on.
      let landedEntry: GroupStackEntry | null = null;
      while (stack.length > targetDepth) {
        const entry = stack.pop()!;
        landedEntry = entry;
        const originalGroupNode = entry.parentNodes.find((n) => n.id === entry.groupNodeId);
        const originalSubflow = originalGroupNode?.data.subflow as SubflowData | undefined;
        const payload = buildPayload(currentNodes, currentEdges);
        const updatedSubflow: SubflowData = {
          ...originalSubflow,            // preserve input_map, output_map, direct maps
          nodes: payload.nodes,
          edges: payload.edges,
        };
        currentNodes = entry.parentNodes.map((n) =>
          n.id === entry.groupNodeId
            ? { ...n, data: { ...n.data, subflow: updatedSubflow } }
            : n,
        );
        currentEdges = entry.parentEdges;
      }

      // Refresh statuses from existing outputs so already-run nodes stay green.
      const outs = nodeOutputsRef.current;
      const restored = structuredClone(currentNodes).map((n) => ({
        ...n,
        data: {
          ...n.data,
          status: outs[n.id] ? ("success" as const) : n.data.status,
        },
      }));
      setNodes(restored);
      setEdges(structuredClone(currentEdges));
      setSelectedId(null);
      // Keep nodeOutputs — IDs are globally unique; clearing reset the workflow.
      setWorkflowError(null);

      // Restore the parent level's viewport exactly as it was before entering.
      const restoreVp = landedEntry?.parentViewport;
      requestAnimationFrame(() => {
        if (restoreVp) groupBridge.setViewport(restoreVp);
        else groupBridge.fitView();
      });

      return prev.map((t) => (t.id === activeTabId ? { ...t, groupStack: stack } : t));
    });
  }, [activeTabId]);

  const expandGroup = useCallback((groupNodeId: string) => {
    pushHistory();
    const groupNode = nodesRef.current.find((n) => n.id === groupNodeId);
    if (!groupNode?.data.subflow) return;
    const subflow = groupNode.data.subflow as SubflowData;
    const BAR_TYPES = new Set(["group_input_bar", "group_output_bar"]);

    // Restore inner nodes (skip bar nodes)
    const innerNodePayloads = subflow.nodes.filter((sn) => !BAR_TYPES.has(sn.type));
    const offset = groupNode.position;
    const restoredNodes: Node<FlowNodeData>[] = innerNodePayloads.map((sn) => {
      const pos = { x: (sn.position?.x ?? 0) + offset.x, y: (sn.position?.y ?? 0) + offset.y };
      // Nested group/component stays a flowGroup when expanded onto the parent canvas.
      if (sn.group_type || sn.type === "group" || sn.type === "component") {
        return buildGroupNode(sn, sn.annotation ?? "", pos);
      }
      const spec = specs.find((s) => s.id === sn.type);
      const extras = spec
        ? flowExtras(spec)
        : { showInput: true, outputHandle: "df_out" as const, showOutput: true, inputCount: 1, dynamicInputs: false };
      if (sn.input_count && sn.input_count > (extras.inputCount ?? 1)) extras.inputCount = sn.input_count;
      return {
        id: sn.id, type: "notebook",
        position: pos,
        data: {
          label: sn.label, type: sn.type, category: sn.category ?? spec?.category ?? "Unknown",
          params: sn.params ?? {}, code: sn.code ?? spec?.default_code ?? "",
          status: "idle" as const, color: spec?.color ?? "#bdbdbd",
          annotation: sn.annotation ?? "", ...extras,
        },
      };
    });

    // Restore internal edges (skip bar edges)
    const barIds = new Set(subflow.nodes.filter((sn) => BAR_TYPES.has(sn.type)).map((sn) => sn.id));
    const restoredEdges: Edge[] = subflow.edges
      .filter((e) => !barIds.has(e.source) && !barIds.has(e.target))
      .map((e) => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle ?? "df_out",
        targetHandle: e.targetHandle ?? "df_in",
        style: { stroke: "#222", strokeWidth: 1.5 },
      }));

    // Re-route external edges using direct maps
    const externalEdges = edgesRef.current.filter(
      (e) => e.source === groupNodeId || e.target === groupNodeId,
    );
    const newExternalEdges: Edge[] = externalEdges.flatMap((e) => {
      if (e.target === groupNodeId) {
        // One external input edge may fan out to multiple inner targets (same groupHandle, multiple entries)
        const matches = subflow.direct_input_map?.filter((x) => x.groupHandle === e.targetHandle) ?? [];
        if (matches.length === 0 && subflow.direct_input_map?.[0]) matches.push(subflow.direct_input_map[0]);
        return matches.map((m, mi) => ({
          ...e, id: `exp_in_${e.id}_${mi}`, target: m.nodeId, targetHandle: m.nodeHandle ?? "df_in",
        }));
      } else {
        const m = subflow.direct_output_map?.find((x) => x.groupHandle === e.sourceHandle)
                   ?? subflow.direct_output_map?.[0];
        if (!m) return [];
        return [{ ...e, id: `exp_out_${e.id}`, source: m.nodeId, sourceHandle: m.nodeHandle ?? "df_out", targetHandle: e.targetHandle ?? "df_in" }];
      }
    });

    setNodes((ns) => [...ns.filter((n) => n.id !== groupNodeId), ...restoredNodes]);
    setEdges((es) => [
      ...es.filter((e) => e.source !== groupNodeId && e.target !== groupNodeId),
      ...restoredEdges,
      ...newExternalEdges,
    ]);
    if (selectedId === groupNodeId) setSelectedId(null);
  }, [specs, selectedId, pushHistory]);

  // Wire bridge so GroupNode can call enterGroup
  groupBridge.enterGroup = enterGroup;

  // ─────────────────────────────────────────────────────────────────────────

  const annotationBoxToNode = useCallback((a: AnnotationBoxPayload): Node<FlowNodeData> => ({
    id: a.id || newNodeId(),
    type: ANNOTATION_NODE_TYPE,
    position: a.position,
    width: a.width,
    height: a.height,
    zIndex: -1,
    data: {
      text: a.text, fill: a.fill, fontSize: a.fontSize,
      fontColor: a.fontColor, borderColor: a.borderColor,
      label: "", type: ANNOTATION_NODE_TYPE, category: "", params: {}, code: "",
      status: "idle", color: "", showInput: false, outputHandle: "df_out", showOutput: false,
    },
  }), []);

  const restoreWorkflow = useCallback(
    (wf: SavedWorkflow) => {
      const nextNodes: Node<FlowNodeData>[] = wf.nodes.map((sn, i) => {
        const annotation = sn.annotation ?? `Node ${i + 1}`;
        // Group/Component nodes use the "flowGroup" react-flow type
        if (sn.group_type || sn.type === "group" || sn.type === "component") {
          return buildGroupNode(sn, annotation, sn.position ?? { x: 100, y: 140 });
        }
        const spec = specs.find((s) => s.id === sn.type);
        if (!spec) {
          return {
            id: sn.id, type: "notebook", position: sn.position,
            data: {
              label: sn.label, type: sn.type, category: sn.category ?? "Unknown",
              params: sn.params ?? {}, code: sn.code ?? "", status: "idle" as const,
              color: "#bdbdbd", showInput: true, outputHandle: "df_out" as const, showOutput: true,
              annotation,
            },
          };
        }
        const extras = flowExtras(spec);
        if (sn.input_count && sn.input_count > (extras.inputCount ?? 1)) {
          extras.inputCount = sn.input_count;
        }
        return {
          id: sn.id, type: "notebook", position: sn.position,
          data: {
            label: sn.label, type: sn.type, category: sn.category ?? spec.category,
            params: sn.params ?? {}, code: sn.code ?? "", status: "idle" as const,
            color: spec.color, annotation, ...extras,
          },
        };
      });
      const annoNodes = (wf.annotations ?? []).map(annotationBoxToNode);
      const nextEdges: Edge[] = wf.edges.map((e) => {
        const sh = e.sourceHandle ?? "df_out";
        return {
          id: e.id, source: e.source, target: e.target,
          sourceHandle: sh, targetHandle: e.targetHandle ?? "df_in",
          style: sh === "img_out" ? { stroke: "#f57c00", strokeWidth: 2 } : { stroke: "#222", strokeWidth: 1.5 },
        };
      });
      setNodes([...annoNodes, ...nextNodes]); setEdges(nextEdges);
      setSelectedId(null); setModalNodeId(null); setNodeOutputs({}); setWorkflowError(null);
    },
    [specs, annotationBoxToNode],
  );

  const applyWorkflowPayload = useCallback(
    (wf: { nodes: WorkflowNodePayload[]; edges: WorkflowEdgePayload[] }) => {
      const nextNodes: Node<FlowNodeData>[] = wf.nodes.map((sn, i) => {
        const spec = specs.find((s) => s.id === sn.type);
        const extras = spec
          ? flowExtras(spec)
          : {
              showInput: true, outputHandle: "df_out" as const, showOutput: true,
              inputCount: 1, dynamicInputs: false,
            };
        if (sn.input_count && sn.input_count > (extras.inputCount ?? 1)) {
          extras.inputCount = sn.input_count;
        }
        return {
          id: sn.id || `node_${i + 1}`, type: "notebook",
          position: sn.position ?? { x: 100 + i * 180, y: 140 },
          data: {
            label: sn.label, type: sn.type, category: sn.category ?? spec?.category ?? "Unknown",
            params: sn.params ?? {}, code: sn.code ?? spec?.default_code ?? "",
            status: "idle" as const, color: spec?.color ?? "#8e24aa",
            annotation: sn.annotation ?? `Node ${i + 1}`, ...extras,
          },
        };
      });
      const nextEdges: Edge[] = wf.edges.map((e, i) => {
        const sh = e.sourceHandle ?? "df_out";
        return {
          id: e.id || `edge_${i + 1}`, source: e.source, target: e.target,
          sourceHandle: sh, targetHandle: e.targetHandle ?? "df_in",
          style: sh === "img_out" ? { stroke: "#f57c00", strokeWidth: 2 } : { stroke: "#222", strokeWidth: 1.5 },
        };
      });
      setNodes(nextNodes); setEdges(nextEdges);
      setSelectedId(null); setModalNodeId(null); setNodeOutputs({}); setWorkflowError(null);
    },
    [specs],
  );

  const handleOpenWorkspaceFile = useCallback(
    async (path: string) => {
      if (!path.toLowerCase().endsWith(".json")) return;
      const tabName = (path.split(/[/\\]/).pop() ?? "workflow").replace(/\.json$/i, "");
      try {
        const res = await workspaceRead(path);
        const wf = JSON.parse(res.content) as SavedWorkflow;
        if (!Array.isArray(wf.nodes) || !Array.isArray(wf.edges)) {
          throw new Error("Not a GeoFlow workflow JSON (missing nodes/edges).");
        }
        openWorkflowInNewTab(wf, tabName, path);
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
      }
    },
    [openWorkflowInNewTab],
  );

  const onPickLoadFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wf = JSON.parse(String(reader.result)) as SavedWorkflow;
        restoreWorkflow(wf);
        renameActiveTab(file.name.replace(/\.json$/i, ""));
      } catch (e) { alert(e instanceof Error ? e.message : "Invalid workflow JSON"); }
    };
    reader.readAsText(file);
    ev.target.value = "";
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const modalNode = modalNodeId ? nodes.find((n) => n.id === modalNodeId) ?? null : null;
  const modalSpec = modalNode ? specById[modalNode.data.type] : undefined;

  // Bar nodes (gib/gob) don't run on their own — derive their console display from
  // the surrounding context: the input bar mirrors the outer source data feeding the
  // group, the output bar mirrors the inner node outputs feeding it. Keyed by node id.
  const barOutputs = useMemo<NodeOutputsMap>(() => {
    const stack = tabs.find((t) => t.id === activeTabId)?.groupStack ?? [];
    if (stack.length === 0) return {};
    const entry = stack[stack.length - 1];
    const groupNode = entry.parentNodes.find((n) => n.id === entry.groupNodeId);
    const subflow = groupNode?.data.subflow as SubflowData | undefined;
    if (!subflow) return {};
    const result: NodeOutputsMap = {};

    // Input bar: outer source data → component input ports.
    Object.assign(result, buildBarOutputs(subflow.input_map ?? [], entry.parentEdges, entry.groupNodeId, nodeOutputs));

    // Output bar: inner node outputs → component output ports.
    const gobId = subflow.nodes.find((sn) => sn.type === "group_output_bar")?.id;
    if (gobId) {
      const rows: Array<{ idx: number; handle: string; df: DataFrameOutputSummary }> = [];
      for (const e of edges) {
        if (e.target !== gobId) continue;
        const src = nodeOutputs[e.source];
        const df = src?.df_out ?? (e.sourceHandle ? src?.extra_dfs?.[e.sourceHandle] : undefined);
        if (!df) continue;
        const handle = e.targetHandle ?? "df_in";
        const idx = handle === "df_in" ? 0 : Number(handle.split("_").pop()) - 1;
        rows.push({ idx, handle, df });
      }
      rows.sort((a, b) => a.idx - b.idx);
      if (rows.length === 1) {
        result[gobId] = { df_out: rows[0].df };
      } else if (rows.length > 1) {
        const hMap: Record<string, DataFrameOutputSummary> = {};
        for (const r of rows) hMap[r.handle] = r.df;
        result[gobId] = { extra_dfs: hMap };
      }
    }
    return result;
  }, [tabs, activeTabId, edges, nodeOutputs]);

  const bottomOutput = selectedId ? (barOutputs[selectedId] ?? nodeOutputs[selectedId]) : undefined;
  const bottomPortPrefix = selectedNode?.data.type === "group_input_bar" ? "Input" : "Output";
  const bottomError =
    workflowError?.nodeId && workflowError.nodeId === selectedId ? workflowError.message : null;

  const workflowPayloadFn = useCallback(() => buildRootPayload(), [buildRootPayload]);

  const handleSelectNode = useCallback((nodeId: string) => {
    startTransition(() => { setSelectedId(nodeId); });
  }, []);

  const handleApplyDraft = useCallback(() => {
    if (!selectedId || draftParams === null) return;
    let removedInputHandles: Set<string> = new Set();
    let removedOutputHandles: Set<string> = new Set();
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== selectedId) return n;
        const params = structuredClone(draftParams) as Record<string, unknown>;
        if (n.data.groupType) {
          const newName = params._name as string | undefined;
          const newInputCount = typeof params._inputCount === "number" ? params._inputCount : undefined;
          const newOutputCount = typeof params._outputCount === "number" ? params._outputCount : undefined;
          delete params._name; delete params._inputCount; delete params._outputCount;

          const oldInputHandles = (n.data.inputHandles as string[] | undefined) ?? [];
          const oldOutputHandles = (n.data.outputHandles as string[] | undefined) ?? [];

          const inputHandles = newInputCount !== undefined
            ? Array.from({ length: newInputCount }, (_, k) => k === 0 ? "df_in" : `df_in_${k + 1}`)
            : oldInputHandles;
          const outputHandles = newOutputCount !== undefined
            ? Array.from({ length: newOutputCount }, (_, k) => k === 0 ? "df_out" : `df_out_${k + 1}`)
            : oldOutputHandles;

          // Track which handles are being removed so we can clean outer edges
          const inputHandleSet = new Set(inputHandles);
          const outputHandleSet = new Set(outputHandles);
          oldInputHandles.forEach((h) => { if (!inputHandleSet.has(h)) removedInputHandles.add(h); });
          oldOutputHandles.forEach((h) => { if (!outputHandleSet.has(h)) removedOutputHandles.add(h); });

          // Update subflow bar nodes and their port counts + edges
          let updatedSubflow = n.data.subflow as import("./types").SubflowData | undefined;
          if (updatedSubflow) {
            const BAR_IN = "group_input_bar";
            const BAR_OUT = "group_output_bar";
            const validGibHandles = new Set(inputHandles.map((_, i) => i === 0 ? "df_out" : `df_out_${i + 1}`));
            const validGobHandles = new Set(outputHandles.map((_, i) => i === 0 ? "df_in" : `df_in_${i + 1}`));
            const gibId = updatedSubflow.nodes.find((sn) => sn.type === BAR_IN)?.id;
            const gobId = updatedSubflow.nodes.find((sn) => sn.type === BAR_OUT)?.id;
            updatedSubflow = {
              ...updatedSubflow,
              nodes: updatedSubflow.nodes.map((sn) => {
                if (sn.type === BAR_IN) return { ...sn, params: { ...sn.params, portCount: inputHandles.length } };
                if (sn.type === BAR_OUT) return { ...sn, params: { ...sn.params, portCount: outputHandles.length } };
                return sn;
              }),
              edges: updatedSubflow.edges.filter((e) => {
                if (gibId && e.source === gibId && !validGibHandles.has(e.sourceHandle ?? "df_out")) return false;
                if (gobId && e.target === gobId && !validGobHandles.has(e.targetHandle ?? "df_in")) return false;
                return true;
              }),
              input_map: updatedSubflow.input_map?.filter((m) => inputHandleSet.has(m.groupHandle)),
              output_map: updatedSubflow.output_map?.filter((m) => outputHandleSet.has(m.groupHandle)),
              direct_input_map: updatedSubflow.direct_input_map?.filter((m) => inputHandleSet.has(m.groupHandle)),
              direct_output_map: updatedSubflow.direct_output_map?.filter((m) => outputHandleSet.has(m.groupHandle)),
            };
          }

          return {
            ...n,
            data: {
              ...n.data,
              ...(newName !== undefined ? { annotation: newName } : {}),
              inputHandles, inputCount: inputHandles.length, showInput: inputHandles.length > 0,
              outputHandles, showOutput: outputHandles.length > 0,
              ...(updatedSubflow ? { subflow: updatedSubflow } : {}),
              params,
            },
          };
        }
        return { ...n, data: { ...n.data, params, code: draftCode } };
      }),
    );
    // Remove outer edges that referenced the now-deleted handles
    if (removedInputHandles.size > 0 || removedOutputHandles.size > 0) {
      setEdges((es) => es.filter((e) => {
        if (e.target === selectedId && removedInputHandles.has(e.targetHandle ?? "df_in")) return false;
        if (e.source === selectedId && removedOutputHandles.has(e.sourceHandle ?? "df_out")) return false;
        return true;
      }));
    }
  }, [selectedId, draftParams, draftCode]);

  const handleRunSelectedNode = useCallback(async () => {
    if (!selectedId || draftParams === null) return;
    // Apply draft changes to current inner nodes first
    const merged = nodes.map((n) =>
      n.id === selectedId
        ? { ...n, data: { ...n.data, params: structuredClone(draftParams), code: draftCode } }
        : n,
    );
    setNodes(merged);
    setRunBusy(true);
    setWorkflowError(null);
    try {
      const stack = tabs.find((t) => t.id === activeTabId)?.groupStack ?? [];
      if (stack.length > 0) {
        // Inside a group: send the full root workflow (with draft applied to the inner
        // node) plus the group path. The backend recomputes the group's input from the
        // outer graph and runs only this inner node's subgraph — no prior full run needed.
        const rootPayload = buildRootPayload(merged, edges);
        const groupPath = stack.map((e) => e.groupNodeId);
        const res = await runNodeInGroup({
          nodes: rootPayload.nodes,
          edges: rootPayload.edges,
          group_path: groupPath,
          node_id: selectedId,
          use_cache: false,
        });
        setLastRunLogs(res.logs ?? []);
        const outputs = res.node_outputs ?? {};
        if (res.status === "error") {
          setWorkflowError({ nodeId: res.node_id ?? selectedId, message: res.message ?? "Error" });
          setNodeOutputs((prev) => ({ ...prev, ...outputs }));
          setNodes((ns) => ns.map((n) => ({
            ...n,
            data: { ...n.data, status: n.id === (res.node_id ?? selectedId) ? "error" as const : n.data.status },
          })));
        } else {
          setWorkflowError(null);
          setNodeOutputs((prev) => ({ ...prev, ...outputs }));
          setNodes((ns) => ns.map((n) =>
            n.id === selectedId ? { ...n, data: { ...n.data, status: "success" as const } } : n
          ));
        }
        return;
      }

      // At root level: run single node with draft applied
      const rootPayload = buildRootPayload();
      const payload = {
        nodes: rootPayload.nodes.map((n) =>
          n.id === selectedId ? { ...n, params: structuredClone(draftParams), code: draftCode } : n,
        ),
        edges: rootPayload.edges,
      };
      const res = await runSingleNode({ nodes: payload.nodes, edges: payload.edges, node_id: selectedId, use_cache: false });
      setLastRunLogs(res.logs ?? []);
      if (res.status === "error") {
        setWorkflowError({ nodeId: res.node_id ?? selectedId, message: res.message ?? "Error" });
        setNodeOutputs((prev) => ({ ...prev, ...(res.node_outputs ?? {}) }));
        setNodes((ns) =>
          ns.map((n) => ({
            ...n,
            data: { ...n.data, status: n.id === res.node_id ? "error" as const : n.data.status },
          })),
        );
      } else {
        setWorkflowError(null);
        setNodeOutputs((prev) => ({ ...prev, ...(res.node_outputs ?? {}) }));
        setNodes((ns) =>
          ns.map((n) =>
            n.id === selectedId ? { ...n, data: { ...n.data, status: "success" as const } } : n,
          ),
        );
      }
    } catch (e) {
      setWorkflowError({ nodeId: selectedId, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunBusy(false);
    }
  }, [selectedId, draftParams, draftCode, nodes, edges, tabs, activeTabId, buildRootPayload]);

  const handleDeleteSelectedNode = useCallback(() => {
    if (!selectedId) return;
    deleteNodeById(selectedId);
  }, [selectedId, deleteNodeById]);

  const handleModalSave = (nodeId: string, data: FlowNodeData) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === nodeId ? { ...n, data: { ...data, status: n.data.status } } : n,
      ),
    );
    if (selectedId === nodeId) {
      setDraftParams(structuredClone(data.params));
      setDraftCode(data.code);
    }
  };

  const activeGroupStack = tabs.find((t) => t.id === activeTabId)?.groupStack ?? [];

  let ctxItems: ContextMenuItem[] = [];
  if (ctxMenu?.kind === "node" && ctxMenu.targetId) {
    const nid = ctxMenu.targetId;
    // selectionIds is set by onSelectionMenu (multi-select) or onNodeMenu (single)
    const targetIds = ctxMenu.selectionIds && ctxMenu.selectionIds.length > 0
      ? ctxMenu.selectionIds
      : [nid];
    const multiSelect = targetIds.length > 1;
    const copyItem: ContextMenuItem = {
      label: "Copy",
      shortcut: "⌘C",
      onClick: () => copyNodes(targetIds),
    };

    const deleteItem: ContextMenuItem = {
      label: multiSelect ? `Delete (${targetIds.length})` : "Delete",
      shortcut: "⌫",
      danger: true,
      onClick: () => {
        setNodes((ns) => ns.filter((n) => !targetIds.includes(n.id)));
        setEdges((es) => es.filter((e) => !targetIds.includes(e.source) && !targetIds.includes(e.target)));
        if (targetIds.includes(selectedId ?? "")) setSelectedId(null);
      },
    };

    // Group creation items — shown when 2+ non-annotation nodes are selected
    const groupItems: ContextMenuItem[] = multiSelect
      ? [
          { label: "Make Group", onClick: () => createGroupFromSelection("group") },
          { label: "Make Component", onClick: () => createGroupFromSelection("component") },
        ]
      : [];

    // Enter / expand items — shown when right-clicking a group/component node
    const clickedNode = nodes.find((n) => n.id === nid);
    const enterGroupItem: ContextMenuItem[] = clickedNode?.type === "flowGroup"
      ? [
          { label: "Open", onClick: () => enterGroup(nid) },
          { label: "Expand", onClick: () => expandGroup(nid) },
        ]
      : [];

    ctxItems =
      ctxMenu.targetType === ANNOTATION_NODE_TYPE
        ? [copyItem, deleteItem]
        : [
            ...(multiSelect ? [] : [{ label: "Run", disabled: runBusy, onClick: () => void runNodeById(nid) } as ContextMenuItem]),
            copyItem,
            ...(multiSelect ? [] : [{ label: "Reset", onClick: () => resetNodeById(nid) } as ContextMenuItem]),
            ...enterGroupItem,
            ...groupItems,
            deleteItem,
          ];
  } else if (ctxMenu?.kind === "edge" && ctxMenu.targetId) {
    const eid = ctxMenu.targetId;
    ctxItems = [
      { label: "Delete connection", shortcut: "⌫", danger: true, onClick: () => deleteEdgeById(eid) },
    ];
  } else if (ctxMenu?.kind === "pane") {
    const flowPos = ctxMenu.flowPos;
    ctxItems = [
      {
        label: "Add Node…",
        onClick: () => {
          setNodePickerSearch("");
          setNodePicker({
            x: ctxMenu.x, y: ctxMenu.y,
            flowPos: flowPos ?? { x: 0, y: 0 },
          });
        },
      },
      {
        label: "Paste",
        shortcut: "⌘V",
        disabled: !clipboardRef.current?.nodes.length,
        onClick: () => pasteNodes(flowPos),
      },
      {
        label: "Add Text Box",
        onClick: () => {
          if (flowPos) addAnnotationBox(flowPos);
        },
      },
    ];
  }

  return (
    <div className="nf-app">
      {/* Combined tab bar + toolbar icon row */}
      <div className="nf-tab-bar">
        {/* FlowX branding */}
        <div className="nf-brand">
          <img src="/flowx.svg" width="22" height="22" alt="FlowX" style={{ display: "block" }} />
          <span className="nf-brand-title">FlowX</span>
        </div>
        <div className="nf-tab-list">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`nf-tab${tab.id === activeTabId ? " nf-tab-active" : ""}`}
              onClick={() => switchTab(tab.id)}
              title={tab.name}
              role="tab"
            >
              <span className="nf-tab-label">{tab.name}</span>
              <button
                type="button"
                className="nf-tab-close"
                title="Close"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="nf-tab-add" title="New workflow" onClick={addTab}>+</button>
        </div>

        <div className="nf-toolbar-icons">
          {/* Run */}
          <button type="button" className="nf-icon-btn nf-icon-btn-run" title="Run Workflow" onClick={handleRunWorkflow}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><polygon points="3,2 14,8 3,14"/></svg>
          </button>
          <div className="nf-icon-sep" />
          {/* Undo */}
          <button type="button" className="nf-icon-btn" title="Undo (Ctrl+Z)" onClick={handleUndo}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 8 C4 4.5 7 2.5 10 3 C13 3.5 14 6 14 8 C14 11 11 13 8 13" strokeLinecap="round"/>
              <polyline points="2,5 4,9 7,6" fill="currentColor" stroke="none"/>
            </svg>
          </button>
          {/* Redo */}
          <button type="button" className="nf-icon-btn" title="Redo (Ctrl+Y)" onClick={handleRedo}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 8 C12 4.5 9 2.5 6 3 C3 3.5 2 6 2 8 C2 11 5 13 8 13" strokeLinecap="round"/>
              <polyline points="14,5 12,9 9,6" fill="currentColor" stroke="none"/>
            </svg>
          </button>
          <div className="nf-icon-sep" />
          {/* Save — floppy disk */}
          <button type="button" className="nf-icon-btn" title={`Save${activeTab?.filePath ? ` · ${activeTab.filePath.split(/[/\\]/).pop()}` : " (Ctrl+S — will prompt for location)"}`} onClick={() => void handleSave()}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4"/>
              <rect x="5" y="2" width="6" height="5" rx="0.5"/>
              <rect x="3" y="9" width="10" height="5" rx="0.5"/>
            </svg>
          </button>
          {/* Save As — floppy disk + right-arrow badge, same 16×16 grid */}
          <button type="button" className="nf-icon-btn" title="Save As… (save a copy to a new location)" onClick={handleSaveAs}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4"/>
              <rect x="5" y="2" width="6" height="5" rx="0.5"/>
              <rect x="3" y="9" width="10" height="5" rx="0.5"/>
              {/* small outward arrow overlaid bottom-right */}
              <path d="M10 12 L14 12 M12.5 10.5 L14 12 L12.5 13.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </button>
          {/* Load — downward arrow + baseline */}
          <button type="button" className="nf-icon-btn" title="Load Workflow" onClick={() => fileInputRef.current?.click()}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M8 2 L8 11 M5 8 L8 11 L11 8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 13 L14 13" strokeLinecap="round"/>
            </svg>
          </button>
          {/* Export — upward arrow inside a rectangle (same shape as Load but arrow up + box) */}
          <button type="button" className="nf-icon-btn" title="Export as Jupyter Notebook" onClick={() => setExportModalOpen(true)}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M8 11 L8 3 M5 5.5 L8 3 L11 5.5" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="2" y="11" width="12" height="3" rx="0.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
          <div className="nf-icon-sep" />
          {/* Clear */}
          <button type="button" className="nf-icon-btn" title="Clear Canvas" onClick={handleClearCanvas}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <polyline points="3,5 13,5" strokeLinecap="round"/>
              <path d="M6 5 L6 13 M10 5 L10 13 M3 5 L4 14 L12 14 L13 5" strokeLinejoin="round"/>
              <path d="M6 3 L10 3" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="nf-icon-sep" />
          {/* AI Studio */}
          <button type="button" className="nf-btn nf-btn-ai nf-btn-ai-sm" onClick={() => setAiStudioOpen(true)}>
            ✦ AI Studio
          </button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" className="nf-hidden-input" onChange={onPickLoadFile} />
        </div>
      </div>

      {/* Breadcrumb nav — visible only when inside a group subflow */}
      {activeGroupStack.length > 0 && (
        <div className="nf-breadcrumb-bar">
          <button
            type="button"
            className="nf-breadcrumb-item"
            onClick={() => exitGroup(0)}
            title="Return to top-level workflow"
          >
            {tabs.find((t) => t.id === activeTabId)?.name ?? "Workflow"}
          </button>
          {activeGroupStack.map((entry, idx) => (
            <span key={entry.groupNodeId} className="nf-breadcrumb-sep-item">
              <span className="nf-breadcrumb-sep">›</span>
              {idx < activeGroupStack.length - 1 ? (
                <button
                  type="button"
                  className="nf-breadcrumb-item"
                  onClick={() => exitGroup(idx + 1)}
                  title={`Return to ${entry.groupLabel}`}
                >
                  {entry.groupLabel}
                </button>
              ) : (
                <span className="nf-breadcrumb-item nf-breadcrumb-current">
                  {entry.groupLabel}
                </span>
              )}
            </span>
          ))}
          <button
            type="button"
            className="nf-breadcrumb-exit-btn"
            onClick={() => exitGroup(activeGroupStack.length - 1)}
            title="Exit group"
          >
            ✕ Exit Group
          </button>
        </div>
      )}

      <Group orientation="vertical" id="nf-layout-vertical" className="nf-workspace">
        <Panel id="nf-main-area" defaultSize="58%" minSize="30%">
          <div className="nf-main-with-rail">
          <SideRail
            active={leftTab}
            onPick={(tab) => setLeftTab((cur) => (cur === tab ? null : tab))}
          />
          <div className="nf-rail-content">
          <Group orientation="horizontal" id="nf-layout-horizontal" className="nf-main-row-panel">
            {leftTab ? (
              <>
                <Panel id="nf-sidebar" defaultSize="22%" minSize="14%" maxSize="36%">
                  <div className="nf-panel-fill">
                    <LeftPanel
                      specs={specs}
                      onAdd={handleAddNode}
                      selectedSpec={selectedNode ? specById[selectedNode.data.type] : selectedSpec}
                      onOpenFile={handleOpenWorkspaceFile}
                      activeTab={leftTab}
                      onCollapse={() => setLeftTab(null)}
                      logs={lastRunLogs}
                    />
                  </div>
                </Panel>
                <Separator className="nf-resize-handle nf-resize-v" />
              </>
            ) : null}
            <Panel id="nf-canvas" defaultSize="52%" minSize="28%">
              <div className="nf-panel-fill"

              >
                <WorkflowCanvas
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onNodesDelete={onNodesDelete}
                  onNodeDoubleClick={(_e: MouseEvent, node) => {
                    if (!isAnnotation(node)) setModalNodeId(node.id);
                  }}
                  onNodeClick={(_e: MouseEvent, node) => {
                    if (!isAnnotation(node)) handleSelectNode(node.id);
                  }}
                  onDropSpec={handleDropSpec}
                  onAddInput={handleAddInputPort}
                  onRemoveInput={handleRemoveInputPort}
                  onAddGroupInput={handleAddGroupInput}
                  onRemoveGroupInput={handleRemoveGroupInput}
                  onAddGroupOutput={handleAddGroupOutput}
                  onRemoveGroupOutput={handleRemoveGroupOutput}
                  onUpdateNodeData={updateNodeData}
                  onNodeMenu={(pos, node) =>
                    setCtxMenu({
                      kind: "node",
                      x: pos.x,
                      y: pos.y,
                      targetId: node.id,
                      targetType: node.type,
                      selectionIds: [node.id],
                    })
                  }
                  onSelectionMenu={(pos, selNodes) =>
                    setCtxMenu({
                      kind: "node",
                      x: pos.x,
                      y: pos.y,
                      targetId: selNodes[0]?.id,
                      selectionIds: selNodes.filter((n) => !isAnnotation(n)).map((n) => n.id),
                    })
                  }
                  onEdgeMenu={(pos, edge) =>
                    setCtxMenu({ kind: "edge", x: pos.x, y: pos.y, targetId: edge.id })
                  }
                  onPaneMenu={(pos, flowPos) => {
                    setCtxMenu({ kind: "pane", x: pos.x, y: pos.y, flowPos });
                  }}
                  onConnectStart={(nodeId, handleId) => {
                    connectingFromRef.current = { nodeId, handleId };
                  }}
                  onConnectEnd={(info) => {
                    connectingFromRef.current = null;
                    // Drop on empty canvas → show node picker for instant connection
                    if (!info.isValid && info.fromNodeId) {
                      setNodePickerSearch("");
                      setNodePicker({
                        x: info.x,
                        y: info.y,
                        flowPos: info.flowPos,
                        connectFrom: { nodeId: info.fromNodeId, handleId: info.fromHandleId },
                      });
                    }
                  }}
                />
              </div>
            </Panel>
            {rightOpen ? (
              <>
                <Separator className="nf-resize-handle nf-resize-v" />
                <Panel id="nf-right" defaultSize="30%" minSize="18%" maxSize="58%">
                  <div className="nf-panel-fill" style={{ position: "relative" }}>
                    <button
                      type="button"
                      className="nf-collapse-strip-right"
                      title="Collapse panel"
                      aria-label="Collapse right panel"
                      onClick={() => setRightOpen(false)}
                    >
                      ▶
                    </button>
                    <aside className="nf-right-pane">
                      <SelectedNodePanel
                        node={selectedNode}
                        spec={selectedNode ? specById[selectedNode.data.type] : undefined}
                        edges={edges}
                        nodeOutputs={nodeOutputs}
                        draftParams={draftParams ?? {}}
                        draftCode={draftCode}
                        onDraftParams={setDraftParams}
                        onDraftCode={setDraftCode}
                        onApply={handleApplyDraft}
                        onRun={handleRunSelectedNode}
                        onReset={selectedId ? () => resetNodeById(selectedId) : undefined}
                        onDelete={handleDeleteSelectedNode}
                        running={runBusy}
                      />
                    </aside>
                  </div>
                </Panel>
              </>
            ) : null}
          </Group>
          </div>
          {!rightOpen ? (
            <button
              type="button"
              className="nf-edge-strip-right"
              title="Expand node panel"
              aria-label="Expand right panel"
              onClick={() => setRightOpen(true)}
            >
              ◀
            </button>
          ) : null}
          </div>
        </Panel>
        {bottomOpen ? (
          <>
            <Separator className="nf-resize-handle nf-resize-h" />
            <Panel id="nf-console" defaultSize="42%" minSize="12%" maxSize="65%">
              <div className="nf-panel-fill" style={{ position: "relative" }}>
                <button
                  type="button"
                  className="nf-collapse-strip-bottom"
                  title="Collapse console"
                  aria-label="Collapse bottom panel"
                  onClick={() => setBottomOpen(false)}
                >
                  ▼
                </button>
                <OutputPreview
                  title="Console"
                  nodeId={selectedId ?? undefined}
                  nodeLabel={selectedNode?.data.label}
                  output={bottomOutput}
                  errorMessage={bottomError}
                  logs={lastRunLogs.length ? lastRunLogs : undefined}
                  portTabPrefix={bottomPortPrefix}
                />
                {composeResult ? <PlanReviewPanel composeResult={composeResult} /> : null}
              </div>
            </Panel>
          </>
        ) : null}
      </Group>
      {!bottomOpen ? (
        <button
          type="button"
          className="nf-edge-strip-bottom"
          title="Expand console"
          aria-label="Expand bottom panel"
          onClick={() => setBottomOpen(true)}
        >
          ▲ Console
        </button>
      ) : null}

      <NodeNotebookModal
        open={modalNodeId !== null}
        node={modalNode}
        spec={modalSpec}
        edges={edges}
        nodeOutputs={nodeOutputs}
        lastRunLogs={lastRunLogs}
        workflowPayload={workflowPayloadFn}
        onClose={() => setModalNodeId(null)}
        onSave={handleModalSave}
        onOutputsUpdate={(partial: NodeOutputsMap, logs: string[]) => {
          setNodeOutputs((prev) => ({ ...prev, ...partial }));
          setLastRunLogs(logs);
        }}
        onNodeStatus={(nodeId: string, status: FlowNodeData["status"]) => {
          setNodes((ns) =>
            ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)),
          );
        }}
      />

      {aiStudioOpen ? (
        <AIStudioPage
          onClose={() => setAiStudioOpen(false)}
          onComposed={(res: ComposeWorkflowResponse) => {
            mergeSpecs(res.generated_node_specs);
            applyWorkflowPayload(res.workflow);
            setComposeResult(res);
          }}
          onNotebookApply={(res: NotebookStandardizeResponse) => {
            mergeSpecs(res.generated_node_specs);
            applyWorkflowPayload(res.workflow);
            setComposeResult(null);
          }}
          onNodeSpecCreated={(spec: NodeSpec) => {
            mergeSpecs([spec]);
            setSelectedSpec(spec);
          }}
        />
      ) : null}

      {ctxMenu ? (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems}
          onClose={() => setCtxMenu(null)}
        />
      ) : null}

      {(() => {
        const fp = activeTab?.filePath;
        return (
          <SaveWorkflowModal
            open={saveModalOpen}
            defaultFolder={fp ? fp.replace(/[/\\][^/\\]*$/, "") : undefined}
            defaultName={fp ? fp.split(/[/\\]/).pop() : "workflow.json"}
            dedupe={!fp}
            getContent={() => JSON.stringify(buildSavedWorkflow(), null, 2)}
            onDownload={downloadWorkflow}
            onClose={() => setSaveModalOpen(false)}
            onSaved={(path) => {
              const name = (path.split(/[/\\]/).pop() ?? "").replace(/\.json$/i, "");
              setTabs((prev) =>
                prev.map((t) =>
                  t.id === activeTabId ? { ...t, filePath: path, name: name || t.name } : t,
                ),
              );
            }}
          />
        );
      })()}

      <SaveWorkflowModal
        open={exportModalOpen}
        title="Export Notebook (.ipynb)"
        defaultName="workflow.ipynb"
        ext=".ipynb"
        getContent={notebookContent}
        onDownload={downloadNotebook}
        onClose={() => setExportModalOpen(false)}
      />

      {/* Close-tab confirmation dialog */}
      {closeTabConfirm ? (
        <div className="nf-modal-overlay">
          <button type="button" className="nf-modal-backdrop" onClick={() => setCloseTabConfirm(null)} aria-label="Cancel" />
          <div className="nf-modal" style={{ zIndex: 10, maxWidth: 360 }}>
            <div className="nf-modal-header">
              <h2 style={{ margin: 0, fontSize: 15 }}>Close "{closeTabConfirm.tabName}"?</h2>
            </div>
            <div className="nf-modal-body">
              <p style={{ margin: "0 0 16px", fontSize: 13 }}>
                This workflow has unsaved changes. Save before closing?
              </p>
              <div className="nf-modal-actions-row">
                <button type="button" className="nf-btn" onClick={() => setCloseTabConfirm(null)}>
                  Cancel
                </button>
                <button type="button" className="nf-btn nf-btn-danger" onClick={() => doCloseTab(closeTabConfirm.tabId)}>
                  Discard
                </button>
                <button
                  type="button"
                  className="nf-btn nf-btn-primary"
                  onClick={() => {
                    setSaveModalOpen(true);
                    // After save modal closes, close the tab
                    // (we keep closeTabConfirm so Discard still works)
                  }}
                >
                  Save…
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Node picker — "Add Node" from right-click on canvas */}
      {nodePicker ? (
        <div
          ref={nodePickerRef}
          className="nf-node-picker"
          style={{ left: Math.min(nodePicker.x, window.innerWidth - 300), top: Math.min(nodePicker.y, window.innerHeight - 360) }}
        >
          <div className="nf-node-picker-header">
            <input
              autoFocus
              type="text"
              className="nf-search-input"
              placeholder="Search nodes…"
              value={nodePickerSearch}
              onChange={(e) => setNodePickerSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setNodePicker(null); }}
            />
          </div>
          <ul className="nf-node-picker-list">
            {specs
              .filter((s) => {
                const q = nodePickerSearch.toLowerCase();
                if (q && !s.label.toLowerCase().includes(q) && !s.id.includes(q) && !(s.category ?? "").toLowerCase().includes(q)) return false;
                // When dragging from img_out, only show nodes with img_in input
                if (nodePicker.connectFrom?.handleId === "img_out") {
                  return Object.keys(s.inputs).some((k) => isImgHandle(k));
                }
                return true;
              })
              .slice(0, 20)
              .map((spec) => (
                <li key={spec.id}>
                  <button
                    type="button"
                    className="nf-node-picker-item"
                    style={{ borderLeftColor: spec.color }}
                    onClick={() => {
                      const newNode = buildNode(spec, nodePicker.flowPos);
                      setNodes((ns) => [...ns, newNode]);
                      if (nodePicker.connectFrom && newNode.data.showInput) {
                        const { nodeId, handleId } = nodePicker.connectFrom;
                        const srcHandle = handleId ?? "df_out";
                        const isImgSrc = srcHandle === "img_out";
                        // Use first input handle of the new node (img_in or df_in)
                        const firstInputHandle = (newNode.data.inputHandles as string[] | undefined)?.[0]
                          ?? inputHandleId(1);
                        // Type guard: don't connect if incompatible
                        if (isImgSrc !== isImgHandle(firstInputHandle)) {
                          setNodePicker(null);
                          return;
                        }
                        setEdges((es) => [
                          ...es,
                          {
                            id: `edge_${nodeId}_${newNode.id}_${Date.now()}`,
                            source: nodeId,
                            sourceHandle: srcHandle,
                            target: newNode.id,
                            targetHandle: firstInputHandle,
                            style: isImgSrc ? { stroke: "#f57c00", strokeWidth: 2 } : { stroke: "#222", strokeWidth: 1.5 },
                          },
                        ]);
                      }
                      setNodePicker(null);
                    }}
                  >
                    <span className="nf-node-picker-label">{spec.label}</span>
                    <span className="nf-node-picker-cat">{spec.category}</span>
                  </button>
                </li>
              ))}
            {specs.filter((s) => {
              const q = nodePickerSearch.toLowerCase();
              return !q || s.label.toLowerCase().includes(q) || s.id.includes(q);
            }).length === 0 ? (
              <li className="nf-muted" style={{ padding: "8px 12px", fontSize: 12 }}>No nodes found.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
