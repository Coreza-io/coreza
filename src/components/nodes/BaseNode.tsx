/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNodeId, useNodes, useEdges, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { useParams } from "react-router-dom";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { useAuth } from "@/contexts/AuthContext";
import { useExecutionStore, useExecutionStoreVersion, useExecutionStoreNotify } from "@/contexts/ExecutionStoreContext";
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
    currentValue: string
  ) => void;
  handleDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  getFieldPreview: (fieldKey: string) => string | null;
  setShowAuth: (show: boolean) => void;
  setSelectedPrevNodeId: (id: string) => void;
  handlePanelSave: (newData: any) => void;
  handlePanelPinToggle: () => void;
  handleStopListening: () => void;
  isTestListening: boolean;
  fetchCredentials: (fieldKey: string) => void;
  fetchDependentOptions: (field: any, parentValue: string) => void;
  // Style constants
  referenceStyle: React.CSSProperties;
}

const BaseNode: React.FC<BaseNodeProps> = ({
  data,
  selected,
  readOnly,
  children,
}) => {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const edges = useEdges();
  const executionStore = useExecutionStore();
  const storeVersion = useExecutionStoreVersion(); // Subscribe to store updates
  const notifyStoreUpdate = useExecutionStoreNotify(); // Trigger re-render on manual updates
  const { id: workflowId } = useParams();

  const definition = data.definition;
  const displayName = useMemo(() => {
    // Use custom displayName if available, otherwise generate with deduplication
    if (data.displayName && data.displayName.trim()) {
      return data.displayName;
    }
    return getDisplayName({ id: nodeId!, data } as Node<any>, nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, definition?.name, nodeId, data.displayName]);

  // Get upstream nodes
  const previousNodes = useMemo(() => {
    if (!nodeId || !nodes || !edges) return [];
    return getAllUpstreamNodes(nodeId, edges, nodes);
  }, [nodeId, nodes, edges]);

  // State for selected previous node and auth modal
  const [showAuth, setShowAuth] = useState(false);
  const [selectedPrevNodeId, setSelectedPrevNodeId] = useState<string>("");

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
    handleChange: fieldStateHook.handleChange,
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
  const { setNodes } = useReactFlow();

  // Check if node is in test listening mode - ONLY trust execution store, not stale output status
  const isTestListening = useMemo(() => {
    const nodeData = nodeId ? executionStore.getNodeData(nodeId) : null;
    // Only use execution store flag - displayedData.status can be stale from previous sessions
    return nodeData?.isTestListening === true;
  }, [nodeId, executionStore, storeVersion]); // Include storeVersion to re-compute when store updates

  // Handle stop listening - calls the stop-listen-stream endpoint
  const handleStopListening = useCallback(async () => {
    if (!workflowId || !nodeId || readOnly) return;
    
    try {
      console.log(`🛑 [BaseNode] Stopping test listener for ${workflowId}:${nodeId}`);
      
      const response = await apiClient.post(
        "/market/stop-listen-stream",
        {
          workflow_id: workflowId,
          node_id: nodeId,
        },
        session?.access_token
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
                  },
                }
              : n
          )
        );
        console.log(`✅ [BaseNode] Test listener stopped successfully`);
      }
    } catch (error) {
      console.error("Failed to stop test listener:", error);
    }
  }, [workflowId, nodeId, readOnly, session?.access_token, outputHook, executionStore, setNodes, notifyStoreUpdate]);

  // ========== Combine All Props ==========

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
    isTestListening,
    fetchCredentials: credentialsHook.fetchCredentials,
    fetchDependentOptions: credentialsHook.fetchDependentOptions,
    // Style constants
    referenceStyle: referencesHook.referenceStyle,
  };

  return <>{children(renderProps)}</>;
};

export default BaseNode;
