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
import { exportIpynb, fetchNodeSpecs, runSingleNode, runWorkflow, workspaceRead } from "./api/client";
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
import type {
  AnnotationBoxPayload,
  ComposeWorkflowResponse,
  FlowNodeData,
  NodeOutputsMap,
  NodeSpec,
  NotebookStandardizeResponse,
  WorkflowEdgePayload,
  WorkflowNodePayload,
} from "./types";
import { Group, Panel, Separator } from "react-resizable-panels";
import "./styles.css";

function newNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function flowExtras(
  spec: NodeSpec,
): Pick<FlowNodeData, "showInput" | "outputHandle" | "showOutput" | "inputCount" | "dynamicInputs"> {
  const inputCount = Object.keys(spec.inputs).length;
  const hasDf = Object.keys(spec.outputs).includes("df_out");
  const hasHtml = Object.keys(spec.outputs).includes("html_out");
  return {
    showInput: inputCount > 0,
    outputHandle: hasHtml && !hasDf ? "html_out" : "df_out",
    // View-only nodes (map/plot, html_out only) carry no downstream data,
    // so they get no output port.
    showOutput: hasDf,
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
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

const CUSTOM_NODES_STORAGE_KEY = "notebookflow.customNodeSpecs.v1";

export default function App() {
  const [specs, setSpecs] = useState<NodeSpec[]>([]);
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalNodeId, setModalNodeId] = useState<string | null>(null);
  const [nodeOutputs, setNodeOutputs] = useState<NodeOutputsMap>({});
  const [lastRunLogs, setLastRunLogs] = useState<string[]>([]);
  const [workflowError, setWorkflowError] = useState<{ nodeId: string | null; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draftParams, setDraftParams] = useState<Record<string, unknown> | null>(null);
  const [draftCode, setDraftCode] = useState("");
  const [runBusy, setRunBusy] = useState(false);
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

  const onNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) =>
      addEdge({
        ...params,
        id: `edge_${params.source}_${params.target}_${Date.now()}`,
        sourceHandle: params.sourceHandle ?? "df_out",
        targetHandle: params.targetHandle ?? "df_in",
      }, eds),
    );
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
      setNodes((nds) => [...nds, buildNode(spec, position)]);
    },
    [specById, buildNode],
  );

  const handleAddInputPort = useCallback((nodeId: string) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === nodeId && n.data.dynamicInputs
          ? { ...n, data: { ...n.data, inputCount: Math.max(1, n.data.inputCount ?? 1) + 1 } }
          : n,
      ),
    );
  }, []);

  const handleRemoveInputPort = useCallback((nodeId: string) => {
    setNodes((ns) => {
      const node = ns.find((n) => n.id === nodeId);
      if (!node || !node.data.dynamicInputs) return ns;
      const count = Math.max(1, node.data.inputCount ?? 1);
      if (count <= 1) return ns; // last port cannot be removed
      const removedHandle = count === 2 ? "df_in_2" : `df_in_${count}`;
      setEdges((es) =>
        es.filter((e) => !(e.target === nodeId && e.targetHandle === removedHandle)),
      );
      return ns.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, inputCount: count - 1 } } : n,
      );
    });
  }, []);

  const deleteNodeById = useCallback((nodeId: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setNodeOutputs((prev) => { const next = { ...prev }; delete next[nodeId]; return next; });
    setSelectedId((sid) => (sid === nodeId ? null : sid));
    setModalNodeId((mid) => (mid === nodeId ? null : mid));
    setWorkflowError((we) => (we?.nodeId === nodeId ? null : we));
  }, []);

  const deleteEdgeById = useCallback((edgeId: string) => {
    setEdges((es) => es.filter((e) => e.id !== edgeId));
  }, []);

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
  }, [nextNodeNumber]);

  const runNodeById = useCallback(
    async (nodeId: string) => {
      setRunBusy(true);
      setWorkflowError(null);
      setNodes((ns) =>
        ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: "running" as const } } : n)),
      );
      try {
        const payload = buildPayload(nodes, edges);
        const res = await runSingleNode({ nodes: payload.nodes, edges: payload.edges, node_id: nodeId });
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
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, status: "success" as const } } : n,
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
    [nodes, edges],
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
      const payload = buildPayload(nodes, edges);
      const res = await runWorkflow(payload);
      setLastRunLogs(res.logs ?? []);
      if (res.status === "error") {
        setWorkflowError({ nodeId: res.node_id ?? null, message: res.message ?? "Error" });
        const outs = res.node_outputs ?? {};
        setNodeOutputs(outs);
        setNodes((ns) =>
          ns.map((n) => ({
            ...n,
            data: {
              ...n.data,
              status: n.id === res.node_id ? "error" : outs[n.id] ? "success" : "idle",
            },
          })),
        );
        return;
      }
      setNodeOutputs(res.node_outputs ?? {});
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
        const spec = specs.find((s) => s.id === sn.type);
        const annotation = sn.annotation ?? `Node ${i + 1}`;
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
      const nextEdges: Edge[] = wf.edges.map((e) => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle ?? "df_out", targetHandle: e.targetHandle ?? "df_in",
      }));
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
      const nextEdges: Edge[] = wf.edges.map((e, i) => ({
        id: e.id || `edge_${i + 1}`, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle ?? "df_out", targetHandle: e.targetHandle ?? "df_in",
      }));
      setNodes(nextNodes); setEdges(nextEdges);
      setSelectedId(null); setModalNodeId(null); setNodeOutputs({}); setWorkflowError(null);
    },
    [specs],
  );

  const handleOpenWorkspaceFile = useCallback(
    async (path: string) => {
      if (!path.toLowerCase().endsWith(".json")) return;
      const fileName = path.split(/[/\\]/).pop();
      if (nodesRef.current.length && !confirm(`Open "${fileName}" as a workflow? The current canvas will be replaced.`)) {
        return;
      }
      try {
        const res = await workspaceRead(path);
        const wf = JSON.parse(res.content) as SavedWorkflow;
        if (!Array.isArray(wf.nodes) || !Array.isArray(wf.edges)) {
          throw new Error("Not a GeoFlow workflow JSON (missing nodes/edges).");
        }
        restoreWorkflow(wf);
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
      }
    },
    [restoreWorkflow],
  );

  const onPickLoadFile = (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wf = JSON.parse(String(reader.result)) as SavedWorkflow;
        restoreWorkflow(wf);
      } catch (e) { alert(e instanceof Error ? e.message : "Invalid workflow JSON"); }
    };
    reader.readAsText(file);
    ev.target.value = "";
  };

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const modalNode = modalNodeId ? nodes.find((n) => n.id === modalNodeId) ?? null : null;
  const modalSpec = modalNode ? specById[modalNode.data.type] : undefined;

  const bottomOutput = selectedId ? nodeOutputs[selectedId] : undefined;
  const bottomError =
    workflowError?.nodeId && workflowError.nodeId === selectedId ? workflowError.message : null;

  const workflowPayloadFn = useCallback(() => buildPayload(nodes, edges), [nodes, edges]);

  const handleSelectNode = useCallback((nodeId: string) => {
    startTransition(() => { setSelectedId(nodeId); });
  }, []);

  const handleApplyDraft = useCallback(() => {
    if (!selectedId || draftParams === null) return;
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, params: structuredClone(draftParams), code: draftCode } }
          : n,
      ),
    );
  }, [selectedId, draftParams, draftCode]);

  const handleRunSelectedNode = useCallback(async () => {
    if (!selectedId || draftParams === null) return;
    const merged = nodes.map((n) =>
      n.id === selectedId
        ? { ...n, data: { ...n.data, params: structuredClone(draftParams), code: draftCode } }
        : n,
    );
    setNodes(merged);
    setRunBusy(true);
    setWorkflowError(null);
    try {
      const payload = buildPayload(merged, edges);
      const res = await runSingleNode({ nodes: payload.nodes, edges: payload.edges, node_id: selectedId });
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
  }, [selectedId, draftParams, draftCode, nodes, edges]);

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

  let ctxItems: ContextMenuItem[] = [];
  if (ctxMenu?.kind === "node" && ctxMenu.targetId) {
    const nid = ctxMenu.targetId;
    const copyItem: ContextMenuItem = {
      label: "Copy",
      shortcut: "⌘C",
      onClick: () => {
        const sel = nodes.filter((n) => n.selected).map((n) => n.id);
        copyNodes(sel.includes(nid) ? sel : [nid]);
      },
    };
    const deleteItem: ContextMenuItem = {
      label: "Delete",
      shortcut: "⌫",
      danger: true,
      onClick: () => deleteNodeById(nid),
    };
    ctxItems =
      ctxMenu.targetType === ANNOTATION_NODE_TYPE
        ? [copyItem, deleteItem]
        : [
            { label: "Run", disabled: runBusy, onClick: () => void runNodeById(nid) },
            copyItem,
            { label: "Reset", onClick: () => resetNodeById(nid) },
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
      <header className="nf-toolbar">
        <div className="nf-brand">GeoFlow</div>
        <div className="nf-toolbar-actions">
          <button type="button" className="nf-btn nf-btn-primary" onClick={handleRunWorkflow}>
            Run
          </button>
          <button type="button" className="nf-btn" onClick={handleClearCanvas}>
            Clear
          </button>
          <button type="button" className="nf-btn" onClick={() => setSaveModalOpen(true)}>
            Save
          </button>
          <button type="button" className="nf-btn" onClick={() => fileInputRef.current?.click()}>
            Load
          </button>
          <button
            type="button"
            className="nf-btn"
            title="Export the workflow as an equivalent Jupyter notebook (.ipynb)"
            onClick={() => setExportModalOpen(true)}
          >
            Export
          </button>
          <button
            type="button"
            className="nf-btn nf-btn-ai"
            onClick={() => setAiStudioOpen(true)}
          >
            ✦ AI Studio
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="nf-hidden-input"
            onChange={onPickLoadFile}
          />
        </div>
      </header>

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
              <div className="nf-panel-fill">
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
                  onUpdateNodeData={updateNodeData}
                  onNodeMenu={(pos, node) =>
                    setCtxMenu({
                      kind: "node",
                      x: pos.x,
                      y: pos.y,
                      targetId: node.id,
                      targetType: node.type,
                    })
                  }
                  onEdgeMenu={(pos, edge) =>
                    setCtxMenu({ kind: "edge", x: pos.x, y: pos.y, targetId: edge.id })
                  }
                  onPaneMenu={(pos, flowPos) =>
                    setCtxMenu({ kind: "pane", x: pos.x, y: pos.y, flowPos })
                  }
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

      <SaveWorkflowModal
        open={saveModalOpen}
        getContent={() => JSON.stringify(buildSavedWorkflow(), null, 2)}
        onDownload={downloadWorkflow}
        onClose={() => setSaveModalOpen(false)}
      />

      <SaveWorkflowModal
        open={exportModalOpen}
        title="Export Notebook (.ipynb)"
        defaultName="workflow.ipynb"
        ext=".ipynb"
        getContent={notebookContent}
        onDownload={downloadNotebook}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  );
}
