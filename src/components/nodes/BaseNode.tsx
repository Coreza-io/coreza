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
} from "react";
import { useNodeId, useReactFlow, useStore } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { useParams } from "react-router-dom";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { useStableNodes } from "@/contexts/StableNodeContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  useExecutionStore,
  useExecutionStoreVersion,
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
import { useNodeAutoExecution } from "@/hooks/useNodeAutoExecution";
import { getDisplayName } from "@/components/nodes/layout/utils/nodeDisplay";

interface BaseNodeProps {
  data: any;
  selected: boolean;
  readOnly?: boolean;
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
  previousNodes: Node[];
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
  finishEditing: (save?: boolean) => void;
  setEditingName: (name: string) => void;
  // Event handlers
  handleChange: (key: string, value: any) => void;
  handleFieldStateBatch: (updates: Record<string, any>) => void;
  handleSubmit: (e?: React.FormEvent) => void;
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
}

// Selector for edge count - only re-renders when number of edges changes
const edgeCountSelector = (state: any) => state.edges?.length ?? 0;

const BaseNode: React.FC<BaseNodeProps> = ({
  data,
  selected,
  readOnly,
  children,
}) => {
  const nodeId = useNodeId();
  const { getNodes, getEdges } = useStableNodes();
  const { setNodes } = useReactFlow();
  const executionStore = useExecutionStore();
  const storeVersion = useExecutionStoreVersion(); // Subscribe to store updates
  const notifyStoreUpdate = useExecutionStoreNotify(); // Trigger re-render on manual updates
  const { id: workflowId } = useParams();
  // Subscribe to edge count changes (not position changes)
  const edgeCount = useStore(edgeCountSelector);

  // Track upstream nodes with stable reference
  const previousNodesRef = useRef<Node[]>([]);
  const replaySessionRef = useRef(0);

  const definition = data.definition;

  // Get display name - use stable access to avoid re-renders on drag
  const displayName = useMemo(() => {
    if (data.displayName && data.displayName.trim()) {
      return data.displayName;
    }
    const nodes = getNodes();
    return getDisplayName({ id: nodeId!, data } as Node<any>, nodes);
  }, [definition?.name, nodeId, data.displayName, getNodes]);

  // Get upstream nodes - recalculate when edge count changes
  const previousNodes = useMemo(() => {
    if (!nodeId) return previousNodesRef.current;
    const nodes = getNodes();
    const edges = getEdges();

    previousNodesRef.current = getAllUpstreamNodes(nodeId, edges, nodes);
    return previousNodesRef.current;
  }, [nodeId, getNodes, getEdges, edgeCount, storeVersion]);

  const incomingEdgeCount = useMemo(() => {
    if (!nodeId) return 0;
    return getEdges().filter((edge) => edge.target === nodeId).length;
  }, [nodeId, getEdges, edgeCount]);

  // State for selected previous node and auth modal
  const [showAuth, setShowAuth] = useState(false);
  const [selectedPrevNodeId, setSelectedPrevNodeId] = useState<string>("");
  const [canStepNext, setCanStepNext] = useState(true);
  const [canStepPrevious, setCanStepPrevious] = useState(true);

  // Initialize selectedPrevNodeId when previousNodes change
  useEffect(() => {
    if (previousNodes.length > 0 && !selectedPrevNodeId) {
      setSelectedPrevNodeId(previousNodes[0].id);
    }
  }, [previousNodes, selectedPrevNodeId]);

  // Get selected previous node
  const selectedPrevNode =
    previousNodes.find((n) => n.id === selectedPrevNodeId) || previousNodes[0];

  // Extract selectedInputData prioritizing execution store data
  const selectedInputData = selectedPrevNode?.data?.output ?? {};

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
  });

  // Credentials and options
  const credentialsHook = useNodeCredentials({
    definition,
    fieldState: fieldStateHook.fieldState,
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
    previousNodes,
    selectedInputData,
    setLastOutput: outputHook.setLastOutput,
    overrideOutput: outputHook.isPinned ? outputHook.displayedData : null,
    workflowId,
  });

  // References (drag-drop and previews)
  const referencesHook = useNodeReferences({
    fieldState: fieldStateHook.fieldState,
    previousNodes,
    selectedPrevNodeId,
    selectedPrevNode,
  });

  // Auto-execution (sets up event listeners, no return value)
  useNodeAutoExecution({
    nodeId,
    definition,
    handleSubmit: executionHook.handleSubmit,
    executionStore,
  });

  // Get auth context for API calls
  const { session } = useAuth();

  // Check if node is in test listening mode - ONLY trust execution store, not stale output status
  const isTestListening = useMemo(() => {
    const nodeData = nodeId ? executionStore.getNodeData(nodeId) : null;
    return nodeData?.isTestListening === true;
  }, [nodeId, executionStore, storeVersion]);

  const isStreamPaused = useMemo(() => {
    const nodeData = nodeId ? executionStore.getNodeData(nodeId) : null;
    return nodeData?.isStreamPaused === true;
  }, [nodeId, executionStore, storeVersion]);

  const hasStreamCursor = useMemo(() => {
    const nodeData = nodeId ? executionStore.getNodeData(nodeId) : null;
    return typeof nodeData?.lastStreamEntryId === "string";
  }, [nodeId, executionStore, storeVersion]);

  useEffect(() => {
    if (!hasStreamCursor) {
      setCanStepNext(true);
      setCanStepPrevious(true);
    }
  }, [hasStreamCursor]);

  // Handle stop listening - calls the stop-listen-stream endpoint
  const handleStopListening = useCallback(async () => {
    if (!workflowId || !nodeId || readOnly) return;

    try {
      console.log(
        `🛑 [BaseNode] Stopping test listener for ${workflowId}:${nodeId}`,
      );

      const response = await apiClient.post(
        "/stream/unregister",
        {
          workflowId,
          node_id: nodeId,
        },
        session?.access_token,
      );

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
          isTestListening: false,
          isStreamPaused: false,
          isStreamStepping: false,
        });
        notifyStoreUpdate(); // Trigger re-render to hide streaming footer
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    output: stoppedOutput,
                    isTestListening: false,
                    isStreamPaused: false,
                    isStreamStepping: false,
                  },
                }
              : n,
          ),
        );
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
    outputHook,
    executionStore,
    setNodes,
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
          ? (typeof stepBody?.hasPrevious === "boolean"
              ? stepBody.hasPrevious
              : undefined)
          : (typeof stepBody?.hasNext === "boolean" ? stepBody.hasNext : undefined);
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
    selectedPrevNodeId,
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
    isTestListening,
    isStreamPaused,
    hasStreamCursor,
    canStepNext,
    canStepPrevious,
    fetchCredentials: credentialsHook.fetchCredentials,
    fetchDependentOptions: credentialsHook.fetchDependentOptions,
    // Style constants
    referenceStyle: referencesHook.referenceStyle,
  };

  return <>{children(renderProps)}</>;
};

export default BaseNode;
