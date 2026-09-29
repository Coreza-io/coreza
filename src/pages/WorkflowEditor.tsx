/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
} from "react";
import { createPortal } from "react-dom";
import {
  ConnectionDragContext,
  DragSource,
} from "@/contexts/ConnectionDragContext";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  BackgroundVariant,
  MarkerType,
  useReactFlow,
  ConnectionLineType,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Save,
  Pause,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Upload,
} from "lucide-react";
import { exportWorkflow, importWorkflow } from "@/utils/workflowExport";
import { motion, AnimatePresence } from "framer-motion";
import { NodePalette } from "@/components/workflow/NodePalette";
import EdgeManager from "@/components/workflow/EdgeManager";
import { LoopNode, LoopNodeData } from "@/components/workflow/LoopNode";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ExecutionFilters,
  ExecutionRun,
  useExecutionHistory,
} from "@/hooks/useExecutionHistory";
import { ExecutionHistoryPanel } from "@/components/workflow/ExecutionHistoryPanel";
import { ExecutionDetailView } from "@/components/workflow/ExecutionDetailView";
import { WorkflowVersionHistory } from "@/components/workflow/WorkflowVersionHistory";

// Import node types
import NodeRouter from "@/components/nodes/NodeRouter";
import { nodeManifest } from "@/nodes/manifest";
import { getTemplate, isValidTemplate } from "@/templates/workflows";
import { reconcileNodeValues } from "@/utils/reconcileNodeValues";
import { WorkflowExecutor } from "@/utils/workflowExecutor";
import { useWorkflowPersistence } from "@/hooks/useWorkflowPersistence";
import {
  ExecutionStoreProvider,
  useExecutionStore,
} from "@/contexts/ExecutionStoreContext";
import { StableNodeProvider, useCanonicalGraphSync, useStableNodes } from "@/contexts/StableNodeContext";
import { appendNewsItem, createWaitingNewsOutput } from "@/utils/newsStream";
import {
  isNewsStreamNode,
  getNewsUnsubscribeEndpoint,
} from "@/utils/brokerRegistry";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { cn } from "@/lib/utils";
import type { NodeCluster } from "@/domain/clusters/types";
import { parseNodeClusters } from "@/domain/clusters/parse";
import { validateClusterSelection, validateClusters } from "@/domain/clusters/validate";
import { deleteNodesFromDocument, type WorkflowDocument } from "@/domain/clusters/documentCommands";
import { apiClient } from "@/lib/apiClient";
import { useWorkflowActivation } from "@/hooks/useWorkflowActivation";
import { ExecuteAllControl } from "@/components/workflow/ExecuteAllControl";
import { ClusterExecutionControl } from "@/components/workflow/ClusterExecutionControl";
import { useClusterExecution } from "@/hooks/useClusterExecution";
import { clearEditorNodeActions, isEditorExecutionLocked } from "@/services/editorNodeExecution";
import { ActivateControl } from "@/components/workflow/ActivateControl";
import { ToastAction } from "@/components/ui/toast";
import { CompactClusterNode } from "@/components/workflow/CompactClusterNode";
import { getVisibleClusterNodes, projectClusterGraph } from "@/domain/clusters/projection";
import {
  isClusterExpanded,
  reconcileClusterViewState,
  setClusterExpanded,
  type ClusterViewState,
} from "@/domain/clusters/viewState";
import { CLUSTER_COLLAPSE_ENABLED } from "@/domain/clusters/capabilities";
import { resolveCanonicalSelection } from "@/domain/clusters/selection";
import { repairProjectedClusterNodes } from "@/domain/clusters/canonicalNode";
import {
  applyPositionTargets,
  capturePositions,
  positionsEqual,
  translatePositions,
  type PositionMap,
} from "@/domain/clusters/positions";

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

const BACKTEST_INIT_NODE_TYPE = "BacktestInit";
const ON_BAR_NODE_TYPE = "OnBar";
const ON_BAR_COMPANION_OFFSET_X = 450;

const resolveWebSocketUrl = (): string | null => {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) {
    return explicit;
  }

  try {
    const api = new URL(API_BASE_URL);
    const configuredPort = import.meta.env.VITE_WS_PORT as string | undefined;
    const wsProtocol = api.protocol === "https:" ? "wss:" : "ws:";
    const port =
      configuredPort ??
      (api.port ? (api.port === "8000" ? "8080" : api.port) : "8080");
    return `${wsProtocol}//${api.hostname}:${port}`;
  } catch (error) {
    console.error("Failed to derive WebSocket URL", error);
    return null;
  }
};

const parseSymbolsValue = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s): s is string => Boolean(s));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
};

// Base node type mapping (excluding custom Loop node)
const baseNodeTypes = Object.fromEntries([
  // Map by manifest keys (skip Loop; it'll use a custom component)
  ...Object.keys(nodeManifest)
    .filter((nodeKey) => nodeKey !== "Loop")
    .map((nodeKey) => [nodeKey, NodeRouter]),
  // Map by node name values (for proper type mapping)
  ...Object.values(nodeManifest).map((nodeDef: any) => [
    nodeDef.name,
    NodeRouter,
  ]),
]);

//console.log("Available nodeTypes:", Object.keys(nodeTypes));
//console.log("NodeManifest keys:", Object.keys(nodeManifest));

const edgeTypes = {
  default: EdgeManager.PlugEdge,
  loop: EdgeManager.LoopEdge,
  removable: EdgeManager.DefaultEdge,
};

// Initial nodes for demonstration
const initialNodes: Node[] = [
  {
    id: "hello-node",
    type: "FinnHub", // Use the manifest key, not node_type
    position: { x: 100, y: 100 },
    data: {
      label: "Welcome to Coreza!",
      definition: nodeManifest.FinnHub,
    },
  },
];

const initialEdges: Edge[] = [];

interface CanvasMenuState {
  x: number;
  y: number;
  nodeIds: string[];
  kind: "selection" | "pane";
}

interface ClusterMoveSession {
  workflowSessionId: string;
  clusterId: string;
  source: "compact" | "expanded";
  pointerId?: number;
  clusterMemberNodeIds: string[];
  movedNodeIds: string[];
  initialMemberPositions: PositionMap;
  currentMemberPositions: PositionMap;
  initialDisplayPosition: { x: number; y: number };
  initialFlowPointer?: { x: number; y: number };
}

type HistoryEntry =
  | { type: "document"; document: WorkflowDocument }
  | { type: "positions"; nodeIds: string[]; before: PositionMap; after: PositionMap };

const WorkflowEditorContent = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: authUser, session, loading: authLoading } = useAuth();
  const { toggleActivation } = useWorkflowActivation();
  const executionStore = useExecutionStore();
  const stableNodes = useStableNodes();
  const wsRef = useRef<WebSocket | null>(null);
  const messageHandlerRef = useRef<
    (rawPayload: any, timestamp?: string) => void
  >(() => {});
  const resolvedTheme = useResolvedTheme();

  // CRITICAL FIX: Make isNewWorkflow reactive to URL changes
  const isNewWorkflow = id === "new" || !id;
  const projectId = searchParams.get("project"); // Get project ID from URL parameters

  const [workflowId, setWorkflowId] = useState<string | null>(() =>
    isNewWorkflow ? crypto.randomUUID() : (id ?? null),
  );
  const hasPersistedRef = useRef<boolean>(!isNewWorkflow);
  const workflowSessionId = useMemo(() => {
    // Tie lifecycle to workflowId changes (new workflow => new session scope).
    void workflowId;
    return crypto.randomUUID();
  }, [workflowId]);

  useEffect(() => () => clearEditorNodeActions(workflowSessionId), [workflowSessionId]);

  // CRITICAL FIX: Sync workflowId with URL parameter changes
  useEffect(() => {
    if (!isNewWorkflow && id && id !== workflowId) {
      setWorkflowId(id);
      hasPersistedRef.current = true;
    }
  }, [id, isNewWorkflow, workflowId]);
  const [workflowName, setWorkflowName] = useState(
    isNewWorkflow ? "My workflow 1" : "Loading...",
  );
  const [isActive, setIsActive] = useState(false);
  const [clusters, setClusters] = useState<NodeCluster[]>([]);
  const [clusterViewState, setClusterViewState] = useState<ClusterViewState>({});
  const [selectedClusterIds, setSelectedClusterIds] = useState<Set<string>>(() => new Set());
  const [invalidClusterEntries, setInvalidClusterEntries] = useState<Array<{ index: number; value: unknown }>>([]);
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null);
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const contextMenuFocusRef = useRef<HTMLElement | null>(null);
  const clusterMoveRef = useRef<ClusterMoveSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingExecution, setLoadingExecution] = useState(false);
  const [isPaletteVisible, setIsPaletteVisible] = useState(true);
  const [executingNode, setExecutingNode] = useState<string | null>(null);
  const [isAutoExecuting, setIsAutoExecuting] = useState(false);
  const [executionQueue, setExecutionQueue] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"editor" | "executions">("editor");
  const [statusFilter, setStatusFilter] =
    useState<ExecutionFilters["status"]>("all");
  const [dateFromInput, setDateFromInput] = useState<Date | null>(null);
  const [dateToInput, setDateToInput] = useState<Date | null>(null);
  const [dateFromFilter, setDateFromFilter] = useState<Date | null>(null);
  const [dateToFilter, setDateToFilter] = useState<Date | null>(null);
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showSaveConfirmDialog, setShowSaveConfirmDialog] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<{
    currentCount: number;
    newCount: number;
  } | null>(null);

  // Workflow persistence hook (save/load/versioning/getVisibleValues)
  const {
    saving: persistSaving,
    loading: persistLoading,
    saveWorkflow,
    loadWorkflow: persistLoadWorkflow,
    generateNewWorkflowName,
    hasUnsavedChanges,
    checkNodeReduction,
  } = useWorkflowPersistence({ projectId });

  useEffect(() => {
    const timeout = setTimeout(() => setDateFromFilter(dateFromInput), 400);
    return () => clearTimeout(timeout);
  }, [dateFromInput]);

  useEffect(() => {
    const timeout = setTimeout(() => setDateToFilter(dateToInput), 400);
    return () => clearTimeout(timeout);
  }, [dateToInput]);

  const executionFilters = useMemo(
    () => ({
      status: statusFilter,
      dateFrom: dateFromFilter,
      dateTo: dateToFilter,
    }),
    [statusFilter, dateFromFilter, dateToFilter],
  );

  // Execution history hook
  const {
    executions,
    loading: executionsLoading,
    loadingMore,
    hasMore,
    loadMore,
    selectedExecution,
    setSelectedExecution,
    autoRefresh,
    setAutoRefresh,
    refresh: refreshExecutions,
    getDuration,
    getNodeExecutions,
    error: executionsError,
  } = useExecutionHistory(workflowId, executionFilters);

  const executionLoadingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const handleSelectExecution = useCallback(
    (execution: ExecutionRun) => {
      if (selectedExecution?.id === execution.id) return;

      if (executionLoadingTimeoutRef.current) {
        clearTimeout(executionLoadingTimeoutRef.current);
      }

      setLoadingExecution(true);
      setSelectedExecution(execution);

      executionLoadingTimeoutRef.current = setTimeout(
        () => setLoadingExecution(false),
        150,
      );
    },
    [selectedExecution?.id, setSelectedExecution],
  );

  useEffect(() => {
    return () => {
      if (executionLoadingTimeoutRef.current) {
        clearTimeout(executionLoadingTimeoutRef.current);
      }
    };
  }, []);

  const handleClearFilters = useCallback(() => {
    setStatusFilter("all");
    setDateFromInput(null);
    setDateToInput(null);
    setDateFromFilter(null);
    setDateToFilter(null);
  }, []);

  // CRITICAL FIX: Initialize with empty state for existing workflows to prevent race condition
  const [nodes, setNodes, applyNodeChanges] = useNodesState(
    isNewWorkflow ? initialNodes : [],
  );
  const [edges, setEdges] = useEdgesState(
    isNewWorkflow ? initialEdges : [],
  );
  useCanonicalGraphSync(nodes, edges);
  const rf = useReactFlow();
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[]; clusters: NodeCluster[] } | null>(null);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 400, y: 300 });

  // Connection drag tracking for hiding source handle icon
  const [dragSource, setDragSource] = useState<DragSource>({
    nodeId: null,
    handleId: null,
    handleType: null,
  });
  const onConnectStart = useCallback((_: any, params: any) => {
    setDragSource({
      nodeId: params.nodeId ?? null,
      handleId: params.handleId ?? null,
      handleType: params.handleType ?? null,
    });
  }, []);
  const onConnectEnd = useCallback(() => {
    setDragSource({ nodeId: null, handleId: null, handleType: null });
  }, []);
  const historyRef = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const commitEdgeCandidateRef = useRef<(candidateEdges: Edge[]) => void>(() => undefined);
  const canonicalEdgesRef = useRef(edges);
  canonicalEdgesRef.current = edges;

  useEffect(() => stableNodes.registerNodeDataUpdater((nodeId, patch) => {
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...patch } }
      : node));
  }), [setNodes, stableNodes]);

  useEffect(() => {
    setClusterViewState((current) => {
      const reconciled = reconcileClusterViewState(current, clusters);
      const currentIds = Object.keys(current);
      const reconciledIds = Object.keys(reconciled);
      return currentIds.length === reconciledIds.length
        && reconciledIds.every((clusterId) => current[clusterId] === reconciled[clusterId])
        ? current
        : reconciled;
    });
  }, [clusters]);

  useEffect(() => {
    setClusterViewState({});
    setSelectedClusterIds(new Set());
    clusterMoveRef.current = null;
  }, [workflowId]);

  useEffect(() => () => {
    clusterMoveRef.current = null;
  }, []);

  const setExpanded = useCallback((clusterId: string, expanded: boolean) => {
    setClusterViewState((current) => setClusterExpanded(current, clusterId, expanded));
  }, []);

  const collapsedRuntimeHostIds = useMemo(() => new Set(
    clusters
      .filter((cluster) => !isClusterExpanded(clusterViewState, cluster.id))
      .flatMap((cluster) => cluster.memberNodeIds),
  ), [clusterViewState, clusters]);

  const cloneNodes = useCallback((sourceNodes: Node[]) => {
    return sourceNodes.map((node) => ({
      ...node,
      data: { ...node.data },
    }));
  }, []);

  const stampNodesWithWorkflowSession = useCallback(
    (sourceNodes: Node[]) => {
      return sourceNodes.map((node) => ({
        ...node,
        data: {
          ...(node.data ?? {}),
          workflowSessionId,
        },
      }));
    },
    [workflowSessionId],
  );

  const cloneEdges = useCallback((sourceEdges: Edge[]) => {
    return sourceEdges.map((edge) => ({
      ...edge,
      data: { ...edge.data },
    }));
  }, []);

  const saveHistorySnapshot = useCallback(() => {
    historyRef.current.past.push({ type: "document", document: {
      nodes: cloneNodes(nodes),
      edges: cloneEdges(edges),
      clusters: clusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })),
    } });
    historyRef.current.future = [];
  }, [cloneEdges, cloneNodes, clusters, edges, nodes]);

  const restoreDocument = useCallback((document: WorkflowDocument) => {
    setNodes(stampNodesWithWorkflowSession(repairProjectedClusterNodes(cloneNodes(document.nodes))));
    setEdges(cloneEdges(document.edges));
    setClusters(document.clusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })));
  }, [cloneEdges, cloneNodes, setEdges, setNodes, stampNodesWithWorkflowSession]);

  const deleteNodeIds = useCallback((nodeIds: readonly string[]) => {
    if (nodeIds.length === 0 || dragSource.nodeId || isEditorExecutionLocked(workflowSessionId)) return;
    saveHistorySnapshot();
    const result = deleteNodesFromDocument({ nodes, edges, clusters }, new Set(nodeIds));
    restoreDocument(result.document);
    if (result.dissolvedClusters.length > 0) {
      toast({ title: "Cluster dissolved", description: result.dissolvedClusters.map(({ title }) => title).join(", ") });
    }
  }, [clusters, dragSource.nodeId, edges, nodes, restoreDocument, saveHistorySnapshot, toast, workflowSessionId]);

  const dissolveClustersForNodes = useCallback((nodeIds: readonly string[]) => {
    const selected = new Set(nodeIds);
    const matching = clusters.filter((cluster) => cluster.memberNodeIds.some((id) => selected.has(id)));
    if (matching.length === 0 || dragSource.nodeId || isEditorExecutionLocked(workflowSessionId)) return;
    saveHistorySnapshot();
    setClusters((current) => current.filter((cluster) => !matching.some(({ id }) => id === cluster.id)));
    setCanvasMenu(null);
  }, [clusters, dragSource.nodeId, saveHistorySnapshot, workflowSessionId]);

  const nextClusterTitle = useMemo(() => {
    const usedTitles = new Set(clusters.map(({ title }) => title.toLocaleLowerCase()));
    let index = 1;
    while (usedTitles.has(`cluster ${index}`)) index += 1;
    return `Cluster ${index}`;
  }, [clusters]);

  const createClusterFromSelection = useCallback((requestedIds?: readonly string[]) => {
    if (dragSource.nodeId || isEditorExecutionLocked(workflowSessionId)) return;
    const selectedIds = requestedIds?.length
      ? [...requestedIds]
      : resolveCanonicalSelection(nodes, clusters, selectedClusterIds, collapsedRuntimeHostIds);
    const candidate: NodeCluster = { id: crypto.randomUUID(), title: nextClusterTitle, memberNodeIds: selectedIds };
    const result = validateClusterSelection(selectedIds, nodes, edges, clusters, candidate);
    if (!result.valid) {
      toast({ title: "Cannot create cluster", description: result.violations[0]?.message });
      return;
    }
    saveHistorySnapshot();
    setClusters((current) => [...current, { ...candidate, memberNodeIds: result.resolvedMemberNodeIds ?? selectedIds }]);
    setExpanded(candidate.id, true);
    setEditingClusterId(candidate.id);
    setCanvasMenu(null);
  }, [clusters, collapsedRuntimeHostIds, dragSource.nodeId, edges, nextClusterTitle, nodes, saveHistorySnapshot, selectedClusterIds, setExpanded, toast, workflowSessionId]);

  const finishClusterMove = useCallback((cancel = false) => {
    const move = clusterMoveRef.current;
    if (!move) return;
    clusterMoveRef.current = null;
    const currentPositions = move.currentMemberPositions;
    if (cancel) {
      setNodes((current) => applyPositionTargets(current, move.initialMemberPositions));
      return;
    }
    if (!positionsEqual(move.initialMemberPositions, currentPositions)) {
      historyRef.current.past.push({
        type: "positions",
        nodeIds: move.movedNodeIds,
        before: move.initialMemberPositions,
        after: currentPositions,
      });
      historyRef.current.future = [];
    }
  }, [setNodes]);

  const clusterExecution = useClusterExecution({
    workflowSessionId,
    nodes,
    edges,
    clusters,
    disabledReason: invalidClusterEntries.length > 0 ? "Cluster metadata must be repaired before execution."
      : !authUser ? "Sign in to execute this cluster."
      : isAutoExecuting || executingNode ? "Another editor execution is active."
      : loading ? "Wait for the workflow to finish loading." : undefined,
  });

  const clusterProjection = useMemo(
    () => projectClusterGraph(nodes, edges, clusters, clusterViewState, (clusterId) => setExpanded(clusterId, true), {
      draggable: CLUSTER_COLLAPSE_ENABLED && !dragSource.nodeId,
      selectedClusterIds,
      getRunState: clusterExecution.getState,
      onExecute: clusterExecution.executeCluster,
      onCancel: clusterExecution.cancelRun,
    }),
    [clusterExecution.cancelRun, clusterExecution.executeCluster, clusterExecution.getState, clusterViewState, clusters, dragSource.nodeId, edges, nodes, selectedClusterIds, setExpanded],
  );
  const displayedNodes = CLUSTER_COLLAPSE_ENABLED ? clusterProjection.nodes : nodes;
  const displayedEdges = CLUSTER_COLLAPSE_ENABLED ? clusterProjection.edges : edges;
  const fitViewNodes = useMemo(
    () => CLUSTER_COLLAPSE_ENABLED ? getVisibleClusterNodes(clusterProjection) : nodes,
    [clusterProjection, nodes],
  );
  const fitViewOptions = useMemo(() => ({
    nodes: fitViewNodes,
    padding: 0.2,
    maxZoom: 1,
    minZoom: 0.4,
  }), [fitViewNodes]);

  const startClusterDrag = useCallback((event: React.PointerEvent<HTMLElement>, cluster: NodeCluster) => {
    if (dragSource.nodeId || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const clusterWasSelected = selectedClusterIds.has(cluster.id);
    const selectedIds = clusterWasSelected
      ? resolveCanonicalSelection(nodesRef.current, clusters, selectedClusterIds, collapsedRuntimeHostIds)
      : cluster.memberNodeIds;
    if (!clusterWasSelected) {
      const memberIds = new Set(cluster.memberNodeIds);
      setNodes((current) => current.map((node) => ({ ...node, selected: memberIds.has(node.id) })));
      setSelectedClusterIds(new Set([cluster.id]));
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const initialMemberPositions = capturePositions(nodesRef.current, selectedIds);
    clusterMoveRef.current = {
      workflowSessionId,
      clusterId: cluster.id,
      source: "expanded",
      pointerId: event.pointerId,
      clusterMemberNodeIds: [...new Set(cluster.memberNodeIds)],
      movedNodeIds: [...initialMemberPositions.keys()],
      initialMemberPositions,
      currentMemberPositions: initialMemberPositions,
      initialDisplayPosition: { x: 0, y: 0 },
      initialFlowPointer: rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    };
  }, [collapsedRuntimeHostIds, clusters, dragSource.nodeId, rf, selectedClusterIds, setNodes, workflowSessionId]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const move = clusterMoveRef.current;
      if (!move || move.source !== "expanded" || !move.initialFlowPointer) return;
      if (move.pointerId !== undefined && event.pointerId !== move.pointerId) return;
      if (move.workflowSessionId !== workflowSessionId) return finishClusterMove(true);
      const pointer = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const targets = translatePositions(move.initialMemberPositions, {
        x: pointer.x - move.initialFlowPointer!.x,
        y: pointer.y - move.initialFlowPointer!.y,
      });
      move.currentMemberPositions = targets;
      setNodes((current) => applyPositionTargets(current, targets));
    };
    const finish = (event: PointerEvent) => {
      const move = clusterMoveRef.current;
      if (move?.pointerId !== undefined && event.pointerId !== move.pointerId) return;
      finishClusterMove(false);
    };
    const cancelPointer = (event: PointerEvent) => {
      const move = clusterMoveRef.current;
      if (move?.pointerId !== undefined && event.pointerId !== move.pointerId) return;
      finishClusterMove(true);
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !clusterMoveRef.current) return;
      finishClusterMove(true);
      event.preventDefault();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("keydown", cancel);
    };
  }, [finishClusterMove, rf, setNodes, workflowSessionId]);

  const commitEdgeCandidate = useCallback((candidateEdges: Edge[]) => {
    if (isEditorExecutionLocked(workflowSessionId)) return;
    const currentInvalid = new Set(validateClusters(nodes, edges, clusters).violations.flatMap(
      ({ clusterId }) => clusterId ? [clusterId] : [],
    ));
    const candidateValidation = validateClusters(nodes, candidateEdges, clusters);
    const newlyInvalidIds = new Set(candidateValidation.violations.flatMap(
      ({ clusterId }) => clusterId && !currentInvalid.has(clusterId) ? [clusterId] : [],
    ));
    if (newlyInvalidIds.size === 0) {
      saveHistorySnapshot();
      setEdges(candidateEdges);
      return;
    }
    const affected = clusters.filter(({ id }) => newlyInvalidIds.has(id));
    const firstViolation = candidateValidation.violations.find(({ clusterId }) => clusterId && newlyInvalidIds.has(clusterId));
    toast({
      title: "Connection would invalidate a cluster",
      description: firstViolation?.message,
      variant: "destructive",
      action: (
        <ToastAction
          altText="Dissolve affected clusters and apply connection change"
          onClick={() => {
            saveHistorySnapshot();
            setClusters((current) => current.filter(({ id }) => !newlyInvalidIds.has(id)));
            setEdges(candidateEdges);
          }}
        >
          Dissolve cluster and apply
        </ToastAction>
      ),
    });
  }, [clusters, edges, nodes, saveHistorySnapshot, setEdges, toast, workflowSessionId]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const structural = changes.some(({ type }) => type === "add" || type === "remove" || type === "replace");
    const candidate = applyEdgeChanges(changes, edges);
    if (structural) commitEdgeCandidate(candidate);
    else setEdges(candidate);
  }, [commitEdgeCandidate, edges, setEdges]);
  commitEdgeCandidateRef.current = commitEdgeCandidate;

  // Inject execution state into node data for visual feedback
  useEffect(() => {
    if (nodes.length === 0) return;

    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isExecuting: executingNode === node.id,
        },
      })),
    );
  }, [executingNode]);

  // Scope manual node execution state to this editor session.
  useEffect(() => {
    if (nodes.length === 0) return;

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.data?.workflowSessionId === workflowSessionId) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            workflowSessionId,
          },
        };
      }),
    );
  }, [workflowSessionId, nodes.length, setNodes]);

  const cleanupNewsSubscription = useCallback(
    async (
      nodeId: string,
      nodeDef: any,
      fallbackSymbols: string[] = [],
      updateNodeState: boolean = true,
    ) => {
      if (!authUser) {
        return;
      }

      const storeData = executionStore.getNodeData(nodeId) as any;
      const storedSymbols = Array.isArray(storeData?.output?.symbols)
        ? storeData.output.symbols
        : [];
      const symbols = storedSymbols.length ? storedSymbols : fallbackSymbols;

      if (symbols.length) {
        const source = nodeDef?.subCategory || "alpaca";
        const endpoint = getNewsUnsubscribeEndpoint(source);
        try {
          await apiClient.post(
            endpoint,
            {
              user_id: authUser.id,
              symbols,
              node_id: nodeId,
            },
            session?.access_token,
          );
        } catch (error) {
          console.error("Failed to unsubscribe news for node", nodeId, error);
        }
      }

      const waitingOutput = createWaitingNewsOutput({
        nodeId,
        symbols: [],
      });
      executionStore.setNodeData(nodeId, { output: waitingOutput });

      if (updateNodeState) {
        setNodes((prev) =>
          prev.map((node) =>
            node.id === nodeId
              ? { ...node, data: { ...node.data, output: waitingOutput } }
              : node,
          ),
        );
      }
    },
    [authUser?.id, executionStore, setNodes],
  );

  const onCompactDragStart = useCallback((_: React.MouseEvent, node: Node) => {
    const clusterId = clusterProjection.displayNodeToCluster.get(node.id);
    const cluster = clusters.find((candidate) => candidate.id === clusterId);
    if (!cluster || dragSource.nodeId) return;
    const selectedIds = selectedClusterIds.has(cluster.id)
      ? resolveCanonicalSelection(nodesRef.current, clusters, selectedClusterIds, collapsedRuntimeHostIds)
      : cluster.memberNodeIds;
    const initialMemberPositions = capturePositions(nodesRef.current, selectedIds);
    clusterMoveRef.current = {
      workflowSessionId,
      clusterId: cluster.id,
      source: "compact",
      clusterMemberNodeIds: [...new Set(cluster.memberNodeIds)],
      movedNodeIds: [...initialMemberPositions.keys()],
      initialMemberPositions,
      currentMemberPositions: initialMemberPositions,
      initialDisplayPosition: { ...node.position },
    };
  }, [clusterProjection.displayNodeToCluster, collapsedRuntimeHostIds, clusters, dragSource.nodeId, selectedClusterIds, workflowSessionId]);

  const onCompactDragStop = useCallback(() => finishClusterMove(false), [finishClusterMove]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const canonicalNodeIds = new Set(nodes.map(({ id }) => id));
      for (const change of changes) {
        const clusterId = "id" in change ? clusterProjection.displayNodeToCluster.get(change.id) : undefined;
        if (!clusterId) continue;
        if (change.type === "select") {
          setSelectedClusterIds((current) => {
            const next = new Set(current);
            if (change.selected) next.add(clusterId); else next.delete(clusterId);
            return next;
          });
          const cluster = clusters.find(({ id }) => id === clusterId);
          if (cluster) {
            const memberIds = new Set(cluster.memberNodeIds);
            setNodes((current) => current.map((node) => memberIds.has(node.id)
              ? { ...node, selected: change.selected }
              : node));
          }
          continue;
        }
        if (change.type === "position" && change.position) {
          const move = clusterMoveRef.current;
          if (move?.source !== "compact" || move.clusterId !== clusterId || move.workflowSessionId !== workflowSessionId) continue;
          const delta = {
            x: change.position.x - move.initialDisplayPosition.x,
            y: change.position.y - move.initialDisplayPosition.y,
          };
          const targets = translatePositions(move.initialMemberPositions, delta);
          move.currentMemberPositions = targets;
          setNodes((current) => applyPositionTargets(current, targets));
        }
      }
      const canonicalChanges = changes.filter((change) =>
        canonicalNodeIds.has(change.id) &&
        (change.type === "select" || change.type === "position" || change.type === "dimensions" || change.type === "remove"),
      );
      const removedNodeIds = canonicalChanges
        .filter((change) => change.type === "remove")
        .map((change) => change.id);

      if (removedNodeIds.length) {
        removedNodeIds.forEach((id) => {
          const removedNode = nodes.find((node) => node.id === id);
          const nodeDef = removedNode?.data?.definition as any;
          if (isNewsStreamNode(nodeDef)) {
            const nodeData = removedNode.data as any;
            const candidateSymbols =
              executionStore.getNodeData(id)?.output?.symbols ??
              nodeData?.output?.symbols ??
              nodeData?.values?.symbols ??
              nodeData?.fieldState?.symbols;
            cleanupNewsSubscription(
              id,
              nodeDef,
              parseSymbolsValue(candidateSymbols),
              false,
            );
          }
        });
      }

      if (removedNodeIds.length > 0) {
        deleteNodeIds(removedNodeIds);
        const nonRemovalChanges = canonicalChanges.filter(({ type }) => type !== "remove");
        if (nonRemovalChanges.length > 0) applyNodeChanges(nonRemovalChanges);
        return;
      }
      if (canonicalChanges.length > 0) applyNodeChanges(canonicalChanges);
    },
    [applyNodeChanges, cleanupNewsSubscription, clusterProjection.displayNodeToCluster, clusters, deleteNodeIds, executionStore, nodes, setNodes, workflowSessionId],
  );

  const handleNodeOutputMessage = useCallback(
    (rawPayload: any, timestamp?: string) => {
      if (!rawPayload) {
        return;
      }

      const nodeId = rawPayload.nodeId || rawPayload.node_id;
      const newsData =
        rawPayload.data ||
        rawPayload.news ||
        rawPayload.payload?.data ||
        rawPayload.payload ||
        rawPayload;

      if (!nodeId || !newsData) {
        return;
      }

      const receivedAt =
        rawPayload.receivedAt || timestamp || new Date().toISOString();
      const symbols = parseSymbolsValue(
        rawPayload.symbols ?? newsData.symbols ?? [],
      );

      const currentData = executionStore.getNodeData(nodeId) as any;
      const nextOutput = appendNewsItem(currentData?.output, newsData, {
        nodeId,
        symbols,
        receivedAt,
      });

      executionStore.setNodeData(nodeId, { output: nextOutput });
      setNodes((prev) =>
        prev.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, output: nextOutput } }
            : node,
        ),
      );
    },
    [executionStore, setNodes],
  );

  useEffect(() => {
    // Keep the message handler stable without forcing WS reconnections
    messageHandlerRef.current = handleNodeOutputMessage;
  }, [handleNodeOutputMessage]);

  const removeEdge = useCallback(
    (edgeId: string) => commitEdgeCandidateRef.current(
      canonicalEdgesRef.current.filter((edge) => edge.id !== edgeId),
    ),
    [],
  );

  // Handle "+" click on Loop node to add a new downstream node
  const handleAddNode = useCallback(
    (loopNodeId: string) => {
      const position = rf.getNode(loopNodeId)?.position || { x: 0, y: 0 };
      const newNode: Node = {
        id: `node_${Date.now()}`,
        type: "default",
        position: { x: position.x + 200, y: position.y },
        data: { label: "New Node" },
      };
      setNodes((ns) => [...ns, newNode]);

      const edgeId = `edge_${loopNodeId}_${newNode.id}`;
      const newEdge: Edge = {
        id: edgeId,
        source: loopNodeId,
        sourceHandle: "done",
        target: newNode.id,
        type: "removable",
        data: { onRemoveEdge: () => removeEdge(edgeId) },
      };
      setEdges((es) => [...es, newEdge]);
    },
    [rf, setNodes, setEdges, removeEdge],
  );

  const handleRemoveLoop = useCallback(
    (loopNodeId: string) => {
      commitEdgeCandidate(edges.filter((edge) => edge.source !== loopNodeId && edge.target !== loopNodeId));
    },
    [commitEdgeCandidate, edges],
  );

  useEffect(() => {
    const wsUrl = resolveWebSocketUrl();
    if (!authUser?.id || !session?.access_token || !wsUrl) {
      return;
    }

    // Prevent duplicate connections on rapid re-renders
    if (wsRef.current) {
      return;
    }

    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let closedByEffect = false;

    const connect = () => {
      const socket = new WebSocket(`${wsUrl}?token=${session.access_token}`);
      wsRef.current = socket;

      socket.onopen = () => {
        console.log("🔌 News stream WebSocket connected");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (!message?.type) {
            return;
          }

          if (message.type === "node_output") {
            messageHandlerRef.current(message.payload, message.timestamp);
          } else if (
            message.type === "alpaca_news" ||
            message.type === "news_stream"
          ) {
            const payload = message.payload || {};
            messageHandlerRef.current(
              {
                nodeId: payload.nodeId || payload.node_id,
                data: payload.news ?? payload,
                symbols:
                  payload.news?.symbols ??
                  payload.symbols ??
                  payload.data?.symbols,
                receivedAt: message.timestamp,
              },
              message.timestamp,
            );
          }
        } catch (error) {
          console.error("Failed to parse WebSocket message", error);
        }
      };

      socket.onerror = (event) => {
        console.error("News stream WebSocket error", event);
        socket.close();
      };

      socket.onclose = () => {
        wsRef.current = null;
        if (!closedByEffect) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, "navigate/cleanup");
        } catch (e) {
          console.log(e, "ERROR");
        }
        wsRef.current = null;
      }
    };
  }, [authUser?.id, session?.access_token]);

  // Merge base node types with custom Loop node
  const nodeTypes = useMemo(() => {
    const wrappedBaseNodeTypes = Object.fromEntries(
      Object.entries(baseNodeTypes).map(([key, component]) => [
        key,
        (props: Record<string, unknown>) => {
          const WrappedComponent = component as ComponentType<
            Record<string, unknown>
          >;

          return <WrappedComponent {...props} workflowId={workflowId} />;
        },
      ]),
    );

    return {
      ...wrappedBaseNodeTypes,
      compactCluster: CompactClusterNode,
      Loop: (props: any) => (
        <LoopNode
          {...props}
          workflowId={workflowId}
          data={{ ...(props.data as LoopNodeData), onAddNode: handleAddNode }}
        />
      ),
    };
  }, [handleAddNode, workflowId]);

  const onConnect = useCallback(
    (params: Connection) => {
      const id = `edge_${crypto.randomUUID()}`;
      const newEdge: Edge = {
        id,
        ...params,
        type: "removable",
        data: { onRemoveEdge: () => removeEdge(id) },
      };
      commitEdgeCandidate(addEdge(newEdge, edges));
    },
    [commitEdgeCandidate, edges, removeEdge],
  );

  // Memoized WorkflowExecutor instance - only recreate when structure changes
  const workflowExecutor = useMemo(() => {
    if (nodes.length === 0) return null;

    return new WorkflowExecutor({
      nodes,
      edges,
      setNodes,
      setEdges,
      setExecutingNode,
      toast,
      executionStore,
    });
  }, [
    nodes.length,
    edges.length,
    setNodes,
    setEdges,
    setExecutingNode,
    toast,
    executionStore,
  ]);

  const ensureBacktestExecutionReady = useCallback(async (): Promise<boolean> => {
    if (!session || !authUser) {
      toast({
        title: "Login required",
        description: "Please log in to run a backtest",
        variant: "destructive",
      });
      return false;
    }

    if (!workflowId) {
      toast({
        title: "Error",
        description: "Workflow ID is missing. Please save the workflow first.",
        variant: "destructive",
      });
      return false;
    }
    if (invalidClusterEntries.length > 0) {
      toast({
        title: "Cluster metadata needs attention",
        description: "Remove or repair the preserved invalid cluster entries before saving or running this workflow.",
        variant: "destructive",
      });
      return false;
    }

    const requiresSave =
      !hasPersistedRef.current || hasUnsavedChanges(nodes, edges, workflowName, clusters);

    if (!requiresSave) {
      return true;
    }

    const saveResult = await saveWorkflow(workflowId, workflowName, nodes, edges, {
      isNew: !hasPersistedRef.current,
      clusters,
    });

    if (!saveResult.success) {
      toast({
        title: "Error",
        description: "Could not save workflow — please try again",
        variant: "destructive",
      });
      return false;
    }

    if (!hasPersistedRef.current) {
      hasPersistedRef.current = true;
      const savedWorkflowId = saveResult.newId;
      if (!savedWorkflowId) return false;
      setWorkflowId(savedWorkflowId);
      const workflowPath = `/dashboard/workflow/${savedWorkflowId}`;
      const newUrl = projectId ? `${workflowPath}?project=${projectId}` : workflowPath;
      navigate(newUrl, { replace: true });
    }

    return true;
  }, [
    session,
    authUser,
    workflowId,
    hasUnsavedChanges,
    nodes,
    edges,
    workflowName,
    clusters,
    saveWorkflow,
    toast,
    projectId,
    navigate,
    invalidClusterEntries.length,
  ]);

  const hasBacktestInitNode = useCallback(
    (candidateNodes: Node[]) =>
      candidateNodes.some(
        (candidate) => (candidate.data?.definition as any)?.name === "BacktestInit",
      ),
    [],
  );

  // Execute all nodes with the queue-based WorkflowExecutor
  const executeAllNodes = useCallback(async () => {
    if (clusterExecution.isExecutionActive || isEditorExecutionLocked(workflowSessionId)) {
      toast({ title: "Execution already active", description: "Stop the cluster run before executing the whole workflow." });
      return;
    }
    if (!workflowExecutor) {
      toast({
        title: "Error",
        description: "No workflow to execute",
        variant: "destructive",
      });
      return;
    }

    if (hasBacktestInitNode(nodes)) {
      const canExecute = await ensureBacktestExecutionReady();
      if (!canExecute) return;
    }

    setIsAutoExecuting(true);
    await workflowExecutor.executeAllNodes();
    setIsAutoExecuting(false);
  }, [clusterExecution.isExecutionActive, workflowExecutor, toast, hasBacktestInitNode, nodes, ensureBacktestExecutionReady, workflowSessionId]);

  const handleStopExecution = useCallback(() => {
    workflowExecutor?.stop();
  }, [workflowExecutor]);

  // Handle node double click to execute
  // Double click to execute one node only (optional: show highlight/animation)
  const onNodeDoubleClick = useCallback(
    async (event: React.MouseEvent, node: Node) => {
      event.preventDefault();

      const clusterId = clusterProjection.displayNodeToCluster.get(node.id);
      if (clusterId) {
        setExpanded(clusterId, true);
        return;
      }

      if (!workflowExecutor) {
        toast({
          title: "Error",
          description: "No workflow to execute",
          variant: "destructive",
        });
        return;
      }
      if (clusterExecution.isExecutionActive || isEditorExecutionLocked(workflowSessionId)) {
        toast({ title: "Execution already active", description: "Stop the cluster run before executing a node." });
        return;
      }

      if ((node.data?.definition as any)?.name === "BacktestInit") {
        const canExecute = await ensureBacktestExecutionReady();
        if (!canExecute) return;
      }

      await workflowExecutor.executeNode(node.id, new Set());
    },
    [clusterExecution.isExecutionActive, clusterProjection.displayNodeToCluster, workflowExecutor, ensureBacktestExecutionReady, setExpanded, toast, workflowSessionId],
  );

  // Save workflow via persistence hook
  const handleSaveWorkflow = async (skipConfirmation: boolean = false) => {
    finishClusterMove(false);
    if (invalidClusterEntries.length > 0) {
      toast({
        title: "Save blocked",
        description: "Invalid cluster metadata is preserved. Remove it explicitly before saving.",
        variant: "destructive",
      });
      return;
    }
    if (!authUser) {
      toast({
        title: "Error",
        description: "Please log in to save workflows",
        variant: "destructive",
      });
      return;
    }

    // CRITICAL: Prevent saving while loading to avoid race condition
    if (loading) {
      toast({
        title: "Please wait",
        description: "Workflow is still loading...",
        variant: "destructive",
      });
      return;
    }

    // For existing workflows, check for significant node reduction (confirmation dialog)
    if (workflowId && hasPersistedRef.current && !skipConfirmation) {
      const { shouldWarn, currentCount } = await checkNodeReduction(
        workflowId,
        nodes.length,
      );
      if (shouldWarn) {
        setPendingSaveData({ currentCount, newCount: nodes.length });
        setShowSaveConfirmDialog(true);
        return; // Wait for user confirmation
      }
    }

    const isFirstSave = !hasPersistedRef.current;
    const result = await saveWorkflow(workflowId, workflowName, nodes, edges, {
      isNew: isFirstSave,
      clusters,
    });

    if (result.success && isFirstSave && result.newId) {
      hasPersistedRef.current = true;
      setWorkflowId(result.newId);
      const workflowPath = `/dashboard/workflow/${result.newId}`;
      const newUrl = projectId
        ? `${workflowPath}?project=${projectId}`
        : workflowPath;
      navigate(newUrl, { replace: true });
    }
  };

  const handleActivate = async () => {
    if (!authUser || !workflowId) return;

    const result = await toggleActivation(workflowId, isActive);
    if (result !== null) {
      setIsActive(result);

      // Cleanup news subscriptions on deactivation
      if (!result) {
        nodes
          .filter((node) => isNewsStreamNode(node.data?.definition as any))
          .forEach((node) => {
            const nodeData = node.data as any;
            const nodeDef = nodeData?.definition;
            const candidateSymbols =
              executionStore.getNodeData(node.id)?.output?.symbols ??
              nodeData?.output?.symbols ??
              nodeData?.values?.symbols ??
              nodeData?.fieldState?.symbols;
            cleanupNewsSubscription(
              node.id,
              nodeDef,
              parseSymbolsValue(candidateSymbols),
            );
          });
      }
    }
  };

  useEffect(() => {
    if (!workflowId) return;

    const channel = supabase
      .channel(`workflow-active-${workflowId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "workflows",
          filter: `id=eq.${workflowId}`,
        },
        (payload) => {
          if (
            typeof payload.new !== "object" ||
            payload.new === null ||
            !("is_active" in payload.new)
          ) {
            return;
          }

          const next = Boolean(payload.new.is_active);
          setIsActive((prev) => {
            if (prev && !next) {
              toast({
                title: "Workflow completed",
                description: "Backtest finished — workflow auto-deactivated.",
              });
            }
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [workflowId, toast]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onMouseMove = useCallback((event: React.MouseEvent) => {
    mousePosRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  // Function to create a new node
  const createNode = useCallback(
    (nodeType: string, position: { x: number; y: number }) => {
      const nodeDefinition = nodeManifest[nodeType];

      const existingIds = new Set(nodes.map((node) => node.id));
      const getCollisionSafeNodeId = (baseId: string): string => {
        let nodeId = baseId;
        let suffix = 1;

        while (existingIds.has(nodeId)) {
          nodeId = `${baseId}${suffix}`;
          suffix += 1;
        }

        existingIds.add(nodeId);
        return nodeId;
      };

      const nodeId = getCollisionSafeNodeId(nodeType);
      const newNode: Node = {
        id: nodeId,
        type: nodeType,
        position,
        data: {
          label: nodeDefinition?.name || `${nodeType} node`,
          definition: nodeDefinition,
          workflowSessionId,
        },
      };

      const nodesToAdd = [newNode];
      const shouldAddOnBar =
        nodeType === BACKTEST_INIT_NODE_TYPE &&
        !nodes.some((node) => node.type === ON_BAR_NODE_TYPE) &&
        Boolean(nodeManifest[ON_BAR_NODE_TYPE]);

      if (shouldAddOnBar) {
        const onBarNodeId = getCollisionSafeNodeId(ON_BAR_NODE_TYPE);
        const onBarDefinition = nodeManifest[ON_BAR_NODE_TYPE];
        const onBarNode: Node = {
          id: onBarNodeId,
          type: ON_BAR_NODE_TYPE,
          position: {
            x: position.x + ON_BAR_COMPANION_OFFSET_X,
            y: position.y,
          },
          data: {
            label: onBarDefinition.name || "OnBar node",
            definition: onBarDefinition,
            workflowSessionId,
          },
        };

        nodesToAdd.push(onBarNode);

        const edgeId = `edge_${Date.now()}`;
        const newEdge: Edge = {
          id: edgeId,
          source: nodeId,
          target: onBarNodeId,
          sourceHandle: "output",
          targetHandle: "input",
          type: "removable",
          data: { onRemoveEdge: () => removeEdge(edgeId) },
        };

        setEdges((eds) => addEdge(newEdge, eds));
      }

      setNodes((nds) => nds.concat(nodesToAdd));
    },
    [
      setNodes,
      setEdges,
      nodes,
      workflowSessionId,
      removeEdge,
    ],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      // Only create a node when dropping a valid palette item
      if (!type) return;
      if (!(type in nodeManifest)) return;

      // Get the ReactFlow wrapper element to calculate relative position
      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = {
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      };

      createNode(type, position);
    },
    [createNode],
  );

  // Handle node click from palette
  const handleNodeClick = useCallback(
    (nodeType: string) => {
      const workflowCanvas = document.querySelector(".workflow-canvas");

      const position = workflowCanvas
        ? (() => {
            const rect = workflowCanvas.getBoundingClientRect();

            return rf.screenToFlowPosition({
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            });
          })()
        : { x: 250, y: 250 };

      createNode(nodeType, position);

      // Optionally hide palette after adding node
      setIsPaletteVisible(false);
    },
    [createNode, rf],
  );

  // Restore workflow from a version snapshot
  const handleRestoreFromVersion = useCallback(
    (restoredNodes: Node[], restoredEdges: Edge[], restoredClusters?: NodeCluster[]) => {
      // Restore nodes with definitions from manifest
      const nodesWithDefinitions = restoredNodes.map((node) => {
        const nodeName = (node as any).name || node.type || node.id;
        const definition =
          node.data?.definition ||
          nodeManifest[nodeName as keyof typeof nodeManifest];

        const rawValues = (node as any).values || node.data?.values || {};
        const { merged } = reconcileNodeValues(
          definition,
          rawValues,
          node.data?.fieldState || {},
        );

        return {
          ...node,
          type: nodeName,
          data: {
            ...node.data,
            definition,
            values: merged,
            fieldState: merged,
            displayName: node.data?.displayName || node.id,
          },
        };
      });

      // Restore edges
      const edgesWithHandlers = restoredEdges.map((edge) => ({
        ...edge,
        type: edge.type || "removable",
        data: {
          ...edge.data,
          onRemoveEdge: () => removeEdge(edge.id),
        },
      }));

      saveHistorySnapshot();
      setNodes(stampNodesWithWorkflowSession(repairProjectedClusterNodes(nodesWithDefinitions)));
      setEdges(edgesWithHandlers);
      if (restoredClusters) {
        const validClusters: NodeCluster[] = [];
        const invalidEntries: Array<{ index: number; value: unknown }> = [];
        restoredClusters.forEach((cluster, index) => {
          const result = validateClusters(nodesWithDefinitions, edgesWithHandlers, [...validClusters, cluster]);
          if (result.valid) validClusters.push(cluster);
          else invalidEntries.push({ index, value: cluster });
        });
        setClusters(validClusters);
        if (invalidEntries.length > 0) {
          setInvalidClusterEntries((current) => [...current, ...invalidEntries]);
        }
      }

      toast({
        title: "Version Restored",
        description: `Restored ${nodesWithDefinitions.length} nodes. Remember to save your changes.`,
      });
    },
    [removeEdge, saveHistorySnapshot, setEdges, setNodes, stampNodesWithWorkflowSession, toast],
  );

  // Check for user authentication and load latest workflow
  const [hasLoadedWorkflowId, setHasLoadedWorkflowId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (authLoading) return; // Wait for auth to finish loading

    if (!authUser) {
      // Redirect to login if no user found
      navigate("/login");
      return;
    }

    // Prevent reloading if we've already loaded this workflow
    if (hasLoadedWorkflowId && workflowId === hasLoadedWorkflowId) {
      //console.log("🚫 Skipping reload - workflow already loaded");
      return;
    }

    const doLoad = async () => {
      if (isNewWorkflow) {
        // New workflow — generate smart name, seed from selected template
        setLoading(true);
        try {
          const name = await generateNewWorkflowName(!!projectId);
          setWorkflowName(name);
        } catch {
          setWorkflowName(projectId ? "New Project Workflow" : "My workflow 1");
        }
        const templateParam = searchParams.get("template");
        let template = getTemplate(templateParam);
        if (!isValidTemplate(template)) {
          toast({
            title: "Template unavailable",
            description: `Template "${templateParam}" references missing nodes. Loaded blank canvas instead.`,
            variant: "destructive",
          });
          template = getTemplate("custom");
        }
        setNodes(stampNodesWithWorkflowSession(repairProjectedClusterNodes(template.nodes)));
        setEdges(template.edges);
        setIsActive(false);
        setLoading(false);
        setHasLoadedWorkflowId("new");
      } else if (workflowId && workflowId !== hasLoadedWorkflowId) {
        // Load existing workflow via persistence hook
        setLoading(true);
        const loaded = await persistLoadWorkflow(workflowId, removeEdge);
        if (loaded) {
          setWorkflowName(loaded.name);
          setIsActive(loaded.isActive);
          setNodes(stampNodesWithWorkflowSession(repairProjectedClusterNodes(loaded.nodes)));
          setEdges(loaded.edges);
          setClusters(loaded.clusters);
          setInvalidClusterEntries(loaded.invalidClusterEntries);
          setHasLoadedWorkflowId(workflowId);
        } else {
          navigate("/dashboard/workflows");
        }
        setLoading(false);
      }
    };

    doLoad();
  }, [
    authUser?.id,
    authLoading,
    navigate,
    isNewWorkflow,
    workflowId,
    hasLoadedWorkflowId,
    stampNodesWithWorkflowSession,
  ]); // Added hasLoadedWorkflowId to prevent unnecessary reloads

  // Auto-hide palette when clicking outside or on editor
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isPaletteVisible) return;

      const target = event.target as Element;
      const palette = document.querySelector(".node-palette-container");
      const toggleButton = document.querySelector(".palette-toggle-button");

      if (
        palette &&
        toggleButton &&
        !palette.contains(target) &&
        !toggleButton.contains(target)
      ) {
        setIsPaletteVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isPaletteVisible]);

  // Handle ReactFlow clicks specifically
  const onPaneClick = useCallback(() => {
    setCanvasMenu(null);
    if (isPaletteVisible) {
      setIsPaletteVisible(false);
    }
  }, [isPaletteVisible]);

  const openCanvasMenu = useCallback((event: {
    clientX: number;
    clientY: number;
    preventDefault: () => void;
    stopPropagation: () => void;
  }, nodeIds: string[], kind: CanvasMenuState["kind"]) => {
    event.preventDefault();
    event.stopPropagation();
    contextMenuFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuWidth = 260;
    const menuHeight = kind === "pane" ? 180 : 230;
    setCanvasMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
      nodeIds,
      kind,
    });
  }, []);

  const closeCanvasMenu = useCallback(() => {
    setCanvasMenu(null);
    requestAnimationFrame(() => contextMenuFocusRef.current?.focus({ preventScroll: true }));
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    const clusterId = clusterProjection.displayNodeToCluster.get(node.id);
    const clusterMembers = clusterId
      ? clusters.find(({ id }) => id === clusterId)?.memberNodeIds ?? []
      : undefined;
    const selectedCanonicalIds = resolveCanonicalSelection(nodes, clusters, selectedClusterIds, collapsedRuntimeHostIds);
    const nodeIds = node.selected
      ? [...new Set(selectedCanonicalIds)]
      : (clusterMembers ?? [node.id]);
    if (!node.selected) {
      const targets = new Set(nodeIds);
      setNodes((current) => current.map((item) => ({ ...item, selected: targets.has(item.id) })));
      setSelectedClusterIds(clusterId ? new Set([clusterId]) : new Set());
    }
    openCanvasMenu(event, nodeIds, "selection");
  }, [clusterProjection.displayNodeToCluster, collapsedRuntimeHostIds, clusters, nodes, openCanvasMenu, selectedClusterIds, setNodes]);

  const onSelectionContextMenu = useCallback((event: React.MouseEvent, selectedNodes: Node[]) => {
    const canonicalIds = selectedNodes.flatMap(({ id }) => {
      const clusterId = clusterProjection.displayNodeToCluster.get(id);
      return clusterId ? clusters.find((cluster) => cluster.id === clusterId)?.memberNodeIds ?? [] : [id];
    });
    openCanvasMenu(event, [...new Set(canonicalIds)], "selection");
  }, [clusterProjection.displayNodeToCluster, clusters, openCanvasMenu]);

  useEffect(() => {
    const move = clusterMoveRef.current;
    if (!move) return;
    const cluster = clusters.find(({ id }) => id === move.clusterId);
    const currentMemberIds = cluster ? [...new Set(cluster.memberNodeIds)] : [];
    const currentNodeIds = new Set(nodes.map(({ id }) => id));
    if (!cluster
      || currentMemberIds.length !== move.clusterMemberNodeIds.length
      || currentMemberIds.some((id) => !move.clusterMemberNodeIds.includes(id))
      || move.movedNodeIds.some((id) => !currentNodeIds.has(id))) {
      finishClusterMove(true);
    }
  }, [clusters, finishClusterMove, nodes]);

  const menuValidation = useMemo(() => {
    if (!canvasMenu || canvasMenu.kind !== "selection") return null;
    const candidate: NodeCluster = { id: crypto.randomUUID(), title: nextClusterTitle, memberNodeIds: canvasMenu.nodeIds };
    return validateClusterSelection(canvasMenu.nodeIds, nodes, edges, clusters, candidate);
  }, [canvasMenu, clusters, edges, nextClusterTitle, nodes]);

  useEffect(() => {
    if (!canvasMenu) return;
    const close = () => closeCanvasMenu();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); };
  }, [canvasMenu, closeCanvasMenu]);

  // Handle delete key to remove selected nodes
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.isContentEditable;

      if (isEditable) {
        return;
      }

      const isModKey = event.metaKey || event.ctrlKey;

      if (isModKey && event.key.toLowerCase() === "z") {
        const direction = event.shiftKey ? "redo" : "undo";
        const source = direction === "undo" ? historyRef.current.past : historyRef.current.future;
        const destination = direction === "undo" ? historyRef.current.future : historyRef.current.past;
        const entry = source.pop();
        if (!entry) {
          return;
        }
        if (entry.type === "positions") {
          destination.push(entry);
          setNodes((current) => applyPositionTargets(current, direction === "undo" ? entry.before : entry.after));
        } else {
          destination.push({ type: "document", document: { nodes: cloneNodes(nodes), edges: cloneEdges(edges), clusters: clusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })) } });
          restoreDocument(entry.document);
        }
        event.preventDefault();
        toast({ description: direction === "undo" ? "Undid last change" : "Redid last change" });
        return;
      }

      if (isModKey && event.key.toLowerCase() === "g") {
        const selectedIds = resolveCanonicalSelection(nodes, clusters, selectedClusterIds, collapsedRuntimeHostIds);
        if (event.shiftKey) dissolveClustersForNodes(selectedIds);
        else createClusterFromSelection(selectedIds);
        event.preventDefault();
        return;
      }

      if (isModKey && event.key.toLowerCase() === "c") {
        const selectedIds = new Set(resolveCanonicalSelection(nodes, clusters, selectedClusterIds, collapsedRuntimeHostIds));
        const selectedNodes = nodes.filter((node) => selectedIds.has(node.id));
        if (selectedNodes.length === 0) {
          return;
        }

        const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
        const selectedEdges = edges.filter(
          (edge) =>
            selectedNodeIds.has(edge.source) &&
            selectedNodeIds.has(edge.target),
        );

        const nodesCopy = selectedNodes.map((node) => ({
          ...node,
          data: { ...node.data },
        }));

        const edgesCopy = selectedEdges.map((edge) => ({
          ...edge,
          data: { ...edge.data },
        }));

        clipboardRef.current = {
          nodes: nodesCopy,
          edges: edgesCopy,
          clusters: clusters.filter((cluster) => cluster.memberNodeIds.every((id) => selectedNodeIds.has(id))),
        };
        toast({ description: "Selection copied" });
        return;
      }

      // Cut (Ctrl+X) - Copy to clipboard then delete
      if (isModKey && event.key.toLowerCase() === "x") {
        const selectedIds = new Set(resolveCanonicalSelection(nodes, clusters, selectedClusterIds, collapsedRuntimeHostIds));
        const selectedNodes = nodes.filter((node) => selectedIds.has(node.id));
        if (selectedNodes.length === 0) {
          return;
        }

        // 1. Copy selected nodes to clipboard (same as Ctrl+C)
        const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
        const selectedEdges = edges.filter(
          (edge) =>
            selectedNodeIds.has(edge.source) &&
            selectedNodeIds.has(edge.target),
        );

        const nodesCopy = selectedNodes.map((node) => ({
          ...node,
          data: { ...node.data },
        }));

        const edgesCopy = selectedEdges.map((edge) => ({
          ...edge,
          data: { ...edge.data },
        }));

        clipboardRef.current = {
          nodes: nodesCopy,
          edges: edgesCopy,
          clusters: clusters.filter((cluster) => cluster.memberNodeIds.every((id) => selectedNodeIds.has(id))),
        };

        // 2. Delete selected nodes from canvas (same as Delete key)
        const selectedNodeIdArray = Array.from(selectedNodeIds);

        deleteNodeIds(selectedNodeIdArray);

        toast({ description: "Selection cut" });
        return;
      }

      if (isModKey && event.key.toLowerCase() === "v") {
        if (!clipboardRef.current) {
          return;
        }

        const { nodes: copiedNodes, edges: copiedEdges, clusters: copiedClusters } = clipboardRef.current;
        if (copiedNodes.length === 0) {
          return;
        }

        saveHistorySnapshot();

        const flowPosition = rf.screenToFlowPosition({
          x: mousePosRef.current.x,
          y: mousePosRef.current.y,
        });

        const minX = Math.min(
          ...copiedNodes.map((node) => node.position?.x ?? 0),
        );
        const minY = Math.min(
          ...copiedNodes.map((node) => node.position?.y ?? 0),
        );
        const nodeIdMap: Record<string, string> = {};
        const timestamp = Date.now();
        const existingNodeIds = new Set(nodes.map((node) => node.id));
        const existingEdgeIds = new Set(edges.map((edge) => edge.id));
        const existingDisplayNames = new Set(
          nodes.map((n) => n.data?.displayName || n.id),
        );

        const newNodes = copiedNodes.map((node) => {
          const nodeType = node.type || "default";

          const existingOfType = nodes.filter(
            (n) => n.type === nodeType,
          ).length;
          const alreadyAddedOfType = Object.values(nodeIdMap).filter(
            (id) => id === nodeType || id.startsWith(nodeType),
          ).length;

          let count = existingOfType + alreadyAddedOfType;
          let newId = count === 0 ? nodeType : `${nodeType}${count}`;

          while (existingNodeIds.has(newId)) {
            count += 1;
            newId = `${nodeType}${count}`;
          }

          existingNodeIds.add(newId);
          nodeIdMap[node.id] = newId;

          // Generate unique display name
          const originalDisplayName = (node.data?.displayName ||
            newId) as string;
          let uniqueDisplayName = originalDisplayName;

          if (existingDisplayNames.has(uniqueDisplayName)) {
            const baseMatch = originalDisplayName.match(/^(.+?)\s*\d*$/);
            const baseName = baseMatch
              ? baseMatch[1].trim()
              : originalDisplayName;

            let displayCount = 1;
            uniqueDisplayName = `${baseName} ${displayCount}`;

            while (existingDisplayNames.has(uniqueDisplayName)) {
              displayCount++;
              uniqueDisplayName = `${baseName} ${displayCount}`;
            }
          }

          existingDisplayNames.add(uniqueDisplayName);

          return {
            ...node,
            id: newId,
            position: {
              x: flowPosition.x + ((node.position?.x ?? 0) - minX),
              y: flowPosition.y + ((node.position?.y ?? 0) - minY),
            },
            selected: true,
            data: {
              ...node.data,
              displayName: uniqueDisplayName,
              isExecuting: false,
            },
          };
        });

        const newEdges = copiedEdges
          .map((edge, index) => {
            const newSource = nodeIdMap[edge.source];
            const newTarget = nodeIdMap[edge.target];

            if (!newSource || !newTarget) {
              return null;
            }

            let newId = `edge_${timestamp}_${index}`;
            while (existingEdgeIds.has(newId)) {
              newId = `edge_${timestamp}_${index}_${Math.random()
                .toString(36)
                .slice(2, 6)}`;
            }
            existingEdgeIds.add(newId);

            return {
              ...edge,
              id: newId,
              source: newSource,
              target: newTarget,
              selected: true,
              data: {
                ...edge.data,
                onRemoveEdge: () => removeEdge(newId),
              },
            } as Edge;
          })
          .filter((edge): edge is Edge => Boolean(edge));

        setNodes((nds) => {
          const deselected = nds.map((node) => ({ ...node, selected: false }));
          return [...deselected, ...newNodes];
        });

        setEdges((eds) => [...eds, ...newEdges]);
        const existingTitles = new Set(clusters.map(({ title }) => title.toLocaleLowerCase()));
        const pastedClusters = copiedClusters.map((cluster) => {
          let title = cluster.title;
          let suffix = 2;
          while (existingTitles.has(title.toLocaleLowerCase())) title = `${cluster.title} ${suffix++}`;
          existingTitles.add(title.toLocaleLowerCase());
          return { ...cluster, id: crypto.randomUUID(), title, memberNodeIds: cluster.memberNodeIds.map((id) => nodeIdMap[id]) };
        });
        setClusters((current) => [...current, ...pastedClusters]);

        toast({ description: "Selection pasted" });
        return;
      }

      if (event.key === "Delete") {
        //console.log("Delete key pressed - removing selected nodes");

        // Get IDs of nodes being deleted
        const selectedNodeIds = resolveCanonicalSelection(
          nodes,
          clusters,
          selectedClusterIds,
          collapsedRuntimeHostIds,
        );

        if (selectedNodeIds.length === 0) {
          return;
        }

        deleteNodeIds(selectedNodeIds);
      }
      if (event.key === "Backspace") {
        //console.log("Backspace key pressed but should NOT delete nodes");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    setNodes,
    setEdges,
    nodes,
    edges,
    toast,
    removeEdge,
    cloneEdges,
    cloneNodes,
    collapsedRuntimeHostIds,
    clusters,
    selectedClusterIds,
    stampNodesWithWorkflowSession,
    saveHistorySnapshot,
    createClusterFromSelection,
    deleteNodeIds,
    dissolveClustersForNodes,
    restoreDocument,
  ]);

  // Add visibility change handler to prevent state loss on tab switching
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Auto-save when tab becomes hidden to preserve unsaved changes
        if (nodes.length > 0 && authUser && hasPersistedRef.current) {
          console.log("🔄 Tab hidden - preserving workflow state");
          handleSaveWorkflow(); // Autosave
        }
      }
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Warn user if they have unsaved changes in a new workflow
      if (isNewWorkflow && nodes.length > 1) {
        // More than just initial node
        e.preventDefault();
        e.returnValue = "";
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [nodes, authUser?.id, isNewWorkflow, handleSaveWorkflow]);

  return (
    <div className="flex flex-col h-[calc(100vh)] w-full">
      {/* Workflow Header - Fixed at top */}
      <div className="flex items-center justify-between px-6 pl-16 py-2 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex flex-col gap-1">
            <Input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="text-xl font-bold bg-transparent border-none p-0 h-auto focus-visible:ring-0 hover:bg-muted/30 rounded px-2 py-1 transition-colors"
              placeholder="Workflow name"
            />
          </div>

          {/* Editor/Executions/Restore Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "editor" | "executions")}
          >
            <TabsList className="h-8 bg-muted">
              <TabsTrigger value="editor" className="text-xs px-3 h-7">
                Editor
              </TabsTrigger>
              <TabsTrigger value="executions" className="text-xs px-3 h-7">
                Executions
                {executions.length > 0 && (
                  <span className="ml-1.5 bg-muted px-1.5 py-0.5 rounded text-[10px]">
                    {executions.length}
                  </span>
                )}
              </TabsTrigger>
              <WorkflowVersionHistory
                workflowId={workflowId}
                onRestore={handleRestoreFromVersion}
                disabled={loading}
              />
            </TabsList>
          </Tabs>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".json"
            aria-label="Import workflow JSON file"
            title="Import workflow JSON file"
            className="hidden"
            ref={(el) => {
              (window as any).__workflowFileInput = el;
            }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const imported = await importWorkflow(file);
                setWorkflowName(imported.name);
                const importedNodes = imported.nodes.map((n) => ({
                  id: n.id,
                  type: n.type,
                  position: n.position,
                  data: {
                    values: n.values,
                    label: n.displayName,
                    ...(n.pinnedOutput != null
                      ? {
                          pinnedOutput: n.pinnedOutput,
                          output: n.pinnedOutput,
                        }
                      : {}),
                  },
                })) as Node[];
                const importedEdges = imported.edges.map((ed) => ({
                  id: ed.id,
                  source: ed.source,
                  target: ed.target,
                  sourceHandle: ed.sourceHandle,
                  targetHandle: ed.targetHandle,
                })) as Edge[];
                setInvalidClusterEntries(imported.invalidClusterEntries);
                handleRestoreFromVersion(importedNodes, importedEdges, imported.clusters);
                toast({
                  title: "Workflow imported",
                  description: imported.clusterDiagnostics.length > 0
                    ? `Loaded "${imported.name}" with ${imported.nodes.length} nodes. ${imported.clusterDiagnostics.join(" ")}`
                    : `Loaded "${imported.name}" with ${imported.nodes.length} nodes.`,
                });
              } catch (err: any) {
                toast({
                  title: "Import failed",
                  description: err.message,
                  variant: "destructive",
                });
              }
              e.target.value = "";
            }}
          />
          <Button
            onClick={() => (window as any).__workflowFileInput?.click()}
            variant="outline"
            size="icon"
            className="h-10 w-10"
            title="Upload workflow from JSON"
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => exportWorkflow(workflowName, nodes, edges, isActive, clusters)}
            variant="outline"
            size="icon"
            className="h-10 w-10"
            title="Download workflow as JSON"
          >
            <Download className="h-4 w-4" />
          </Button>

          <Button
            onClick={() => handleSaveWorkflow()}
            disabled={loading || persistSaving}
            variant="outline"
            className="h-10 px-4 font-medium"
          >
            <Save className="h-4 w-4 mr-2" />
            {persistSaving ? "Saving..." : "Save"}
          </Button>

          <ActivateControl
            isActive={isActive}
            loading={loading}
            onToggle={handleActivate}
          />
        </div>
      </div>

      {invalidClusterEntries.length > 0 && (
        <div role="alert" className="flex items-center justify-between border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
          <span>
            {invalidClusterEntries.length} invalid cluster metadata {invalidClusterEntries.length === 1 ? "entry was" : "entries were"} preserved and must be repaired or removed before saving.
          </span>
          <Button variant="destructive" size="sm" onClick={() => setInvalidClusterEntries([])}>
            Remove invalid metadata
          </Button>
        </div>
      )}

      {/* Main Content Area */}
      {activeTab === "editor" ? (
        // Editor View
        <div className="flex flex-1 overflow-hidden">
          {/* ReactFlow Canvas */}
          <div className="relative flex-1 bg-trading-grid">
            <ConnectionDragContext.Provider value={dragSource}>
              <ReactFlow
                nodes={displayedNodes}
                edges={displayedEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onMouseMove={onMouseMove}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodeDragStart={onCompactDragStart}
                onNodeDragStop={onCompactDragStop}
                onPaneClick={onPaneClick}
                onNodeContextMenu={onNodeContextMenu}
                onSelectionContextMenu={onSelectionContextMenu}
                onPaneContextMenu={(event) => openCanvasMenu(event, [], "pane")}
                onMove={(_, nextViewport) => { setViewport(nextViewport); setCanvasMenu(null); }}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                connectionLineComponent={EdgeManager.PlugConnectionLine}
                connectionLineType={ConnectionLineType.Bezier}
                fitView
                fitViewOptions={fitViewOptions}
                minZoom={0.1}
                maxZoom={4}
                colorMode={resolvedTheme}
                className="workflow-canvas"
                style={{ backgroundColor: "hsl(var(--trading-grid))" }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={16}
                  size={0.8}
                  color="hsl(var(--muted-foreground) / 0.60)"
                />
                <MiniMap
                  className="!bg-card !border-border"
                  bgColor="hsl(var(--card))"
                  nodeColor={(node) => clusterProjection.hiddenRuntimeHostIds.has(node.id)
                    ? "transparent"
                    : "hsl(var(--node-neon-color, var(--primary)))"}
                  nodeStrokeColor={(node) => clusterProjection.hiddenRuntimeHostIds.has(node.id)
                    ? "transparent"
                    : "hsl(var(--border))"}
                  nodeClassName={(node) => clusterProjection.hiddenRuntimeHostIds.has(node.id) ? "hidden" : ""}
                  maskColor="hsl(var(--background) / 0.6)"
                />
                <Controls
                  className="!bg-card !border-border [&>button]:!bg-transparent [&>button]:!border-border hover:[&>button]:!bg-muted"
                  onFitView={() => { void rf.fitView(fitViewOptions); }}
                />
              </ReactFlow>
            </ConnectionDragContext.Provider>
            <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden" aria-label="Workflow clusters">
              {clusters.map((cluster) => {
                if (CLUSTER_COLLAPSE_ENABLED && !isClusterExpanded(clusterViewState, cluster.id)) return null;
                const members = nodes.filter((node) => cluster.memberNodeIds.includes(node.id));
                if (members.length === 0) return null;
                const padding = 24;
                const header = 42;
                const footer = 52;
                const minX = Math.min(...members.map(({ position }) => position.x)) - padding;
                const minY = Math.min(...members.map(({ position }) => position.y)) - padding - header;
                const maxX = Math.max(...members.map((node) => node.position.x + (node.measured?.width ?? node.width ?? 280))) + padding;
                const maxY = Math.max(...members.map((node) => node.position.y + (node.measured?.height ?? node.height ?? 180))) + padding + footer;
                return (
                  <section
                    key={cluster.id}
                    id={`cluster-frame-${cluster.id}`}
                    className="cluster-frame absolute rounded-xl border-2"
                    style={{
                      transform: `translate(${minX * viewport.zoom + viewport.x}px, ${minY * viewport.zoom + viewport.y}px)`,
                      width: (maxX - minX) * viewport.zoom,
                      height: (maxY - minY) * viewport.zoom,
                    }}
                  >
                    <header
                      className="cluster-frame__header nodrag pointer-events-auto flex min-h-10 cursor-grab items-center gap-2 rounded-t-lg px-3 py-1 text-[hsl(var(--cluster-title))] shadow-sm"
                      onPointerDown={(event) => startClusterDrag(event, cluster)}
                      onPointerCancel={() => finishClusterMove(true)}
                      onLostPointerCapture={() => finishClusterMove(true)}
                    >
                      {editingClusterId === cluster.id ? (
                        <Input
                          autoFocus
                          className="h-7 min-w-0 flex-1"
                          value={cluster.title}
                          onChange={(event) => setClusters((current) => current.map((item) => item.id === cluster.id ? { ...item, title: event.target.value } : item))}
                          onPointerDown={(event) => event.stopPropagation()}
                          onBlur={() => setEditingClusterId(null)}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") setEditingClusterId(null); }}
                        />
                      ) : (
                        <button
                          className="nodrag min-w-0 flex-1 truncate text-left text-sm font-semibold"
                          onPointerDown={(event) => event.stopPropagation()}
                          onDoubleClick={() => setEditingClusterId(cluster.id)}
                        >
                          {cluster.title}
                        </button>
                      )}
                      <Input
                        aria-label={`${cluster.title} note`}
                        className="h-7 w-36"
                        maxLength={200}
                        placeholder="Add note"
                        value={cluster.note ?? ""}
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={(event) => setClusters((current) => current.map((item) => item.id === cluster.id
                          ? { ...item, note: event.target.value || undefined }
                          : item))}
                      />
                      <span className="text-xs text-muted-foreground">{members.length} nodes</span>
                      {CLUSTER_COLLAPSE_ENABLED && <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        title={`Collapse ${cluster.title}`}
                        aria-label={`Collapse cluster ${cluster.title}`}
                        aria-expanded={true}
                        aria-controls={`cluster-frame-${cluster.id}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); setExpanded(cluster.id, false); }}
                      >
                        <ChevronUp aria-hidden="true" />
                      </Button>}
                      <button className="text-xs text-muted-foreground hover:text-foreground" onPointerDown={(event) => event.stopPropagation()} onClick={() => dissolveClustersForNodes(cluster.memberNodeIds)}>Dissolve</button>
                      <button className="text-xs text-destructive" onPointerDown={(event) => event.stopPropagation()} onClick={() => deleteNodeIds(cluster.memberNodeIds)}>Delete nodes</button>
                    </header>
                    <footer className="cluster-frame__footer nodrag nopan pointer-events-auto absolute inset-x-0 bottom-0 flex h-[52px] items-center rounded-b-lg border-t border-[hsl(var(--cluster-border))] px-3">
                      <ClusterExecutionControl
                        title={cluster.title}
                        state={clusterExecution.getState(cluster.id)}
                        onExecute={() => clusterExecution.executeCluster(cluster.id)}
                        onCancel={() => clusterExecution.cancelRun(cluster.id)}
                      />
                    </footer>
                  </section>
                );
              })}
            </div>
            <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
              <ExecuteAllControl
                isExecuting={isAutoExecuting}
                disabled={loading || nodes.length === 0 || clusterExecution.isExecutionActive}
                onExecute={executeAllNodes}
                onStop={handleStopExecution}
              />
            </div>
          </div>

          {canvasMenu && createPortal(
            <div
              role="menu"
              aria-label="Workflow actions"
              className="fixed z-[100] w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              style={{ left: canvasMenu.x, top: canvasMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {canvasMenu.kind === "selection" ? <>
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50" disabled={!menuValidation?.valid || Boolean(dragSource.nodeId)} title={menuValidation?.violations[0]?.message} onClick={() => createClusterFromSelection(canvasMenu.nodeIds)}>
                  Create cluster from selection
                  {!menuValidation?.valid && <span className="block truncate text-xs text-muted-foreground">{menuValidation?.violations[0]?.message}</span>}
                </button>
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => dissolveClustersForNodes(canvasMenu.nodeIds)}>Dissolve cluster</button>
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true }))}>Copy</button>
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm text-destructive hover:bg-accent" onClick={() => deleteNodeIds(canvasMenu.nodeIds)}>Delete nodes</button>
              </> : <>
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50" disabled={!clipboardRef.current || Boolean(dragSource.nodeId)} onClick={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "v", ctrlKey: true }))}>Paste</button>
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => setNodes((current) => current.map((node) => ({ ...node, selected: true })))}>Select all</button>
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => setNodes((current) => current.map((node) => ({ ...node, selected: false })))}>Clear selection</button>
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setIsPaletteVisible(true); setCanvasMenu(null); }}>Add node</button>
              </>}
            </div>, document.body)}

          {/* Right Sidebar - Node Palette */}
          {isPaletteVisible && (
            <div className="w-80 border-l border-border bg-sidebar node-palette-container flex-shrink-0">
              <NodePalette onNodeClick={handleNodeClick} />
            </div>
          )}
        </div>
      ) : (
        // Executions View
        <div className="flex flex-1 overflow-hidden">
          <ExecutionHistoryPanel
            workflowId={workflowId}
            selectedExecution={selectedExecution}
            onSelectExecution={handleSelectExecution}
            autoRefresh={autoRefresh}
            onAutoRefreshChange={setAutoRefresh}
            onRefresh={refreshExecutions}
            executions={executions}
            loading={executionsLoading}
            getDuration={getDuration}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
            statusFilter={statusFilter || "all"}
            onStatusFilterChange={(status) =>
              setStatusFilter(status as ExecutionFilters["status"])
            }
            dateFrom={dateFromInput}
            onDateFromChange={setDateFromInput}
            dateTo={dateToInput}
            onDateToChange={setDateToInput}
            onClearFilters={handleClearFilters}
            error={executionsError}
            onRetry={refreshExecutions}
          />

          {selectedExecution ? (
            <ExecutionDetailView
              execution={selectedExecution}
              nodes={nodes}
              edges={edges}
              nodeExecutions={getNodeExecutions(selectedExecution)}
              loading={loadingExecution}
              onCopyToEditor={() => setShowRestoreConfirm(true)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground bg-trading-grid">
              <div className="text-center">
                <p className="text-lg">Select an execution to view details</p>
                <p className="text-sm mt-1">
                  Click on any execution from the list on the left
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Toggle Arrow - positioned relative to main content area (only in editor mode) */}
      {activeTab === "editor" && (
        <button
          onClick={() => setIsPaletteVisible(!isPaletteVisible)}
          className={`fixed top-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-l-lg p-2 shadow-lg hover:bg-muted transition-all duration-200 palette-toggle-button ${
            isPaletteVisible ? "right-80" : "right-0"
          }`}
        >
          {isPaletteVisible ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      )}

      {/* Restore Confirmation Dialog */}
      <AlertDialog
        open={showRestoreConfirm}
        onOpenChange={setShowRestoreConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore workflow from snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace your current workflow with{" "}
              {(selectedExecution?.nodes as any[])?.length || 0} nodes and{" "}
              {(selectedExecution?.edges as any[])?.length || 0} edges from the
              execution snapshot. Your current unsaved changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedExecution?.nodes && selectedExecution?.edges) {
                  handleRestoreFromVersion(
                    selectedExecution.nodes as Node[],
                    selectedExecution.edges as Edge[],
                    parseNodeClusters(selectedExecution.node_clusters).clusters,
                  );
                  toast({
                    title: "Workflow restored",
                    description: `Restored ${(selectedExecution.nodes as any[]).length} nodes from execution snapshot`,
                  });
                }
                setActiveTab("editor");
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Save Confirmation Dialog for Significant Changes */}
      <AlertDialog
        open={showSaveConfirmDialog}
        onOpenChange={setShowSaveConfirmDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Significant Changes</AlertDialogTitle>
            <AlertDialogDescription>
              This save will significantly reduce the number of nodes in your
              workflow from {pendingSaveData?.currentCount || 0} to{" "}
              {pendingSaveData?.newCount || 0} nodes. A backup version will be
              created automatically. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingSaveData(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setPendingSaveData(null);
                // Save with skipConfirmation — versioning handled inside saveWorkflow
                await handleSaveWorkflow(true);
              }}
            >
              Save Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const WorkflowEditor = () => (
  <ReactFlowProvider>
    <StableNodeProvider>
      <ExecutionStoreProvider>
        <WorkflowEditorContent />
      </ExecutionStoreProvider>
    </StableNodeProvider>
  </ReactFlowProvider>
);

export default WorkflowEditor;
