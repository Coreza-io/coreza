/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useSyncExternalStore,
} from "react";
import { useNodeId, useReactFlow } from "@xyflow/react";
import { useParams } from "react-router-dom";
import { useSemanticGraphSnapshot, useStableNodes } from "@/contexts/StableNodeContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useExecutionStore,
  useExecutionNodeData,
  useExecutionStoreNotify,
} from "@/contexts/ExecutionStoreContext";
import { apiClient } from "@/lib/apiClient";
// Custom hooks
import { useNodeFieldState } from "@/hooks/useNodeFieldState";
import { useNodeRenaming } from "@/hooks/useNodeRenaming";
import { useNodeReferences } from "@/hooks/useNodeReferences";
import { useNodeCredentials } from "@/hooks/useNodeCredentials";
import { useNodeOutput } from "@/hooks/useNodeOutput";
import { useNodeExecution } from "@/hooks/useNodeExecution";
import { getDisplayName } from "@/components/nodes/layout/utils/nodeDisplay";
import {
  NODE_VISUAL_THEMES,
  DEFAULT_NODE_VISUAL_THEME,
  type NodeVisualCategory,
  type NodeVisualTheme,
} from "@/components/nodes/constants/nodeVisualThemes";
import { resolveNodeVisualCategory } from "@/components/nodes/constants/resolveNodeVisualCategory";
import {
  resolveHistoricalNodeId,
  resolveLiveInputData,
  resolvePreviousNodeId,
} from "@/utils/inputPanelSelection";
import {
  LISTENER_CLEAR_STATE,
  buildStopListeningPayload,
  resolveListeningFlagKey,
  resolveStopAction,
} from "@/components/nodes/listeningStop";
import { ExecutionControl } from "@/components/workflow/ExecutionIconButton";
import { resolveManualExecution } from "@/nodes/manualExecution";
import { getEditorExecutionTarget, subscribeEditorExecution } from "@/services/editorNodeExecution";
import type { SemanticNode } from "@/contexts/canonicalGraphStore";

interface BaseNodeProps {
  data: any;
  selected: boolean;
  readOnly?: boolean;
  workflowId?: string;
  children: (props: BaseNodeRenderProps) => React.ReactNode;
}

export interface BaseNodeRenderProps {
  definition: any;
  displayName: string;
  fieldState: Record<string, any>;
  error: string;
  isSending: boolean;
  loadingSelect: Record<string, boolean>;
  selectOptions: Record<string, any[]>;
  showAuth: boolean;
  previousNodes: readonly SemanticNode[];
  selectedPrevNodeId: string;
  selectedInputData: any;
  incomingEdgeCount: number;
  displayedData: any;
  isPinned: boolean;
  workflowId?: string;
  nodeId?: string;
  readOnly?: boolean;
  // Node name editing
  isEditing: boolean;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement>;
  startEditing: () => void;
  finishEditing: (save?: boolean) => Promise<void>;
  setEditingName: (name: string) => void;
  // Event handlers
  handleChange: (key: string, value: any) => void;
  handleFieldStateBatch: (updates: Record<string, any>) => void;
  handleSubmit: (
    e?: React.FormEvent,
  ) => ReturnType<ReturnType<typeof useNodeExecution>["handleSubmit"]>;
  handleDrop: (
    fieldKey: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    e: React.DragEvent,
    currentValue: string,
  ) => void;
  handleDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  getFieldPreview: (fieldKey: string) => string | null;
  setShowAuth: (show: boolean) => void;
  setSelectedPrevNodeId: (id: string) => void;
  handlePanelSave: (newData: any) => void;
  handlePanelPinToggle: () => void;
  handleStopListening: () => void;
  handleTogglePause: () => void;
  handleStepNext: () => void;
  handleStepPrevious: () => void;
  isTestListening: boolean;
  isStreamPaused: boolean;
  hasStreamCursor: boolean;
  canStepNext: boolean;
  canStepPrevious: boolean;
  fetchCredentials: (fieldKey: string) => void;
  fetchDependentOptions: (field: any, parentValue: string) => void;
  // Style constants
  referenceStyle: React.CSSProperties;
  neonColor: string;
  nodeSurfaceGradient: string;
  visualCategory: NodeVisualCategory;
  nodeTheme: NodeVisualTheme;
  collapsedExecutionControl?: React.ReactNode;
  expandedExecutionControl?: React.ReactNode;
}

const TAILWIND_NEON_COLORS: Record<string, string> = {
  "text-violet-": "#a78bfa",
  "text-purple-": "#a78bfa",
  "text-cyan-": "#22d3ee",
  "text-sky-": "#22d3ee",
  "text-blue-": "#22d3ee",
  "text-orange-": "#fb923c",
  "text-amber-": "#fb923c",
  "text-yellow-": "#fb923c",
  "text-emerald-": "#34d399",
  "text-green-": "#34d399",
  "text-pink-": "#f472b6",
  "text-fuchsia-": "#f472b6",
  "text-rose-": "#f472b6",
  "text-red-": "#f87171",
};

const BaseNode: React.FC<BaseNodeProps> = ({
  data,
  selected,
  readOnly,
  workflowId: propWorkflowId,
  children,
}) => {
  const nodeId = useNodeId();
  const { updateNodeData } = useStableNodes();
  const canonicalGraph = useSemanticGraphSnapshot();
  const { setNodes } = useReactFlow();
  const executionStore = useExecutionStore();
  const executionData = useExecutionNodeData(nodeId);
  const notifyStoreUpdate = useExecutionStoreNotify(); // Trigger re-render on manual updates
  const { id: routeWorkflowId } = useParams();
  const workflowId = propWorkflowId ?? routeWorkflowId;
  const workflowSessionId = typeof data?.workflowSessionId === "string" ? data.workflowSessionId : "";
  const activeExecutionTarget = useSyncExternalStore(
    (listener) => workflowSessionId ? subscribeEditorExecution(workflowSessionId, listener) : () => undefined,
    () => workflowSessionId ? getEditorExecutionTarget(workflowSessionId) : "",
  );
  const replaySessionRef = useRef(0);

  const definition = data.definition;
  const { visualCategory, nodeTheme, neonColor, nodeSurfaceGradient } =
    useMemo(() => {
      const cat = resolveNodeVisualCategory(definition);
      const theme = NODE_VISUAL_THEMES[cat] ?? DEFAULT_NODE_VISUAL_THEME;
      return {
        visualCategory: cat,
        nodeTheme: theme,
        neonColor: theme.neon,
        nodeSurfaceGradient: theme.background,
      };
    }, [definition?.name, definition?.category, definition?.def]);

  // Get display name - use stable access to avoid re-renders on drag
  const displayName = useMemo(() => {
    if (data.displayName && data.displayName.trim()) {
      return data.displayName;
    }
    return getDisplayName(
      { id: nodeId!, data },
    );
  }, [canonicalGraph.nodes, definition?.name, nodeId, data.displayName]);

  // History previews use the run's executed outputs, independently of editor topology.
  const previousNodes = useMemo<readonly SemanticNode[]>(() => {
    if (readOnly) {
      return (data.allNodeExecutions ?? []).map((execution: { nodeId: string; output?: unknown }) => ({
        id: execution.nodeId,
        data: { output: execution.output },
      }));
    }
    if (!nodeId) return [];
    return canonicalGraph.getUpstreamNodes(nodeId);
  }, [canonicalGraph, nodeId, readOnly, data.allNodeExecutions]);

  const incomingEdgeCount = useMemo(() => {
    if (!nodeId) return 0;
    return canonicalGraph.edges.filter((edge) => edge.target === nodeId).length;
  }, [canonicalGraph.edges, nodeId]);

  // State for selected previous node and auth modal
  const [showAuth, setShowAuth] = useState(false);
  const [selectedPrevNodeId, setSelectedPrevNodeId] = useState<string>("");
  const [canStepNext, setCanStepNext] = useState(true);
  const [canStepPrevious, setCanStepPrevious] = useState(true);

  const preferredPrevNodeId = useMemo(() => {
    if (!nodeId) return undefined;
    return canonicalGraph.edges.find(
      (edge) => edge.target === nodeId && edge.sourceHandle === "done",
    )?.source;
  }, [canonicalGraph.edges, nodeId]);

  const resolvedPrevNodeId = useMemo(
    () => readOnly
      ? resolveHistoricalNodeId(selectedPrevNodeId, data.allNodeExecutions ?? [])
      : resolvePreviousNodeId(
        selectedPrevNodeId,
        previousNodes,
        preferredPrevNodeId,
      ),
    [preferredPrevNodeId, previousNodes, selectedPrevNodeId, readOnly, data.allNodeExecutions],
  );

  // Historical selection is owned by InputPanel's executed-node options.
  useEffect(() => {
    if (readOnly) return;
    const nextId = resolvedPrevNodeId ?? "";
    if (nextId !== selectedPrevNodeId) {
      setSelectedPrevNodeId(nextId);
    }
  }, [readOnly, resolvedPrevNodeId, selectedPrevNodeId]);

  const previousExecutionData = useExecutionNodeData(resolvedPrevNodeId);
  const selectedInputData = useMemo(() => {
    void previousExecutionData;
    if (readOnly) {
      return previousNodes.find(node => node.id === resolvedPrevNodeId)?.data.output;
    }
    return resolveLiveInputData(
      resolvedPrevNodeId,
      canonicalGraph.nodes,
      (sourceNodeId) => executionStore.getNodeData(sourceNodeId),
    );
  }, [canonicalGraph.nodes, executionStore, resolvedPrevNodeId, previousExecutionData, readOnly, previousNodes]);
  const selectedPrevNode = previousNodes.find(
    (node) => node.id === resolvedPrevNodeId,
  );

  // ========== Use Custom Hooks ==========

  // Field state management
  const fieldStateHook = useNodeFieldState({
    definition,
    data,
    readOnly,
  });

  // Node renaming
  const renamingHook = useNodeRenaming({
    displayName,
    selected,
    readOnly,
  });

  // Credentials and options
  const credentialsHook = useNodeCredentials({
    definition,
    fieldState: fieldStateHook.fieldState,
    workflowId,
    workflowSessionId: data?.workflowSessionId,
  });

  // Output management
  const outputHook = useNodeOutput({
    data,
    definition,
  });

  // Execution logic
  const executionHook = useNodeExecution({
    definition,
    fieldState: fieldStateHook.fieldState,
    data,
    selectedInputNodeId: resolvedPrevNodeId,
    selectedInputData,
    setLastOutput: outputHook.setLastOutput,
    overrideOutput: outputHook.pinnedOutput,
    workflowId,
  });

  // References (drag-drop and previews)
  const referencesHook = useNodeReferences({
    workflowId,
    fieldState: fieldStateHook.fieldState,
    previousNodes,
    selectedPrevNodeId: resolvedPrevNodeId ?? "",
    selectedPrevNode,
  });

  // Get auth context for API calls
  const { session } = useAuth();

  const listeningFlagKey = useMemo(
    () => resolveListeningFlagKey(definition),
    [definition],
  );

  // Check live listener state - ONLY trust execution store, not stale output status
  const isTriggerListening = useMemo(() => {
    const nodeData = nodeId ? executionStore.getNodeData(nodeId) : null;
    return nodeData?.[listeningFlagKey] === true;
  }, [nodeId, executionStore, executionData, listeningFlagKey]);

  const isStreamPaused = useMemo(() => {
    const nodeData = nodeId ? executionStore.getNodeData(nodeId) : null;
    return nodeData?.isStreamPaused === true;
  }, [nodeId, executionStore, executionData]);

  const hasStreamCursor = useMemo(() => {
    const nodeData = nodeId ? executionStore.getNodeData(nodeId) : null;
    return typeof nodeData?.lastStreamEntryId === "string";
  }, [nodeId, executionStore, executionData]);

  useEffect(() => {
    if (!hasStreamCursor) {
      setCanStepNext(true);
      setCanStepPrevious(true);
    }
  }, [hasStreamCursor]);

  // Handle stop listening - calls the node definition's stop endpoint
  const handleStopListening = useCallback(async () => {
    if (!workflowId || !nodeId || readOnly) return;

    try {
      const stopAction = resolveStopAction(definition);
      console.log(
        `🛑 [BaseNode] Stopping test listener for ${workflowId}:${nodeId}`,
      );

      const stopPayload = buildStopListeningPayload({
        definition,
        workflowId,
        nodeId,
        credentialId: fieldStateHook.fieldState.credential_id,
      });
      const response = await apiClient.request(stopAction.url, {
        method: stopAction.method,
        body: JSON.stringify(stopPayload),
        token: session?.access_token,
      });

      if (response.ok) {
        // Update node state to remove listening status
        const stoppedOutput = {
          status: "stopped",
          message: "Test listener stopped manually",
          stoppedAt: new Date().toISOString(),
        };

        outputHook.setLastOutput(stoppedOutput);
        executionStore.setNodeData(nodeId, {
          output: stoppedOutput,
          ...LISTENER_CLEAR_STATE,
        });
        notifyStoreUpdate(); // Trigger re-render to hide streaming footer
        updateNodeData(nodeId, { output: stoppedOutput, ...LISTENER_CLEAR_STATE });
        console.log(`✅ [BaseNode] Test listener stopped successfully`);
      }
    } catch (error) {
      console.error("Failed to stop test listener:", error);
    }
  }, [
    workflowId,
    nodeId,
    readOnly,
    session?.access_token,
    definition,
    fieldStateHook.fieldState.credential_id,
    outputHook,
    executionStore,
    updateNodeData,
    notifyStoreUpdate,
  ]);

  // Toggle pause/resume for streaming
  const handleTogglePause = useCallback(async () => {
    if (!nodeId || readOnly) return;
    const current = executionStore.getNodeData(nodeId);
    const wasUserPaused =
      current.isStreamPaused === true && current.isStreamStepping !== true;

    if (wasUserPaused) {
      // Resume immediately for responsive UI; replay catch-up runs in background.
      executionStore.setNodeData(nodeId, {
        isStreamPaused: false,
        isStreamStepping: false,
      });
      notifyStoreUpdate();

      if (
        current.lastStreamEntryId &&
        (current.testListenWorkflowId || workflowId)
      ) {
        try {
          const replaySessionId = replaySessionRef.current + 1;
          replaySessionRef.current = replaySessionId;
          let replayCursor: string | null = current.lastStreamEntryId;
          const maxReplayPasses = 5;

          for (let i = 0; i < maxReplayPasses && replayCursor; i += 1) {
            if (replaySessionRef.current !== replaySessionId) {
              break;
            }

            const latestNodeData = executionStore.getNodeData(nodeId);
            if (latestNodeData.isStreamPaused) {
              break;
            }

            const replayResponse = await apiClient.post(
              "/stream/replay",
              {
                workflowId: current.testListenWorkflowId || workflowId,
                nodeId,
                afterEntryId: replayCursor,
              },
              session?.access_token,
            );

            if (!replayResponse.ok) {
              break;
            }

            const replayBody = await replayResponse
              .json()
              .catch(() => ({ replayed: 0, lastEntryId: null }));
            const replayed =
              typeof replayBody?.replayed === "number"
                ? replayBody.replayed
                : 0;
            const lastEntryId =
              typeof replayBody?.lastEntryId === "string"
                ? replayBody.lastEntryId
                : null;

            if (!lastEntryId || replayed === 0) {
              break;
            }

            replayCursor = lastEntryId;
          }
        } catch (error) {
          console.error("Failed to replay paused stream events:", error);
        }
      }
      return;
    }

    // User paused stream; cancel any in-flight replay sequence.
    replaySessionRef.current += 1;
    executionStore.setNodeData(nodeId, {
      isStreamPaused: true,
      isStreamStepping: false,
    });
    notifyStoreUpdate();
  }, [
    nodeId,
    readOnly,
    executionStore,
    notifyStoreUpdate,
    workflowId,
    session?.access_token,
  ]);

  const handleStepStream = useCallback(
    async (mode: "next" | "prev") => {
      if (!nodeId || readOnly) return;
      const current = executionStore.getNodeData(nodeId);
      if (!current.lastStreamEntryId) return;
      const activeWorkflowId = current.testListenWorkflowId || workflowId;
      if (!activeWorkflowId) return;

      if (!current.isStreamPaused) {
        replaySessionRef.current += 1;
        executionStore.setNodeData(nodeId, {
          isStreamPaused: true,
          isStreamStepping: true,
        });
        notifyStoreUpdate();
      } else {
        executionStore.setNodeData(nodeId, { isStreamStepping: true });
        notifyStoreUpdate();
      }

      const stepResponse = await apiClient.post(
        "/stream/replay",
        {
          workflowId: activeWorkflowId,
          nodeId,
          afterEntryId: current.lastStreamEntryId,
          mode,
        },
        session?.access_token,
      );

      if (!stepResponse.ok) {
        return;
      }

      const stepBody = await stepResponse
        .json()
        .catch(() => ({ replayed: 0, hasMore: false }));
      const replayed =
        typeof stepBody?.replayed === "number" ? stepBody.replayed : 0;
      const hasDirectionalMore =
        mode === "prev"
          ? typeof stepBody?.hasPrevious === "boolean"
            ? stepBody.hasPrevious
            : undefined
          : typeof stepBody?.hasNext === "boolean"
            ? stepBody.hasNext
            : undefined;
      const hasMore =
        typeof hasDirectionalMore === "boolean"
          ? hasDirectionalMore
          : typeof stepBody?.hasMore === "boolean"
            ? stepBody.hasMore
            : false;

      if (mode === "next") {
        setCanStepNext(hasMore);
        if (replayed > 0) {
          setCanStepPrevious(true);
        }
      } else {
        setCanStepPrevious(hasMore);
        if (replayed > 0) {
          setCanStepNext(true);
        }
      }
    },
    [
      nodeId,
      readOnly,
      executionStore,
      notifyStoreUpdate,
      workflowId,
      session?.access_token,
    ],
  );

  const handleStepNext = useCallback(async () => {
    await handleStepStream("next");
  }, [handleStepStream]);

  const handleStepPrevious = useCallback(async () => {
    await handleStepStream("prev");
  }, [handleStepStream]);

  const blockedReason = activeExecutionTarget && activeExecutionTarget !== `node:${nodeId}`
    ? "Another editor execution is active."
    : undefined;
  const executionPhase = executionHook.isSending || isTriggerListening
    ? "running"
    : blockedReason
      ? "blocked"
      : executionHook.error
        ? "failed"
        : "idle";
  const canExecuteManually = !readOnly && resolveManualExecution(definition).available;
  const createExecutionControl = (presentation: "icon" | "labelled") => canExecuteManually ? (
    <ExecutionControl
      targetKind="node"
      targetName={displayName}
      phase={executionPhase}
      disabledReason={blockedReason}
      statusDescription={executionHook.error ? "Execution failed. See Output Data for details." : undefined}
      onExecute={() => { void executionHook.handleSubmit(); }}
      onStop={isTriggerListening ? handleStopListening : undefined}
      presentation={presentation}
    />
  ) : undefined;

  const renderProps: BaseNodeRenderProps = {
    definition,
    displayName,
    fieldState: fieldStateHook.fieldState,
    error: executionHook.error,
    isSending: executionHook.isSending,
    loadingSelect: credentialsHook.loadingSelect,
    selectOptions: credentialsHook.selectOptions,
    showAuth,
    previousNodes,
    selectedPrevNodeId: readOnly ? resolvedPrevNodeId ?? "" : selectedPrevNodeId,
    selectedInputData,
    incomingEdgeCount,
    displayedData: outputHook.displayedData,
    isPinned: outputHook.isPinned,
    workflowId,
    nodeId: nodeId || undefined,
    readOnly,
    // Node name editing
    isEditing: renamingHook.isEditing,
    editingName: renamingHook.editingName,
    editInputRef: renamingHook.editInputRef,
    startEditing: renamingHook.startEditing,
    finishEditing: renamingHook.finishEditing,
    setEditingName: renamingHook.setEditingName,
    // Event handlers
    handleChange: fieldStateHook.handleChange,
    handleFieldStateBatch: fieldStateHook.handleFieldStateBatch,
    handleSubmit: executionHook.handleSubmit,
    handleDrop: referencesHook.handleDrop,
    handleDragStart: referencesHook.handleDragStart,
    getFieldPreview: referencesHook.getFieldPreview,
    setShowAuth,
    setSelectedPrevNodeId,
    handlePanelSave: outputHook.handlePanelSave,
    handlePanelPinToggle: outputHook.handlePanelPinToggle,
    handleStopListening,
    handleTogglePause,
    handleStepNext,
    handleStepPrevious,
    isTestListening: isTriggerListening,
    isStreamPaused,
    hasStreamCursor,
    canStepNext,
    canStepPrevious,
    fetchCredentials: credentialsHook.fetchCredentials,
    fetchDependentOptions: credentialsHook.fetchDependentOptions,
    // Style constants
    referenceStyle: referencesHook.referenceStyle,
    neonColor,
    nodeSurfaceGradient,
    visualCategory,
    nodeTheme,
    collapsedExecutionControl: createExecutionControl("icon"),
    expandedExecutionControl: createExecutionControl("labelled"),
  };

  return <>{children(renderProps)}</>;
};

export default BaseNode;
