import { notifyEditorExecutionScope } from "@/services/editorNodeExecution";
import { activateEditorSessionVariables, selectEditorBatchVariables, releaseEditorVariableLock } from "@/services/editorVariableScopes";
import { publishNodeResult } from "@/utils/publishNodeResult";

import { RUNTIME_NODE_DATA_KEYS } from "@/contexts/canonicalGraphStore";
import { clearAgentActivity } from "@/stores/agentActivityStore";
import { resetReferenceTextHistory } from "@/hooks/useReferenceTextDrop";
import { recoverClusterDocument } from '@/domain/clusters/recovery';
import { resolveClusterHierarchy } from '@/domain/clusters/hierarchy';
import { groupSelectionInDocument, dissolveClusterInDocument, copyClusterMetadata, mutateDocument, updateClusterMetadataInDocument } from '@/domain/clusters/documentCommands';
import { allocateNodeName, nodeDisplayName } from "@/domain/nodeNaming";
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
  useLayoutEffect,
  useSyncExternalStore,
  startTransition,
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
  ViewportPortal,
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
import { EdgeEditingContext } from "@/contexts/EdgeEditingContext";
import { LoopNode, LoopNodeData } from "@/components/workflow/LoopNode";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ExecutionFilters,
  ExecutionSummary,
  useExecutionHistory,
} from "@/hooks/useExecutionHistory";
import { ExecutionHistoryPanel } from "@/components/workflow/ExecutionHistoryPanel";
import { ExecutionDetailView } from "@/components/workflow/ExecutionDetailView";
import { WorkflowVersionHistory } from "@/components/workflow/WorkflowVersionHistory";
import { ClusterMetadataEditor, type ClusterMetadataEditIntent } from "@/components/workflow/ClusterMetadataEditor";
import { useWorkflowMutationGuard } from "@/hooks/useWorkflowMutationGuard";

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
  useExecutionStoreNotify,
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
import { deleteNodesFromDocument, insertNodesInDocument, pasteNodesInDocument, renameNodeInDocument, type WorkflowDocument } from "@/domain/clusters/documentCommands";
import { resolveInsertionPosition, type InsertionIntent } from "@/domain/clusters/insertion";
import { applyClusterExecutionVisuals, applyNodeExecutionVisuals, type ExecutionVisualSnapshot } from "@/domain/clusters/executionVisuals";
import { reconcileClusterProjection } from "@/domain/clusters/reconcileProjection";
import {
  ON_BAR_NODE_TYPE,
  createPaletteNodeBatch,
} from "@/domain/clusters/paletteNodeBatch";
import { resolveNodeRename, RESERVED_CLUSTER_NODE_PREFIX } from "@/domain/clusters/nodeRename";
import { apiClient } from "@/lib/apiClient";
import { useWorkflowActivation } from "@/hooks/useWorkflowActivation";
import { ExecuteAllControl } from "@/components/workflow/ExecuteAllControl";
import { ClusterExecutionControl } from "@/components/workflow/ClusterExecutionControl";
import { useClusterExecution } from "@/hooks/useClusterExecution";
import {
  acquireEditorExecutionLock,
  captureEditorNodeActions,
  canRenameEditorNodeAction,
  clearEditorNodeActions,
  isEditorExecutionLocked,
  getEditorExecutionTarget,
  subscribeEditorExecution,
  releaseEditorExecutionLock,
  retireEditorNodeAction,
  syncEditorNodeActionIds,
} from "@/services/editorNodeExecution";
import { ActivateControl } from "@/components/workflow/ActivateControl";
import "@/components/workflow/WorkflowSaveControl.css";
import { ToastAction } from "@/components/ui/toast";
import { CompactClusterNode } from "@/components/workflow/CompactClusterNode";
import { getExpandedClusterFrameRect, getVisibleClusterNodes, projectClusterGraph, resolveProjectedConnection, type ClusterProjection } from "@/domain/clusters/projection";
import {
  closeFocusedCluster,
  focusedClusterToViewState,
  isClusterExpanded,
  openFocusedCluster,
  reconcileFocusedCluster,
} from "@/domain/clusters/viewState";
import { CLUSTER_COLLAPSE_ENABLED } from "@/domain/clusters/capabilities";
import { resolveCanonicalSelection } from "@/domain/clusters/selection";
import { filterCanonicalNodeChanges, repairProjectedClusterNodes } from "@/domain/clusters/canonicalNode";
import {
  applyPositionTargets,
  capturePositions,
  positionsEqual,
  translatePositions,
  type PositionMap,
} from "@/domain/clusters/positions";

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

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
  | { type: "document"; document: WorkflowDocument; identityRename?: { from: string; to: string } }
  | { type: "positions"; nodeIds: string[]; before: PositionMap; after: PositionMap };

const WorkflowEditorContent = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: authUser, session, loading: authLoading } = useAuth();
  const executionStore = useExecutionStore();
  const notifyExecutionStoreUpdate = useExecutionStoreNotify();
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
  const workflowLoadKey = `${authUser?.id ?? ""}:${workflowId ?? ""}`;
  const [hasLoadedWorkflowId, setHasLoadedWorkflowId] = useState<string | null>(
    null,
  );
  const hasPersistedRef = useRef<boolean>(!isNewWorkflow);
  const [importGeneration, setImportGeneration] = useState(0);
  const workflowSessionId = useMemo(() => {
    // Tie lifecycle to workflowId changes (new workflow => new session scope).
    void workflowId;
    return crypto.randomUUID();
  }, [workflowId, importGeneration, authUser?.id]);
  const currentWorkflowSessionRef = useRef(workflowSessionId);
  currentWorkflowSessionRef.current = workflowSessionId;
  const { toggleActivation, isActivationPending } = useWorkflowActivation(workflowSessionId);
  const insertionIntentRef = useRef<InsertionIntent | null>(null);

  useEffect(() => () => {
    clearEditorNodeActions(workflowSessionId);
    clearAgentActivity(workflowSessionId);
  }, [workflowSessionId]);

  const previousRouteId = useRef(id);
  useEffect(() => {
    if (isNewWorkflow && previousRouteId.current !== id) {
      hasPersistedRef.current = false;
      setWorkflowId(crypto.randomUUID());
      setHasLoadedWorkflowId(null);
    }
    previousRouteId.current = id;
  }, [id, isNewWorkflow]);

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
  const activationRevisionRef = useRef(0);
  const [clusters, setClusters] = useState<NodeCluster[]>([]);
  const [focusedClusterId, setFocusedClusterId] = useState<string | null>(null);
  const focusedClusterIdRef = useRef(focusedClusterId);
  focusedClusterIdRef.current = focusedClusterId;
  const [selectedClusterIds, setSelectedClusterIds] = useState<Set<string>>(() => new Set());
  const [invalidClusterEntries, setInvalidClusterEntries] = useState<Array<{ index: number; value: unknown }>>([]);
  const [canvasMenu, setCanvasMenu] = useState<CanvasMenuState | null>(null);
  const [editingClusterId, setEditingClusterId] = useState<string | null>(null);
  const contextMenuFocusRef = useRef<HTMLElement | null>(null);
  const clusterMoveRef = useRef<ClusterMoveSession | null>(null);
  const activeNodeDragRef = useRef<string | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const overviewViewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const focusFitRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPaletteVisible, setIsPaletteVisible] = useState(true);
  const [executionProgress, setExecutionProgress] = useState<{
    sessionId: string; progress: ExecutionVisualSnapshot;
  } | null>(null);
  const runProgress = executionProgress?.sessionId === workflowSessionId ? executionProgress.progress : null;
  const executingNode = runProgress?.nodeId ?? null;
  const setExecutionVisuals = useCallback((progress: ExecutionVisualSnapshot | null) => {
    if (currentWorkflowSessionRef.current !== workflowSessionId) return;
    setExecutionProgress(progress ? { sessionId: workflowSessionId, progress } : null);
  }, [workflowSessionId]);
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
    hierarchySupported,
    saving: persistSaving,
    loading: persistLoading,
    saveWorkflow,
    loadWorkflow: persistLoadWorkflow,
    generateNewWorkflowName,
    hasUnsavedChanges,
    checkNodeReduction,
  } = useWorkflowPersistence({ projectId, workflowId });

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
    selectedExecutionId,
    setSelectedExecution,
    autoRefresh,
    setAutoRefresh,
    refresh: refreshExecutions,
    getDuration,
    getNodeExecutions,
    error: executionsError,
    detailLoading,
  } = useExecutionHistory(workflowId, executionFilters, activeTab === "executions");

  const selectedNodeExecutions = useMemo(
    () => selectedExecution ? getNodeExecutions(selectedExecution) : [],
    [getNodeExecutions, selectedExecution?.id, selectedExecution?.result,
      selectedExecution?.started_at, selectedExecution?.completed_at],
  );

  const handleSelectExecution = useCallback((execution: ExecutionSummary) => {
    if (selectedExecution?.id !== execution.id) void setSelectedExecution(execution);
  }, [selectedExecution?.id, setSelectedExecution]);

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
  useCanonicalGraphSync(nodes, edges, workflowSessionId);
  const rf = useReactFlow();
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[]; clusters: NodeCluster[]; sourceNodes: Node[] } | null>(null);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 400, y: 300 });

  // Connection drag tracking for hiding source handle icon
  const [dragSource, setDragSource] = useState<DragSource>({
    nodeId: null,
    handleId: null,
    handleType: null,
  });
  // Synchronous drag flags: read by pointer tracking before React state commits.
  const connectionDragRef = useRef(false);
  const selectionDragRef = useRef(false);
  const onConnectStart = useCallback((_: any, params: any) => {
    connectionDragRef.current = true;
    setDragSource({
      nodeId: params.nodeId ?? null,
      handleId: params.handleId ?? null,
      handleType: params.handleType ?? null,
    });
  }, []);
  const onConnectEnd = useCallback(() => {
    connectionDragRef.current = false;
    setDragSource({ nodeId: null, handleId: null, handleType: null });
  }, []);
  const historyRef = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  useLayoutEffect(() => {
    activateEditorSessionVariables(workflowSessionId);
    historyRef.current = { past: [], future: [] };
    clipboardRef.current = null;
    setIsAutoExecuting(false);
    setShowSaveConfirmDialog(false);
    setPendingSaveData(null);
    executionStore.dispose();
    notifyExecutionStoreUpdate();
    return () => {
      clearEditorNodeActions(workflowSessionId);
      activeExecutorRef.current?.stop();
      executionStore.dispose();
    };
  }, [workflowSessionId, executionStore, notifyExecutionStoreUpdate]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const clustersRef = useRef(clusters);
  clustersRef.current = clusters;
  const commitEdgeCandidateRef = useRef<(candidateEdges: Edge[]) => void>(() => undefined);
  const canonicalEdgesRef = useRef(edges);
  canonicalEdgesRef.current = edges;
  useEffect(() => {
    const currentIds = new Set(nodes.map(node => node.id));
    let retired = false;
    for (const nodeId of executionStore.storeMap.keys()) {
      if (!currentIds.has(nodeId)) { executionStore.retireNode(nodeId); retired = true; }
    }
    if (retired) notifyExecutionStoreUpdate();
  }, [nodes, executionStore, notifyExecutionStoreUpdate]);
  const canMutateDocument = useWorkflowMutationGuard({
    workflowSessionId, loading: loading || persistLoading || hasLoadedWorkflowId !== workflowLoadKey,
    hasInvalidMetadata: invalidClusterEntries.length > 0,
    clusterMove: clusterMoveRef, nodeDrag: activeNodeDragRef,
    selectionDrag: selectionDragRef, connectionDrag: connectionDragRef,
  });

  useEffect(() => stableNodes.registerNodeDataUpdater((nodeId, patch) => {
    const fields = "values" in patch || "fieldState" in patch || "pinnedOutput" in patch;
    if (fields && (!canMutateDocument() || !nodesRef.current.some(node => node.id === nodeId))) return false;
    const publish = () => setNodes((current) => {
      if (fields && !canMutateDocument()) return current;
      return current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...patch } }
      : node);
    });
    // Runtime results are already in the execution store; canvas input takes priority.
    if (Object.keys(patch).every(key => key === "output" || key === "input")) startTransition(publish);
    else publish();
    return true;
  }), [setNodes, stableNodes, canMutateDocument]);

  useEffect(() => setFocusedClusterId((current) => {
    const reconciled = reconcileFocusedCluster(current, clusters, new Set(nodes.map(({ id }) => id)));
    if (current !== null && reconciled === null) {
      const restore = overviewViewportRef.current;
      overviewViewportRef.current = null;
      focusFitRef.current = null;
      setCanvasMenu(null);
      setEditingClusterId(null);
      if (restore) requestAnimationFrame(() => { void rf.setViewport(restore); });
      else requestAnimationFrame(() => { void rf.fitView({ padding: 0.2, maxZoom: 1, minZoom: 0.4 }); });
    }
    return reconciled;
  }), [clusters, nodes, rf]);

  useEffect(() => {
    resetReferenceTextHistory();
    setFocusedClusterId(null);
    overviewViewportRef.current = null;
    focusFitRef.current = null;
    setSelectedClusterIds(new Set());
    clusterMoveRef.current = null;
    activeNodeDragRef.current = null;
    connectionDragRef.current = false;
    selectionDragRef.current = false;
    insertionIntentRef.current = null;
  }, [workflowId]);

  useEffect(() => {
    if (!CLUSTER_COLLAPSE_ENABLED) {
      setFocusedClusterId(null);
      overviewViewportRef.current = null;
      focusFitRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clusterMoveRef.current = null;
    activeNodeDragRef.current = null;
    connectionDragRef.current = false;
    selectionDragRef.current = false;
  }, []);

  const openCluster = useCallback((clusterId: string, availableClusters: readonly NodeCluster[] = clusters) => {
    if (!CLUSTER_COLLAPSE_ENABLED || clusterMoveRef.current) return;
    setFocusedClusterId((current) => {
      const next = openFocusedCluster(current, clusterId, availableClusters, new Set(nodesRef.current.map(({ id }) => id)));
      if (next === current) return current;
      if (current === null) overviewViewportRef.current = rf.getViewport();
      focusFitRef.current = null;
      setCanvasMenu(null);
      setEditingClusterId(null);
      return next;
    });
  }, [clusters, rf]);

  const closeCluster = useCallback((clusterId?: string) => {
    if (clusterMoveRef.current) return;
    const restore = overviewViewportRef.current;
    const parent = closeFocusedCluster(clusterId ?? focusedClusterIdRef.current, clustersRef.current);
    setFocusedClusterId(parent);
    focusFitRef.current = null;
    setCanvasMenu(null);
    setEditingClusterId(null);
    if (!parent) {
      overviewViewportRef.current = null;
      if (restore) void rf.setViewport(restore);
    }
  }, [rf]);

  const clusterViewState = useMemo(() => focusedClusterToViewState(focusedClusterId, clusters), [focusedClusterId, clusters]);
  const hierarchy = useMemo(() => resolveClusterHierarchy(clusters), [clusters]);
  const expandedFrameClusters = useMemo(() => clusters.filter(cluster => !CLUSTER_COLLAPSE_ENABLED || clusterViewState[cluster.id])
    .sort((a, b) => (hierarchy.ancestors.get(a.id)?.length ?? 0) - (hierarchy.ancestors.get(b.id)?.length ?? 0)), [clusters, clusterViewState, hierarchy]);

  const hierarchyCache = useRef({ clusters, hierarchy });
  hierarchyCache.current = { clusters, hierarchy };
  const effectiveMembers = useCallback((clusterId: string | null | undefined): string[] => {
    if (!clusterId) return [];
    if (hierarchyCache.current.clusters !== clustersRef.current) hierarchyCache.current = { clusters: clustersRef.current, hierarchy: resolveClusterHierarchy(clustersRef.current) };
    return hierarchyCache.current.hierarchy.effectiveMembers.get(clusterId) ?? [];
  }, []);

  const cloneNodes = useCallback((sourceNodes: Node[]) => {
    return sourceNodes.map((node) => ({
      ...node,
      data: Object.fromEntries(Object.entries(node.data).filter(([key]) => !RUNTIME_NODE_DATA_KEYS.has(key))),
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
      nodes: cloneNodes(nodesRef.current),
      edges: cloneEdges(canonicalEdgesRef.current),
      clusters: clustersRef.current.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })),
    } });
    historyRef.current.past = historyRef.current.past.slice(-50);
    historyRef.current.future = [];
  }, [cloneEdges, cloneNodes]);

  const restoreDocument = useCallback((document: WorkflowDocument) => {
    resetReferenceTextHistory();
    const liveNodes = new Map(nodesRef.current.map(node => [node.id, node]));
    const nextNodes = stampNodesWithWorkflowSession(repairProjectedClusterNodes(document.nodes.map(node => {
      // Undo stores editable state only. Reconcile it with today's runtime,
      // including results whose canonical transition has not committed yet.
      const runtime: Record<string, unknown> = {};
      for (const source of [liveNodes.get(node.id)?.data, node.data, executionStore.storeMap.get(node.id)]) {
        for (const [key, value] of Object.entries(source ?? {})) if (RUNTIME_NODE_DATA_KEYS.has(key)) runtime[key] = value;
      }
      const data = { ...node.data, ...runtime };
      if (node.data.pinnedOutput != null) data.output = node.data.pinnedOutput;
      return { ...node, data };
    })));

    const nextEdges = cloneEdges(document.edges);
    const nextClusters = document.clusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] }));
    syncEditorNodeActionIds(workflowSessionId, nextNodes);
    nodesRef.current = nextNodes;
    canonicalEdgesRef.current = nextEdges;
    const previousPath = resolveClusterHierarchy(clustersRef.current).expandedPath(focusedClusterIdRef.current);
    const nextFocus = [...previousPath].reverse().find(id=>nextClusters.some(c=>c.id === id)) ?? null;
    setFocusedClusterId(nextFocus);
    clustersRef.current = nextClusters;
    setNodes(nextNodes);
    setEdges(nextEdges);
    setClusters(nextClusters);
  }, [cloneEdges, executionStore, setEdges, setNodes, stampNodesWithWorkflowSession, workflowSessionId]);

  const commitClusterMetadata = useCallback((patch: Partial<Pick<NodeCluster, "title" | "note">>, intent: ClusterMetadataEditIntent): boolean => {
    if (intent.workflowSessionId !== workflowSessionId || !canMutateDocument()) return false;
    const result = updateClusterMetadataInDocument(
      {nodes:nodesRef.current, edges:canonicalEdgesRef.current, clusters:clustersRef.current},
      intent.clusterId, patch, intent,
    );
    if (result.ok === false) {
      toast({title:"Cannot edit cluster", description:result.message, variant:"destructive"});
      return false;
    }
    if (result.changed) {
      saveHistorySnapshot();
      restoreDocument(result.document);
    }
    return true;
  }, [workflowSessionId, canMutateDocument, saveHistorySnapshot, restoreDocument, toast]);

  useEffect(() => stableNodes.registerNodeRenamer(({ nodeId, requestedName }) => {
    if (loading) return { ok: false, code: "loading", message: "Wait for the workflow to finish loading." };
    if (clusterMoveRef.current || dragSource.nodeId) {
      return { ok: false, code: "structural-change", message: "Finish the current canvas action before renaming this node." };
    }
    if (isEditorExecutionLocked(workflowSessionId)) {
      return { ok: false, code: "execution-active", message: "Wait for the active execution to finish before renaming this node." };
    }
    if (nodeId.startsWith(RESERVED_CLUSTER_NODE_PREFIX)) {
      return { ok: false, code: "invalid-source", message: "Cluster display cards cannot be renamed as nodes." };
    }

    const currentNodes = nodesRef.current;
    const currentEdges = canonicalEdgesRef.current;
    const currentClusters = clustersRef.current;
    const source = currentNodes.find((node) => node.id === nodeId);
    if (!source) return { ok: false, code: "missing-source", message: "This node is no longer in the workflow." };
    const runtime = executionStore.getNodeData(nodeId);
    if (runtime.isListening || runtime.isTestListening || runtime.isStreamingWaiting) {
      return { ok: false, code: "listener-active", message: "Stop this node's active listener before renaming it." };
    }

    const resolved = resolveNodeRename(requestedName, nodeId, currentNodes);
    if (resolved.ok === false) return resolved;
    if (!resolved.changed) return { ok: true, oldId: nodeId, newId: resolved.name, changed: false };
    if (!executionStore.canRenameNode(nodeId, resolved.name)) {
      return { ok: false, code: "runtime-collision", message: "Runtime data already exists for the requested node name." };
    }
    if (!canRenameEditorNodeAction(workflowSessionId, nodeId, resolved.name)) {
      return { ok: false, code: "action-collision", message: "An editor action already exists for the requested node name." };
    }

    let candidate: ReturnType<typeof renameNodeInDocument>;
    try {
      candidate = renameNodeInDocument(
        { nodes: currentNodes, edges: currentEdges, clusters: currentClusters },
        nodeId,
        resolved.name,
      );
    } catch (error) {
      return { ok: false, code: "invalid-document", message: error instanceof Error ? error.message : "The node could not be renamed." };
    }

    historyRef.current.past.push({
      type: "document",
      identityRename: { from: resolved.name, to: nodeId },
      document: {
        nodes: cloneNodes(currentNodes),
        edges: cloneEdges(currentEdges),
        clusters: currentClusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })),
      },
    });
    historyRef.current.past = historyRef.current.past.slice(-50);
    historyRef.current.future = [];
    executionStore.renameNode(nodeId, resolved.name);
    retireEditorNodeAction(workflowSessionId, nodeId);
    restoreDocument(candidate.document);
    notifyExecutionStoreUpdate();
    return { ok: true, oldId: nodeId, newId: resolved.name, changed: true };
  }), [cloneEdges, cloneNodes, dragSource.nodeId, executionStore, loading, notifyExecutionStoreUpdate, restoreDocument, stableNodes, workflowSessionId]);

  const deleteNodeIds = useCallback((nodeIds: readonly string[]) => {
    if (nodeIds.length === 0 || !canMutateDocument()) return;
    if (!nodeIds.some(id=>nodes.some(n=>n.id === id))) return;
    try {
      const result = deleteNodesFromDocument({ nodes, edges, clusters }, new Set(nodeIds));
      saveHistorySnapshot();
      restoreDocument(result.document);
      if (result.dissolvedClusters.length > 0) toast({title:'Clusters dissolved', description:result.dissolvedClusters.map(c=>c.title).join(', ')});
    } catch (error) { toast({title:'Cannot delete nodes', description:String(error)}); }
  }, [clusters, canMutateDocument, edges, nodes, restoreDocument, saveHistorySnapshot, toast]);

  const dissolveClustersForNodes = useCallback((nodeIds: readonly string[]) => {
    const selected = new Set(nodeIds);
    const explicit = [...selectedClusterIds].filter(id=>clusters.some(c=>c.id === id));
    const matchingIds = explicit.length ? explicit : clusters.filter(c=>c.memberNodeIds.some(id=>selected.has(id))).map(c=>c.id);
    if (!matchingIds.length || !canMutateDocument()) return;
    let document: WorkflowDocument = {nodes, edges, clusters};
    try {
      for (const id of matchingIds) document = dissolveClusterInDocument(document, id).document;
    } catch (error) { toast({title:'Cannot dissolve cluster', description: String(error)}); return; }
    saveHistorySnapshot();
    restoreDocument(document);
    setCanvasMenu(null);
  }, [clusters, nodes, edges, selectedClusterIds, canMutateDocument, saveHistorySnapshot, restoreDocument, toast]);

  const dissolveClusterById = useCallback((id: string) => {
    if (!canMutateDocument() || !clusters.some(c => c.id === id)) return;
    try {
      const result = dissolveClusterInDocument({nodes, edges, clusters}, id);
      saveHistorySnapshot(); restoreDocument(result.document);
      if (result.dissolvedClusters.length) toast({title:'Clusters dissolved', description:result.dissolvedClusters.map(c=>c.title).join(', ')});
    } catch (error) { toast({title:'Cannot dissolve cluster', description:String(error)}); }
  }, [nodes, edges, clusters, canMutateDocument, saveHistorySnapshot, restoreDocument, toast]);

  const nextClusterTitle = useMemo(() => {
    const usedTitles = new Set(clusters.map(({ title }) => title.toLocaleLowerCase()));
    let index = 1;
    while (usedTitles.has(`cluster ${index}`)) index += 1;
    return `Cluster ${index}`;
  }, [clusters]);

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
      historyRef.current.past = historyRef.current.past.slice(-50);
      historyRef.current.future = [];
    }
  }, [setNodes]);

  const writeLoopFeedback = useCallback((loopId: string, edgeId: string, value: unknown) => {
    const data = executionStore.getNodeData(loopId) || {};
    executionStore.setNodeData(loopId, { ...data, _edgeBuf: { ...(data._edgeBuf || {}), [edgeId]: value } });
    notifyExecutionStoreUpdate();
  }, [executionStore, notifyExecutionStoreUpdate]);

  const clusterExecution = useClusterExecution({
    writeLoopFeedback,
    workflowSessionId,
    nodes,
    edges,
    clusters,
    disabledReason: invalidClusterEntries.length > 0 ? "Cluster metadata must be repaired before execution."
      : !authUser ? "Sign in to execute this cluster."
      : isAutoExecuting || executingNode ? "Another editor execution is active."
      : loading ? "Wait for the workflow to finish loading." : undefined,
  });

  // Last committed projection (written after commit, never during render) for identity reuse.
  const committedProjectionRef = useRef<{ sessionId: string; projection: ClusterProjection } | null>(null);
  const clusterProjection = useMemo(
    () => reconcileClusterProjection(
      committedProjectionRef.current?.sessionId === workflowSessionId ? committedProjectionRef.current.projection : null,
      projectClusterGraph(nodes, edges, clusters, clusterViewState, openCluster, {
      focusedClusterId,
      draggable: CLUSTER_COLLAPSE_ENABLED && !dragSource.nodeId,
      selectedClusterIds,
      getRunState: clusterExecution.getState,
      onExecute: clusterExecution.executeCluster,
      onCancel: clusterExecution.cancelRun,
      }),
    ),
    [clusterExecution.cancelRun, clusterExecution.executeCluster, clusterExecution.getState, clusterViewState, clusters, dragSource.nodeId, edges, focusedClusterId, nodes, openCluster, selectedClusterIds, workflowSessionId],
  );
  useLayoutEffect(() => {
    committedProjectionRef.current = { sessionId: workflowSessionId, projection: clusterProjection };
  }, [clusterProjection, workflowSessionId]);
  const actionableClusterIds = useMemo(() => new Set(
    [...clusterProjection.displayNodeToCluster.entries()]
      .filter(([displayId]) => !clusterProjection.hiddenRuntimeHostIds.has(displayId))
      .map(([, clusterId]) => clusterId).concat(Object.keys(clusterViewState).filter(id=>clusterViewState[id])),
  ), [clusterProjection.displayNodeToCluster, clusterProjection.hiddenRuntimeHostIds, clusterViewState]);
  const resolveVisibleCanonicalSelection = useCallback((sourceNodes: readonly Node[] = nodes): string[] =>
    resolveCanonicalSelection(
      sourceNodes,
      clusters,
      selectedClusterIds,
      clusterProjection.hiddenRuntimeHostIds,
      actionableClusterIds,
    ), [actionableClusterIds, clusterProjection.hiddenRuntimeHostIds, clusters, nodes, selectedClusterIds]);

  const createClusterFromSelection = useCallback((requestedIds?: readonly string[]) => {
    if (!canMutateDocument()) return;
    const selectedIds = requestedIds?.length ? [...new Set(requestedIds)] : resolveVisibleCanonicalSelection();
    const candidate: NodeCluster = { id: crypto.randomUUID(), title: nextClusterTitle, memberNodeIds: [] };
    const nested = selectedClusterIds.size > 0 || clusters.some(c=>c.memberNodeIds.some(id=>selectedIds.includes(id)));
    if (nested && !hierarchySupported) { toast({title:'Nested clusters unavailable', description:'The server must confirm hierarchy write support before creating nested clusters.'}); return; }
    const result = groupSelectionInDocument({nodes, edges, clusters}, selectedIds, selectedClusterIds, candidate);
    if (result.ok === false) { toast({title:'Cannot create cluster', description:result.message}); return; }
    saveHistorySnapshot();
    restoreDocument(result.document);
    openCluster(candidate.id, result.document.clusters);
    setEditingClusterId(candidate.id);
    setSelectedClusterIds(new Set());
    setCanvasMenu(null);
  }, [clusters, canMutateDocument, edges, nextClusterTitle, nodes, openCluster, resolveVisibleCanonicalSelection, restoreDocument, saveHistorySnapshot, selectedClusterIds, toast, hierarchySupported]);
  const manualExecutionTarget = useSyncExternalStore(
    useCallback((listener) => subscribeEditorExecution(workflowSessionId, listener), [workflowSessionId]),
    useCallback(() => getEditorExecutionTarget(workflowSessionId), [workflowSessionId]),
  );
  const manualExecutingNodeId = manualExecutionTarget.startsWith("node:")
    ? manualExecutionTarget.slice("node:".length) : null;
  const removeEdge = useCallback((edgeId: string) => {
    if (!canMutateDocument()) return;
    const committed = committedProjectionRef.current;
    const canonicalId = committed?.sessionId === workflowSessionId
      ? committed.projection.displayEdgeToCanonicalEdge.get(edgeId) ?? edgeId
      : edgeId;
    const current = canonicalEdgesRef.current;
    if (!current.some(edge => edge.id === canonicalId && edge.deletable !== false)) return;
    commitEdgeCandidateRef.current(current.filter(edge => edge.id !== canonicalId));
  }, [canMutateDocument, workflowSessionId]);

  const deletableEdgeIds = useMemo(() => {
    const ids = new Set(edges.filter(edge => edge.deletable !== false).map(edge => edge.id));
    for (const [displayId, canonicalId] of clusterProjection.displayEdgeToCanonicalEdge) {
      if (ids.has(canonicalId)) ids.add(displayId);
    }
    return ids;
  }, [edges, clusterProjection.displayEdgeToCanonicalEdge]);
  // Drag refs are checked at hover/click time; a finished drag need not trigger a render.
  const edgeEditingEnabled = !loading && !persistLoading && invalidClusterEntries.length === 0 && !manualExecutionTarget;
  const edgeEditing = useMemo(() => ({
    sessionId: workflowSessionId,
    enabled: edgeEditingEnabled,
    canEdit: canMutateDocument,
    deletableEdgeIds,
    removeEdge,
  }), [workflowSessionId, edgeEditingEnabled, canMutateDocument, deletableEdgeIds, removeEdge]);
  const baseDisplayedNodes = CLUSTER_COLLAPSE_ENABLED ? clusterProjection.nodes : nodes;
  const baseDisplayedEdges = CLUSTER_COLLAPSE_ENABLED ? clusterProjection.edges : edges;
  const activeMember = clusterExecution.activeMember;
  const activeClusterExpanded = !!activeMember && (!CLUSTER_COLLAPSE_ENABLED ||
    focusedClusterId === activeMember.clusterId || isClusterExpanded(clusterViewState, activeMember.clusterId));
  const { nodes: displayedNodes, edges: displayedEdges } = useMemo(() =>
    runProgress
      ? applyNodeExecutionVisuals(baseDisplayedNodes, baseDisplayedEdges, nodes, edges, runProgress.nodeId,
          true, undefined, clusterProjection.displayEdgeToCanonicalEdge, runProgress, clusters)
      : manualExecutingNodeId && !isAutoExecuting
      ? applyNodeExecutionVisuals(baseDisplayedNodes, baseDisplayedEdges, nodes, edges, manualExecutingNodeId,
          true, undefined, clusterProjection.displayEdgeToCanonicalEdge, undefined, clusters)
      : applyClusterExecutionVisuals(baseDisplayedNodes, baseDisplayedEdges, nodes, edges, clusters,
      activeMember?.sessionId === workflowSessionId ? activeMember : null, activeClusterExpanded, clusterProjection.displayEdgeToCanonicalEdge),
  [baseDisplayedNodes, baseDisplayedEdges, nodes, edges, clusters, activeMember, workflowSessionId, activeClusterExpanded, manualExecutingNodeId, runProgress, isAutoExecuting, clusterProjection.displayEdgeToCanonicalEdge]);
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

  useEffect(() => {
    const hiddenIds = clusterProjection.hiddenRuntimeHostIds;
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (!node.selected || !hiddenIds.has(node.id)) return node;
        changed = true;
        return { ...node, selected: false };
      });
      return changed ? next : current;
    });
    setSelectedClusterIds((current) => {
      const next = new Set([...current].filter((clusterId) => actionableClusterIds.has(clusterId)));
      return next.size === current.size ? current : next;
    });
  }, [actionableClusterIds, clusterProjection.hiddenRuntimeHostIds, setNodes]);

  useEffect(() => {
    if (!focusedClusterId || focusFitRef.current === focusedClusterId) return;
    const memberIds = new Set(effectiveMembers(focusedClusterId));
    const hierarchy = resolveClusterHierarchy(clusters);
    const focusedMembers = getVisibleClusterNodes(clusterProjection).filter(node=>memberIds.has(node.id) ||
      (node.type === 'compactCluster' && (hierarchy.ancestors.get(node.data.clusterId as string) ?? []).includes(focusedClusterId)));
    if (focusedMembers.length === 0) return;
    focusFitRef.current = focusedClusterId;
    requestAnimationFrame(() => { void rf.fitView({ nodes: focusedMembers, padding: 0.3, maxZoom: 1, minZoom: 0.4 }); });
  }, [clusters, focusedClusterId, nodes, rf, clusterProjection, effectiveMembers]);

  const startClusterDrag = useCallback((event: React.PointerEvent<HTMLElement>, cluster: NodeCluster) => {
    if (dragSource.nodeId || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const clusterWasSelected = selectedClusterIds.has(cluster.id);
    const selectedIds = clusterWasSelected
      ? resolveVisibleCanonicalSelection(nodesRef.current)
      : effectiveMembers(cluster.id);
    const focusedIds = clusterViewState[cluster.id] ? new Set(effectiveMembers(cluster.id)) : null;
    const movableIds = focusedIds ? selectedIds.filter((id) => focusedIds.has(id)) : selectedIds;
    if (!clusterWasSelected) {
      const memberIds = new Set(effectiveMembers(cluster.id));
      setNodes((current) => current.map((node) => ({ ...node, selected: memberIds.has(node.id) })));
      setSelectedClusterIds(new Set([cluster.id]));
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const initialMemberPositions = capturePositions(nodesRef.current, movableIds);
    clusterMoveRef.current = {
      workflowSessionId,
      clusterId: cluster.id,
      source: "expanded",
      pointerId: event.pointerId,
      clusterMemberNodeIds: [...new Set(effectiveMembers(cluster.id))],
      movedNodeIds: [...initialMemberPositions.keys()],
      initialMemberPositions,
      currentMemberPositions: initialMemberPositions,
      initialDisplayPosition: { x: 0, y: 0 },
      initialFlowPointer: rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    };
  }, [dragSource.nodeId, clusterViewState, effectiveMembers, resolveVisibleCanonicalSelection, rf, selectedClusterIds, setNodes, workflowSessionId]);

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
    if (!canMutateDocument({allowConnectionDrag:true})) return;
    const currentNodes = nodesRef.current;
    const currentEdges = canonicalEdgesRef.current;
    const currentClusters = clustersRef.current;
    if (candidateEdges.length === currentEdges.length && candidateEdges.every((edge, index) => edge === currentEdges[index])) return;
    const currentInvalid = new Set(validateClusters(currentNodes, currentEdges, currentClusters).violations.flatMap(
      ({ clusterId }) => clusterId ? [clusterId] : [],
    ));
    const candidateValidation = validateClusters(currentNodes, candidateEdges, currentClusters);
    const newlyInvalidIds = new Set(candidateValidation.violations.flatMap(
      ({ clusterId }) => clusterId && !currentInvalid.has(clusterId) ? [clusterId] : [],
    ));
    if (newlyInvalidIds.size === 0) {
      saveHistorySnapshot();
      canonicalEdgesRef.current = candidateEdges;
      setEdges(candidateEdges);
      return;
    }
    const firstViolation = candidateValidation.violations.find(({ clusterId }) => clusterId && newlyInvalidIds.has(clusterId));
    toast({
      title: "Connection would invalidate a cluster",
      description: firstViolation?.message,
      variant: "destructive",
      action: (
        <ToastAction
          altText="Dissolve affected clusters and apply connection change"
          onClick={() => {
            if (!canMutateDocument() || nodesRef.current !== currentNodes || clustersRef.current !== currentClusters || canonicalEdgesRef.current !== currentEdges) return;
            try {
              const result = mutateDocument({nodes:currentNodes, edges:currentEdges, clusters:currentClusters}, candidate=>{candidate.edges=candidateEdges;});
              saveHistorySnapshot(); restoreDocument(result.document);
              toast({title:'Clusters dissolved', description:result.dissolvedClusters.map(c=>c.title).join(', ')});
            } catch (error) { toast({title:'Cannot apply connection', description:String(error)}); }
          }}
        >
          Dissolve cluster and apply
        </ToastAction>
      ),
    });
  }, [saveHistorySnapshot, restoreDocument, setEdges, toast, canMutateDocument]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.some(change => change.type === "remove") && !canMutateDocument()) return;
    const currentEdges = canonicalEdgesRef.current;
    const canonicalChanges = changes.flatMap((change): EdgeChange[] => {
      if (change.type === "remove" || change.type === "select") {
        const id = clusterProjection.displayEdgeToCanonicalEdge.get(change.id) ?? change.id;
        return currentEdges.some(edge => edge.id === id && (change.type !== "remove" || edge.deletable !== false))
          ? [{...change, id}] : [];
      }
      if (change.type !== "add" && change.type !== "replace") return [change];
      const connection = resolveProjectedConnection(change.item, clusterProjection, nodesRef.current, currentEdges);
      if (!connection) return [];
      const id = change.type === "replace"
        ? clusterProjection.displayEdgeToCanonicalEdge.get(change.id) ?? change.id
        : change.item.id;
      const existing = currentEdges.find(edge => edge.id === id);
      const item = existing ? {...existing, ...connection} : {id, type:change.item.type, ...connection};
      return [change.type === "replace" ? {...change, id, item} : {...change, item}];
    });
    if (!canonicalChanges.length) return;
    const candidate = applyEdgeChanges(canonicalChanges, currentEdges);
    if (canonicalChanges.some(({type}) => type === "add" || type === "remove" || type === "replace")) commitEdgeCandidate(candidate);
    else {
      canonicalEdgesRef.current = candidate;
      setEdges(candidate);
    }
  }, [commitEdgeCandidate, clusterProjection, setEdges, canMutateDocument]);
  commitEdgeCandidateRef.current = commitEdgeCandidate;

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
      const cleanupSession = workflowSessionId;
      if (!authUser || currentWorkflowSessionRef.current !== cleanupSession) return;

      const storeData = executionStore.getNodeData(nodeId) as any;
      const storedSymbols = Array.isArray(storeData?.output?.data?.symbols)
        ? storeData.output.data?.symbols
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

      if (!updateNodeState || currentWorkflowSessionRef.current !== cleanupSession || !nodesRef.current.some(node => node.id === nodeId)) return;
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
      notifyExecutionStoreUpdate();
    },
    [authUser?.id, workflowSessionId, session?.access_token, executionStore, setNodes, notifyExecutionStoreUpdate],
  );

  const onCompactDragStart = useCallback((_: React.MouseEvent, node: Node) => {
    const clusterId = clusterProjection.displayNodeToCluster.get(node.id);
    const cluster = clusters.find((candidate) => candidate.id === clusterId);
    if (!cluster) {
      if (nodesRef.current.some(({ id }) => id === node.id)) activeNodeDragRef.current = node.id;
      return;
    }
    if (dragSource.nodeId) return;
    const selectedIds = selectedClusterIds.has(cluster.id)
      ? resolveVisibleCanonicalSelection(nodesRef.current)
      : effectiveMembers(cluster.id);
    const initialMemberPositions = capturePositions(nodesRef.current, selectedIds);
    clusterMoveRef.current = {
      workflowSessionId,
      clusterId: cluster.id,
      source: "compact",
      clusterMemberNodeIds: [...new Set(effectiveMembers(cluster.id))],
      movedNodeIds: [...initialMemberPositions.keys()],
      initialMemberPositions,
      currentMemberPositions: initialMemberPositions,
      initialDisplayPosition: { ...node.position },
    };
  }, [clusterProjection.displayNodeToCluster, clusters, dragSource.nodeId, effectiveMembers, resolveVisibleCanonicalSelection, selectedClusterIds, workflowSessionId]);

  const onCompactDragStop = useCallback(() => {
    activeNodeDragRef.current = null;
    finishClusterMove(false);
  }, [finishClusterMove]);

  const onSelectionDragStart = useCallback(() => {
    selectionDragRef.current = true;
  }, []);
  const onSelectionDragStop = useCallback(() => {
    selectionDragRef.current = false;
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (changes.some(change => change.type === "remove") && !canMutateDocument()) return;
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
            const memberIds = new Set(effectiveMembers(cluster.id));
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
      const canonicalChanges = filterCanonicalNodeChanges(changes, canonicalNodeIds)
        .filter((change) => !("id" in change)
          || clusterProjection.visibleNodeIds.has(change.id)
          || change.type === "dimensions");
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
              executionStore.getNodeData(id)?.output?.data?.symbols ??
              nodeData?.output?.data?.symbols ??
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
    [canMutateDocument, applyNodeChanges, cleanupNewsSubscription, clusterProjection.displayNodeToCluster, clusterProjection.visibleNodeIds, clusters, deleteNodeIds, effectiveMembers, executionStore, nodes, setNodes, workflowSessionId],
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

      if (!nodeId || !newsData || currentWorkflowSessionRef.current !== workflowSessionId
        || !nodesRef.current.some(node => node.id === nodeId)
        || (rawPayload.workflowId && rawPayload.workflowId !== workflowId)) return;

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

      publishNodeResult(nextOutput, { nodeId,
        isCurrent: () => currentWorkflowSessionRef.current === workflowSessionId && nodesRef.current.some(node => node.id === nodeId),
        updateNodeData: stableNodes.updateNodeData, store: executionStore, notify: notifyExecutionStoreUpdate });
    },
    [executionStore, stableNodes, workflowSessionId, workflowId, notifyExecutionStoreUpdate],
  );

  useEffect(() => {
    // Keep the message handler stable without forcing WS reconnections
    messageHandlerRef.current = handleNodeOutputMessage;
  }, [handleNodeOutputMessage]);

  // Handle "+" click on Loop node to add a new downstream node
  const handleAddNode = useCallback(
    (loopNodeId: string) => {
      if (!canMutateDocument()) return;
      const current = { nodes: nodesRef.current, edges: canonicalEdgesRef.current, clusters: clustersRef.current };
      const parent = current.nodes.find((node) => node.id === loopNodeId);
      if (!parent) return;
      const position = parent.position;
      const allocated = allocateNodeName("New Node", current.nodes);
      if (allocated.ok === false) return;
      const newNode: Node = {
        id: allocated.name,
        type: "default",
        position: { x: position.x + 200, y: position.y },
        data: { label: "New Node", displayName: allocated.name, workflowSessionId },
      };

      const edgeId = `edge_${loopNodeId}_${newNode.id}`;
      const newEdge: Edge = {
        id: edgeId,
        source: loopNodeId,
        sourceHandle: "done",
        target: newNode.id,
        type: "removable",
        data: { onRemoveEdge: () => removeEdge(edgeId) },
      };
      const result = insertNodesInDocument(current, { nodes: [newNode], edges: [newEdge] });
      if (result.ok) { saveHistorySnapshot(); restoreDocument(result.document); }
    },
    [restoreDocument, workflowSessionId, removeEdge, canMutateDocument, saveHistorySnapshot],
  );

  const handleRemoveLoop = useCallback(
    (loopNodeId: string) => {
      commitEdgeCandidate(canonicalEdgesRef.current.filter((edge) => edge.source !== loopNodeId && edge.target !== loopNodeId));
    },
    [commitEdgeCandidate],
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

    let ownedSocket: WebSocket | null = null;
    const connect = () => {
      if (closedByEffect) return;
      const socket = new WebSocket(`${wsUrl}?token=${session.access_token}`);
      wsRef.current = socket;
      ownedSocket = socket;
      const ownsConnection = () => !closedByEffect && wsRef.current === socket;

      socket.onopen = () => {
        if (!ownsConnection()) return;
        console.log("🔌 News stream WebSocket connected");
      };

      socket.onmessage = (event) => {
        if (!ownsConnection()) return;
        try {
          const message = JSON.parse(event.data);
          if (!message?.type) {
            return;
          }

          if (message.type === "node_output") {
            messageHandlerRef.current({ ...message.payload, workflowId: message.payload?.workflowId ?? message.workflowId }, message.timestamp);
          } else if (
            message.type === "alpaca_news" ||
            message.type === "news_stream"
          ) {
            const payload = message.payload || {};
            messageHandlerRef.current(
              {
                nodeId: payload.nodeId || payload.node_id,
                workflowId: payload.workflowId ?? message.workflowId,
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
        if (!ownsConnection()) return;
        console.error("News stream WebSocket error", event);
        socket.close();
      };

      socket.onclose = () => {
        if (!ownsConnection()) return;
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
      if (ownedSocket) {
        ownedSocket.onopen = ownedSocket.onmessage = ownedSocket.onerror = ownedSocket.onclose = null;
        try {
          ownedSocket.close(1000, "navigate/cleanup");
        } catch (e) {
          console.log(e, "ERROR");
        }
        if (wsRef.current === ownedSocket) wsRef.current = null;
      }
    };
  }, [authUser?.id, session?.access_token, workflowSessionId]);

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
      const canonicalConnection = resolveProjectedConnection(params, clusterProjection, nodesRef.current, canonicalEdgesRef.current);
      if (!canonicalConnection) return;
      const id = `edge_${crypto.randomUUID()}`;
      const newEdge: Edge = {
        id,
        ...canonicalConnection,
        type: "removable",
        data: { onRemoveEdge: () => removeEdge(id) },
      };
      commitEdgeCandidate(addEdge(newEdge, canonicalEdgesRef.current));
    },
    [commitEdgeCandidate, clusterProjection, removeEdge],
  );

  const onReconnect = useCallback((displayedEdge: Edge, connection: Connection) => {
    const canonical = resolveProjectedConnection(connection, clusterProjection, nodesRef.current, canonicalEdgesRef.current);
    const id = clusterProjection.displayEdgeToCanonicalEdge.get(displayedEdge.id) ?? displayedEdge.id;
    if (!canonical || !canonicalEdgesRef.current.some(e=>e.id === id)) return;
    commitEdgeCandidate(canonicalEdgesRef.current.map(edge=>edge.id === id ? {...edge, ...canonical} : edge));
  }, [clusterProjection, commitEdgeCandidate]);

  const activeExecutorRef = useRef<WorkflowExecutor | null>(null);
  const preparationRef = useRef(0);
  const [pendingExecution, setPendingExecution] = useState<{ workflowId: string; nodeId?: string; generation: number } | null>(null);
  const createAcceptedExecutor = useCallback((sessionId: string) => {
    const currentNodes = nodesRef.current;
    const currentEdges = canonicalEdgesRef.current;
    if (!currentNodes.length || currentWorkflowSessionRef.current !== sessionId) return null;
    const nodeActions = captureEditorNodeActions(sessionId, currentNodes.map(node => node.id));
    const executor = new WorkflowExecutor({
      nodes: currentNodes.map(node => ({ ...node, data: { ...node.data } })),
      edges: currentEdges.map(edge => ({ ...edge })),
      nodeActions, setNodes, setEdges, setExecutingNode: () => undefined,
      setExecutionVisuals, toast, executionStore,
    });
    activeExecutorRef.current = executor;
    return executor;
  }, [executionStore, setNodes, setEdges, setExecutionVisuals]);

  useEffect(() => () => {
    activeExecutorRef.current?.stop();
    activeExecutorRef.current = null;
  }, [workflowSessionId]);
  useEffect(() => () => { preparationRef.current += 1; }, []);

  const ensureBacktestExecutionReady = useCallback(async (): Promise<boolean | string> => {
    const preparationSession = currentWorkflowSessionRef.current;
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

    if (currentWorkflowSessionRef.current !== preparationSession) return false;
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
      return savedWorkflowId;
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

  // Accept the graph/actions only after preparation, while holding this session's lock.
  const executeAcceptedRun = useCallback(async (nodeId?: string) => {
    const acceptedSession = currentWorkflowSessionRef.current;
    if (acceptedSession !== workflowSessionId || loading || persistLoading || hasLoadedWorkflowId !== workflowLoadKey || !canMutateDocument()) return;
    const lockToken = acquireEditorExecutionLock(acceptedSession);
    if (!lockToken) {
      toast({ title: "Execution already active", description: "Stop the current run before executing again." });
      return;
    }
    const generation = ++preparationRef.current;
    let executor: WorkflowExecutor | null = null;
    setIsAutoExecuting(true);
    try {
      const candidates = nodesRef.current;
      if (!candidates.length || (nodeId && !candidates.some(node => node.id === nodeId))) return;
      const needsSave = nodeId
        ? (candidates.find(node => node.id === nodeId)?.data?.definition as any)?.name === "BacktestInit"
        : hasBacktestInitNode(candidates);
      if (needsSave) {
        const ready = await ensureBacktestExecutionReady();
        if (!ready || generation !== preparationRef.current) return;
        if (typeof ready === "string") {
          // Saving a new workflow installs a new session. Release this lock before accepting there.
          setPendingExecution({ workflowId: ready, nodeId, generation });
          return;
        }
      }
      if (generation !== preparationRef.current || currentWorkflowSessionRef.current !== acceptedSession) return;
      if (!nodeId) {
        selectEditorBatchVariables(lockToken, acceptedSession);
        notifyEditorExecutionScope(acceptedSession);
      }
      executor = createAcceptedExecutor(acceptedSession);
      if (!executor) return;
      setIsAutoExecuting(true);
      if (nodeId) await executor.executeNodeWithLock(nodeId, new Set(), lockToken);
      else await executor.executeAllNodes(lockToken);
    } catch (error) {
      if (generation === preparationRef.current && currentWorkflowSessionRef.current === acceptedSession) {
        toast({ title: "Execution failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }
    } finally {
      if (activeExecutorRef.current === executor) activeExecutorRef.current = null;
      if (currentWorkflowSessionRef.current === acceptedSession) setIsAutoExecuting(false);
      // Release restores the manual preview immediately; close rejects late requests.
      const closingVariables = releaseEditorVariableLock(lockToken);
      releaseEditorExecutionLock(acceptedSession, lockToken);
      try { await closingVariables; }
      catch (error) {
        if (currentWorkflowSessionRef.current === acceptedSession) toast({ title: "Variable cleanup incomplete", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }
    }
  }, [workflowSessionId, createAcceptedExecutor, ensureBacktestExecutionReady, hasBacktestInitNode, loading, persistLoading, hasLoadedWorkflowId, workflowLoadKey, canMutateDocument]);

  useEffect(() => {
    if (!pendingExecution) return;
    if (pendingExecution.generation !== preparationRef.current) { setPendingExecution(null); return; }
    if (loading || persistLoading || hasLoadedWorkflowId !== workflowLoadKey) return;
    if (workflowId !== pendingExecution.workflowId) { setPendingExecution(null); return; }
    if (nodes.some(node => node.data.workflowSessionId !== workflowSessionId)) return;
    setPendingExecution(null);
    void executeAcceptedRun(pendingExecution.nodeId);
  }, [pendingExecution, workflowId, workflowSessionId, nodes, executeAcceptedRun, loading, persistLoading, hasLoadedWorkflowId, workflowLoadKey]);

  const executeAllNodes = useCallback(() => executeAcceptedRun(), [executeAcceptedRun]);
  const handleStopExecution = useCallback(() => {
    preparationRef.current += 1;
    setPendingExecution(null);
    if (!activeExecutorRef.current) setIsAutoExecuting(false);
    activeExecutorRef.current?.stop();
  }, []);

  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const clusterId = clusterProjection.displayNodeToCluster.get(node.id);
    if (clusterId) { openCluster(clusterId); return; }
    void executeAcceptedRun(node.id);
  }, [clusterProjection.displayNodeToCluster, executeAcceptedRun, openCluster]);

  // Save workflow via persistence hook
  const handleSaveWorkflow = async (skipConfirmation: boolean = false) => {
    const saveSession = workflowSessionId;
    if (currentWorkflowSessionRef.current !== saveSession) return;
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
    if (loading || persistLoading || hasLoadedWorkflowId !== workflowLoadKey) {
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
      if (currentWorkflowSessionRef.current !== saveSession) return;
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

    if (currentWorkflowSessionRef.current !== saveSession) return;
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

    const activationSession = workflowSessionId;
    activationRevisionRef.current += 1;
    const result = await toggleActivation(workflowId, isActive);
    if (result !== null && currentWorkflowSessionRef.current === activationSession) {
      activationRevisionRef.current += 1;
      setIsActive(result);

      // Cleanup news subscriptions on deactivation
      if (!result) {
        nodes
          .filter((node) => isNewsStreamNode(node.data?.definition as any))
          .forEach((node) => {
            const nodeData = node.data as any;
            const nodeDef = nodeData?.definition;
            const candidateSymbols =
              executionStore.getNodeData(node.id)?.output?.data?.symbols ??
              nodeData?.output?.data?.symbols ??
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
    if (!workflowId || !session?.access_token) return;
    let disposed = false;
    let revision = 0;
    const current = () => !disposed && currentWorkflowSessionRef.current === workflowSessionId;
    const reconcile = async () => {
      const requestRevision = ++revision;
      const activationRevision = activationRevisionRef.current;
      try {
        const response = await apiClient.get(`/workflows/${workflowId}`, session.access_token);
        if (!response.ok) return;
        const result = await response.json();
        if (current() && revision === requestRevision && activationRevision === activationRevisionRef.current
          && typeof result.workflow?.is_active === "boolean") {
          setIsActive(result.workflow.is_active);
        }
      } catch {
        // The next reconnect or focus retries authoritative reconciliation.
      }
    };
    const onFocus = () => { void reconcile(); };
    window.addEventListener("focus", onFocus);
    const channel = supabase
      .channel(`workflow-active-${workflowId}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "workflows", filter: `id=eq.${workflowId}`,
      }, (payload) => {
        const updated = payload.new as Record<string, unknown>;
        if (!current() || typeof updated.is_active !== "boolean") return;
        revision += 1;
        setIsActive(updated.is_active);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void reconcile();
        else revision += 1;
      });
    return () => {
      disposed = true;
      revision += 1;
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [workflowId, workflowSessionId, session?.access_token]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onMouseMove = useCallback((event: React.MouseEvent) => {
    mousePosRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    if ((event.target as HTMLElement).closest("button, input, textarea, [role='menu'], [data-cluster-control]")) return;
    if (insertionIntentRef.current?.source === "member-selection") return;
    // Advisory hit-testing is skipped while any canvas drag is active; click/drop re-resolves.
    if (
      clusterMoveRef.current
      || activeNodeDragRef.current
      || selectionDragRef.current
      || connectionDragRef.current
    ) return;
    const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const currentNodes = nodesRef.current;
    const currentClusters = clustersRef.current;
    const currentFocusedClusterId = focusedClusterIdRef.current;
    const targetClusterId = resolveInsertionPosition({
      intent: { position, source: "canvas-pointer", workflowSessionId },
      fallbackPosition: position,
      nodes: currentNodes,
      clusters: currentClusters,
      expandedClusterId: currentFocusedClusterId,
      workflowSessionId,
      zoom: rf.getViewport().zoom,
    }).targetClusterId;
    if (insertionIntentRef.current?.source === "canvas-pointer"
      && insertionIntentRef.current.targetClusterId
      && targetClusterId === null) return;
    insertionIntentRef.current = {
      position,
      source: "canvas-pointer",
      targetClusterId,
      workflowSessionId,
    };
  }, [rf, workflowSessionId]);

  const createNode = useCallback(
    (nodeType: string, intent?: InsertionIntent) => {
      const nodeDefinition = nodeManifest[nodeType];
      if (!nodeDefinition) {
        toast({ title: "Cannot add node", description: "This node type is not available.", variant: "destructive" });
        return false;
      }
      if (loading || persistLoading || invalidClusterEntries.length > 0) {
        toast({ title: "Cannot add node", description: "Wait for the workflow document to become available.", variant: "destructive" });
        return false;
      }
      if (clusterMoveRef.current || activeNodeDragRef.current || dragSource.nodeId) {
        toast({ title: "Cannot add node", description: "Finish the current canvas action before adding a node.", variant: "destructive" });
        return false;
      }
      if (isEditorExecutionLocked(workflowSessionId)) {
        toast({ title: "Cannot add node", description: "Wait for the active execution to finish before adding a node.", variant: "destructive" });
        return false;
      }
      if (!canMutateDocument()) return false;

      const viewport = rf.getViewport();
      const canvasRect = canvasContainerRef.current?.getBoundingClientRect();
      const fallbackPosition = canvasRect
        ? rf.screenToFlowPosition({ x: canvasRect.left + canvasRect.width / 2, y: canvasRect.top + canvasRect.height / 2 })
        : { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom };
      const currentNodes = nodesRef.current;
      const currentEdges = canonicalEdgesRef.current;
      const currentClusters = clustersRef.current;
      const currentFocusedClusterId = focusedClusterIdRef.current;
      const selectedMember = currentNodes.find((node) => node.selected
        && currentClusters.some(c=>resolveClusterHierarchy(currentClusters).expandedPath(currentFocusedClusterId).includes(c.id) && c.memberNodeIds.includes(node.id)));
      const effectiveIntent = intent ?? insertionIntentRef.current ?? (selectedMember ? {
        source: "member-selection" as const,
        selectedMemberId: selectedMember.id,
        targetClusterId: currentClusters.find(c=>c.memberNodeIds.includes(selectedMember.id))?.id,
        workflowSessionId,
      } : null);
      const placement = resolveInsertionPosition({
        intent: effectiveIntent,
        fallbackPosition,
        nodes: currentNodes,
        clusters: currentClusters,
        expandedClusterId: currentFocusedClusterId,
        workflowSessionId,
        zoom: viewport.zoom,
      });
      if (intent && placement.reason) {
        toast({ title: "Cannot add node", description: "The insertion target is no longer available.", variant: "destructive" });
        return false;
      }
      const position = placement.position;

      const batch = createPaletteNodeBatch({
        nodeType,
        definition: nodeDefinition,
        onBarDefinition: nodeManifest[ON_BAR_NODE_TYPE],
        position,
        workflowSessionId,
        existingNodes: currentNodes,
        existingEdges: currentEdges,
        onRemoveEdge: removeEdge,
      });

      const result = insertNodesInDocument(
        { nodes: currentNodes, edges: currentEdges, clusters: currentClusters },
        { nodes: batch.nodes, edges: batch.edges, targetClusterId: placement.targetClusterId, expandedClusterId: currentFocusedClusterId },
      );
      if (result.ok === false) {
        toast({ title: "Cannot add node", description: result.message, variant: "destructive" });
        return false;
      }
      historyRef.current.past.push({
        type: "document",
        document: {
          nodes: cloneNodes(currentNodes),
          edges: cloneEdges(currentEdges),
          clusters: currentClusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })),
        },
      });
      historyRef.current.past = historyRef.current.past.slice(-50);
      historyRef.current.future = [];
      restoreDocument({
        ...result.document,
        nodes: result.document.nodes.map((node) => ({ ...node, selected: node.id === batch.primaryNodeId })),
      });
      return true;
    },
    [
      workflowSessionId,
      removeEdge,
      loading,
      persistLoading,
      invalidClusterEntries.length,
      dragSource.nodeId,
      canMutateDocument,
      rf,
      restoreDocument,
      cloneNodes,
      cloneEdges,
      toast,
    ],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      // Only create a node when dropping a valid palette item
      if (!type) return;

      const intent: InsertionIntent = {
        position: rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        source: "drop",
        workflowSessionId,
      };
      if (createNode(type, intent)) insertionIntentRef.current = intent;
    },
    [createNode, rf, workflowSessionId],
  );

  // Handle node click from palette
  const handleNodeClick = useCallback(
    (nodeType: string) => {
      if (createNode(nodeType)) setIsPaletteVisible(false);
    },
    [createNode],
  );

  // Restore workflow from a version snapshot
  const handleRestoreFromVersion = useCallback(
    (restoredNodes: Node[], restoredEdges: Edge[], restoredClusters?: NodeCluster[]) => {
      if (!canMutateDocument({allowInvalidMetadata:true})) return;
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
            displayName: (node as Node & { displayName?: string }).displayName || node.data?.displayName || node.id,
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

      const recovered = recoverClusterDocument(restoredClusters ?? [], nodesWithDefinitions, edgesWithHandlers);
      saveHistorySnapshot();
      restoreDocument({nodes:nodesWithDefinitions, edges:edgesWithHandlers, clusters:recovered.clusters});
      setInvalidClusterEntries(recovered.invalidEntries);

      toast({
        title: "Version Restored",
        description: `Restored ${nodesWithDefinitions.length} nodes. Remember to save your changes.`,
      });
    },
    [removeEdge, saveHistorySnapshot, restoreDocument, toast, canMutateDocument],
  );

  // Check for user authentication and load latest workflow

  useEffect(() => {
    if (authLoading) return; // Wait for auth to finish loading

    if (!authUser) {
      // Redirect to login if no user found
      navigate("/login");
      return;
    }

    // Prevent reloading if we've already loaded this workflow
    if (hasLoadedWorkflowId && workflowLoadKey === hasLoadedWorkflowId) {
      //console.log("🚫 Skipping reload - workflow already loaded");
      return;
    }

    if (!isNewWorkflow && id !== workflowId) return;
    const controller = new AbortController();
    const acceptedSession = workflowSessionId;
    const canPublish = () => !controller.signal.aborted && currentWorkflowSessionRef.current === acceptedSession;
    const doLoad = async () => {
      if (isNewWorkflow) {
        // New workflow — generate smart name, seed from selected template
        setLoading(true);
        try {
          const name = await generateNewWorkflowName(!!projectId);
          if (!canPublish()) return;
          setWorkflowName(name);
        } catch {
          if (!canPublish()) return;
          setWorkflowName(projectId ? "New Project Workflow" : "My workflow 1");
        }
        if (!canPublish()) return;
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
        setClusters([]);
        setInvalidClusterEntries([]);
        setFocusedClusterId(null);
        setSelectedClusterIds(new Set());
        setIsActive(false);
        setLoading(false);
        setHasLoadedWorkflowId(workflowLoadKey);
      } else if (workflowId && workflowLoadKey !== hasLoadedWorkflowId) {
        // Load existing workflow via persistence hook
        setLoading(true);
        const loaded = await persistLoadWorkflow(workflowId, removeEdge, { signal: controller.signal, isCurrent: canPublish });
        if (!canPublish()) return;
        if (loaded) {
          setWorkflowName(loaded.name);
          setIsActive(loaded.isActive);
          setNodes(stampNodesWithWorkflowSession(repairProjectedClusterNodes(loaded.nodes)));
          setEdges(loaded.edges);
          setClusters(loaded.clusters);
          setInvalidClusterEntries(loaded.invalidClusterEntries);
          setHasLoadedWorkflowId(workflowLoadKey);
        } else {
          navigate("/dashboard/workflows");
        }
        setLoading(false);
      }
    };

    void doLoad();
    return () => controller.abort();
  }, [
    authUser?.id,
    id,
    workflowSessionId,
    authLoading,
    navigate,
    isNewWorkflow,
    workflowId,
    workflowLoadKey,
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
  const onPaneClick = useCallback((event: React.MouseEvent) => {
    setSelectedClusterIds(new Set());
    const position = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const targetClusterId = resolveInsertionPosition({
      intent: { position, source: "canvas-click", workflowSessionId },
      fallbackPosition: position,
      nodes: nodesRef.current,
      clusters: clustersRef.current,
      expandedClusterId: focusedClusterIdRef.current,
      workflowSessionId,
      zoom: rf.getViewport().zoom,
    }).targetClusterId;
    insertionIntentRef.current = {
      position,
      source: "canvas-click",
      targetClusterId,
      workflowSessionId,
    };
    setCanvasMenu(null);
    if (isPaletteVisible) {
      setIsPaletteVisible(false);
    }
  }, [isPaletteVisible, rf, workflowSessionId]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    const canonicalId = clusterProjection.displayNodeToCluster.has(node.id) ? null : node.id;
    if (!canonicalId) return;
    if (!event.shiftKey && !event.metaKey && !event.ctrlKey) setSelectedClusterIds(new Set());
    const targetClusterId = clustersRef.current.find(({ id, memberNodeIds }) =>
      resolveClusterHierarchy(clustersRef.current).expandedPath(focusedClusterIdRef.current).includes(id) && memberNodeIds.includes(canonicalId))?.id ?? null;
    insertionIntentRef.current = {
      source: "member-selection",
      selectedMemberId: canonicalId,
      targetClusterId,
      workflowSessionId,
    };
  }, [clusterProjection.displayNodeToCluster, workflowSessionId]);

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
      ? effectiveMembers(clusterId)
      : undefined;
    const selectedCanonicalIds = resolveVisibleCanonicalSelection();
    const nodeIds = node.selected
      ? [...new Set(selectedCanonicalIds)]
      : (clusterMembers ?? [node.id]);
    if (!node.selected) {
      const targets = new Set(nodeIds);
      setNodes((current) => current.map((item) => ({ ...item, selected: targets.has(item.id) })));
      setSelectedClusterIds(clusterId ? new Set([clusterId]) : new Set());
    }
    openCanvasMenu(event, nodeIds, "selection");
  }, [clusterProjection.displayNodeToCluster, effectiveMembers, openCanvasMenu, resolveVisibleCanonicalSelection, setNodes]);

  const onSelectionContextMenu = useCallback((event: React.MouseEvent, selectedNodes: Node[]) => {
    const canonicalIds = selectedNodes.flatMap(({ id }) => {
      const clusterId = clusterProjection.displayNodeToCluster.get(id);
      return clusterId ? effectiveMembers(clusterId) : [id];
    });
    openCanvasMenu(event, [...new Set(canonicalIds)], "selection");
  }, [clusterProjection.displayNodeToCluster, effectiveMembers, openCanvasMenu]);

  useEffect(() => {
    const move = clusterMoveRef.current;
    if (!move) return;
    const cluster = clusters.find(({ id }) => id === move.clusterId);
    const currentMemberIds = cluster ? [...new Set(effectiveMembers(cluster.id))] : [];
    const currentNodeIds = new Set(nodes.map(({ id }) => id));
    if (!cluster
      || currentMemberIds.length !== move.clusterMemberNodeIds.length
      || currentMemberIds.some((id) => !move.clusterMemberNodeIds.includes(id))
      || move.movedNodeIds.some((id) => !currentNodeIds.has(id))) {
      finishClusterMove(true);
    }
  }, [clusters, effectiveMembers, finishClusterMove, nodes]);

  const menuValidation = useMemo(() => {
    if (!canvasMenu || canvasMenu.kind !== "selection") return null;
    const result = groupSelectionInDocument({nodes, edges, clusters}, canvasMenu.nodeIds, selectedClusterIds, {id:crypto.randomUUID(), title:nextClusterTitle, memberNodeIds:[]});
    return result.ok === false ? {valid:false, violations:[{message:result.message}]} : {valid:true, violations:[]};
  }, [canvasMenu, clusters, edges, nextClusterTitle, nodes, selectedClusterIds]);

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
        if (!canMutateDocument({allowInvalidMetadata:true})) return;
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
          destination.push({
            type: "document",
            identityRename: entry.identityRename ? { from: entry.identityRename.to, to: entry.identityRename.from } : undefined,
            document: { nodes: cloneNodes(nodes), edges: cloneEdges(edges), clusters: clusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })) },
          });
          if (entry.identityRename) {
            const { from, to } = entry.identityRename;
            if (!executionStore.canRenameNode(from, to) || !canRenameEditorNodeAction(workflowSessionId, from, to)) {
              source.push(entry);
              destination.pop();
              toast({ title: "Cannot restore node rename", description: "Runtime state already exists for the node identity being restored.", variant: "destructive" });
              return;
            }
            executionStore.renameNode(from, to);
            retireEditorNodeAction(workflowSessionId, from);
            notifyExecutionStoreUpdate();
          }
          restoreDocument(entry.document);
        }
        event.preventDefault();
        toast({ description: direction === "undo" ? "Undid last change" : "Redid last change" });
        return;
      }

      if (isModKey && event.key.toLowerCase() === "g") {
        const selectedIds = resolveVisibleCanonicalSelection();
        if (event.shiftKey) dissolveClustersForNodes(selectedIds);
        else createClusterFromSelection(selectedIds);
        event.preventDefault();
        return;
      }

      if (isModKey && event.key.toLowerCase() === "c") {
        const selectedIds = new Set(resolveVisibleCanonicalSelection());
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

        const nodesCopy = cloneNodes(selectedNodes);

        const edgesCopy = selectedEdges.map((edge) => ({
          ...edge,
          data: { ...edge.data },
        }));

        clipboardRef.current = {
          nodes: nodesCopy,
          sourceNodes: nodesRef.current.map(({ id, type, data }) => ({ id, type, position: { x: 0, y: 0 }, data: { displayName: data.displayName, definition: data.definition } })),
          edges: edgesCopy,
          clusters: copyClusterMetadata(clusters, selectedNodeIds, selectedClusterIds),
        };
        toast({ description: "Selection copied" });
        return;
      }

      // Cut (Ctrl+X) - Copy to clipboard then delete
      if (isModKey && event.key.toLowerCase() === "x") {
        if (!canMutateDocument()) { event.preventDefault(); return; }
        const selectedIds = new Set(resolveVisibleCanonicalSelection());
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

        const nodesCopy = cloneNodes(selectedNodes);

        const edgesCopy = selectedEdges.map((edge) => ({
          ...edge,
          data: { ...edge.data },
        }));

        clipboardRef.current = {
          nodes: nodesCopy,
          sourceNodes: nodesRef.current.map(({ id, type, data }) => ({ id, type, position: { x: 0, y: 0 }, data: { displayName: data.displayName, definition: data.definition } })),
          edges: edgesCopy,
          clusters: copyClusterMetadata(clusters, selectedNodeIds, selectedClusterIds),
        };

        // 2. Delete selected nodes from canvas (same as Delete key)
        const selectedNodeIdArray = Array.from(selectedNodeIds);

        deleteNodeIds(selectedNodeIdArray);

        toast({ description: "Selection cut" });
        return;
      }

      if (isModKey && event.key.toLowerCase() === "v") {
        if (!canMutateDocument()) { event.preventDefault(); return; }
        if (!clipboardRef.current) {
          return;
        }

        const { nodes: copiedNodes, edges: copiedEdges, clusters: copiedClusters, sourceNodes } = clipboardRef.current;
        if (copiedNodes.length === 0) {
          return;
        }

        const current = { nodes: nodesRef.current, edges: canonicalEdgesRef.current, clusters: clustersRef.current };

        const pointerPosition = rf.screenToFlowPosition({
          x: mousePosRef.current.x,
          y: mousePosRef.current.y,
        });

        const placement = resolveInsertionPosition({intent:insertionIntentRef.current, fallbackPosition:pointerPosition, nodes:current.nodes, clusters:current.clusters, expandedClusterId:focusedClusterIdRef.current, workflowSessionId, zoom:rf.getViewport().zoom});
        if (placement.reason) { toast({title:'Cannot paste selection', description:'The insertion target is no longer available.'}); return; }
        const flowPosition = placement.position;

        const minX = Math.min(
          ...copiedNodes.map((node) => node.position?.x ?? 0),
        );
        const minY = Math.min(
          ...copiedNodes.map((node) => node.position?.y ?? 0),
        );
        const nodeIdMap: Record<string, string> = {};
        const timestamp = Date.now();
        const reservations = new Set<string>();
        const existingEdgeIds = new Set(current.edges.map((edge) => edge.id));
        for (const node of copiedNodes) {
          const validation = allocateNodeName(nodeDisplayName(node), []);
          if (validation.ok === false) {
            toast({ title: "Cannot paste selection", description: validation.message, variant: "destructive" });
            return;
          }
        }
        const familyNames = (sourceNodes ?? copiedNodes).map(nodeDisplayName);
        const newNodes = copiedNodes.map((node) => {
          const allocated = allocateNodeName(nodeDisplayName(node), current.nodes, undefined, reservations, familyNames);
          if (allocated.ok === false) throw new Error(allocated.message);
          const newId = allocated.name;
          reservations.add(newId);
          nodeIdMap[node.id] = newId;
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
              displayName: newId,
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

        const result = pasteNodesInDocument(current, {
          nodes: newNodes, edges: newEdges, idMap: nodeIdMap, copiedClusters, sourceNodes,
          targetClusterId: placement.targetClusterId, expandedClusterId: focusedClusterIdRef.current,
        });
        if (result.ok === false) {
          toast({ title: "Cannot paste selection", description: result.message, variant: "destructive" });
          return;
        }
        if (!hierarchySupported && result.document.clusters.some(c=>c.parentClusterId !== undefined)) {
          toast({title:'Cannot paste nested clusters', description:'The server has not confirmed hierarchy write support.'}); return;
        }
        historyRef.current.past.push({ type: "document", document: {
          nodes: cloneNodes(current.nodes), edges: cloneEdges(current.edges),
          clusters: current.clusters.map((cluster) => ({ ...cluster, memberNodeIds: [...cluster.memberNodeIds] })),
        } });
        historyRef.current.past = historyRef.current.past.slice(-50);
        historyRef.current.future = [];
        restoreDocument(result.document);
        event.preventDefault();

        toast({ description: "Selection pasted" });
        return;
      }

      if (event.key === "Delete") {
        //console.log("Delete key pressed - removing selected nodes");

        // Get IDs of nodes being deleted
        const selectedNodeIds = resolveVisibleCanonicalSelection();

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
    clusters,
    selectedClusterIds,
    stampNodesWithWorkflowSession,
    saveHistorySnapshot,
    createClusterFromSelection,
    deleteNodeIds,
    dissolveClustersForNodes,
    restoreDocument,
    resolveVisibleCanonicalSelection,
    focusedClusterId,
    hierarchySupported,
    canMutateDocument,
    nodesRef,
    canonicalEdgesRef,
    clustersRef,
    rf,
    executionStore,
    notifyExecutionStoreUpdate,
    workflowSessionId,
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
                if (!canMutateDocument({allowInvalidMetadata:true})) throw new Error("Finish the active canvas action or execution before importing.");
                clearEditorNodeActions(workflowSessionId);
                for (const node of nodesRef.current) executionStore.setPinned(node.id, null);
                executionStore.clear();
                notifyExecutionStoreUpdate();
                setImportGeneration((generation) => generation + 1);
                setWorkflowName(imported.name);
                const importedNodes = imported.nodes.map((n) => ({
                  id: n.id,
                  type: n.type,
                  position: n.position,
                  data: {
                    values: n.values,
                    label: n.type,
                    displayName: n.displayName,
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
            aria-busy={persistSaving || undefined}
            variant="outline"
            className="coreza-workflow-save h-10 px-4 font-medium"
          >
            <Save className="h-4 w-4 mr-2" />
            {persistSaving ? "Saving..." : "Save"}
          </Button>

          <ActivateControl
            isActive={isActive}
            loading={loading || isActivationPending(workflowId, isActive)}
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
          <div ref={canvasContainerRef} className="relative flex-1 bg-trading-grid">
            <ConnectionDragContext.Provider value={dragSource}>
              <EdgeEditingContext.Provider value={edgeEditing}>
              <ReactFlow
                nodes={displayedNodes}
                edges={displayedEdges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onReconnect={onReconnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onMouseMove={onMouseMove}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onNodeDragStart={onCompactDragStart}
                onNodeDragStop={onCompactDragStop}
                onSelectionDragStart={onSelectionDragStart}
                onSelectionDragStop={onSelectionDragStop}
                onPaneClick={onPaneClick}
                onNodeContextMenu={onNodeContextMenu}
                onSelectionContextMenu={onSelectionContextMenu}
                onPaneContextMenu={(event) => openCanvasMenu(event, [], "pane")}
                onMoveStart={() => setCanvasMenu(null)}
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
                <ViewportPortal>
            <div className="pointer-events-none absolute inset-0 z-[2]" aria-label="Workflow clusters">
              {expandedFrameClusters.map((cluster) => {
                const frameRect = getExpandedClusterFrameRect(cluster, nodes, clusters, clusterViewState);
                if (!frameRect) return null;
                const memberCount = effectiveMembers(cluster.id).length;
                return (
                  <section
                    key={cluster.id}
                    id={`cluster-frame-${cluster.id}`}
                    className="cluster-frame absolute rounded-xl border-2"
                    style={{
                      transform: `translate(${frameRect.x}px, ${frameRect.y}px)`,
                      transformOrigin: "top left",
                      width: frameRect.width,
                      height: frameRect.height,
                      borderColor: clusterExecution.getState(cluster.id).phase === "failed" ? "hsl(var(--destructive))" : undefined,
                    }}
                  >
                    <header
                      className="cluster-frame__header nodrag pointer-events-auto flex min-h-10 cursor-grab items-center gap-2 rounded-t-lg px-3 py-1 text-[hsl(var(--cluster-title))] shadow-sm"
                      onPointerDown={(event) => startClusterDrag(event, cluster)}
                      onPointerCancel={() => finishClusterMove(true)}
                      onLostPointerCapture={() => finishClusterMove(true)}
                    >
                      <ClusterMetadataEditor
                        cluster={cluster} workflowSessionId={workflowSessionId}
                        editingTitle={editingClusterId === cluster.id}
                        disabled={!canMutateDocument()}
                        onEditTitle={() => setEditingClusterId(cluster.id)}
                        onFinishTitle={() => setEditingClusterId(null)}
                        onCommit={commitClusterMetadata}
                      />
                      <span className="text-xs text-muted-foreground">{memberCount} nodes</span>
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
                        onClick={(event) => { event.stopPropagation(); closeCluster(cluster.id); }}
                      >
                        <ChevronUp aria-hidden="true" />
                      </Button>}
                      <button className="text-xs text-muted-foreground hover:text-foreground" onPointerDown={(event) => event.stopPropagation()} onClick={() => dissolveClusterById(cluster.id)}>Dissolve</button>
                      <button className="text-xs text-destructive" onPointerDown={(event) => event.stopPropagation()} onClick={() => deleteNodeIds(effectiveMembers(cluster.id))}>Delete nodes</button>
                    </header>
                    <footer className="cluster-frame__footer nodrag nopan pointer-events-auto absolute inset-x-0 bottom-0 flex h-[52px] items-center justify-center rounded-b-lg border-t border-[hsl(var(--cluster-border))] px-3">
                      <div className="w-full max-w-sm">
                        <ClusterExecutionControl
                          presentation="labelled"
                          title={cluster.title}
                          state={clusterExecution.getState(cluster.id)}
                          onExecute={() => clusterExecution.executeCluster(cluster.id)}
                          onCancel={() => clusterExecution.cancelRun(cluster.id)}
                        />
                      </div>
                    </footer>
                  </section>
                );
              })}
            </div>
                </ViewportPortal>
              </ReactFlow>
              </EdgeEditingContext.Provider>
            </ConnectionDragContext.Provider>
            <div className="pointer-events-auto absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
              <ExecuteAllControl
                isExecuting={isAutoExecuting || pendingExecution !== null}
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
                <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => setNodes((current) => current.map((node) => ({ ...node, selected: clusterProjection.visibleNodeIds.has(node.id) })))}>Select all</button>
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
              selectedExecutionId={selectedExecutionId}
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
              nodeExecutions={selectedNodeExecutions}
              loading={detailLoading}
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
