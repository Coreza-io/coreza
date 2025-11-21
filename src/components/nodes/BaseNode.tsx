import React, { useState, useEffect, useMemo } from "react";
import { useNodeId, useNodes, useEdges, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { useAuth } from "@/contexts/AuthContext";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";
// Custom hooks
import { useNodeFieldState } from "@/hooks/useNodeFieldState";
import { useNodeRenaming } from "@/hooks/useNodeRenaming";
import { useNodeReferences } from "@/hooks/useNodeReferences";
import { useNodeCredentials } from "@/hooks/useNodeCredentials";
import { useNodeOutput } from "@/hooks/useNodeOutput";
import { useNodeExecution } from "@/hooks/useNodeExecution";
import { useNodeAutoExecution } from "@/hooks/useNodeAutoExecution";

// Generate de-duplicated labels: "Alpaca", "Alpaca1", "Alpaca2", …
const getDisplayName = (node: Node<any>, allNodes: Node<any>[]) => {
  const baseName = node.data.definition?.name;
  const sameType = allNodes.filter(
    (n) => n && n.data && n.data.definition?.name === baseName
  );
  const idx = sameType.findIndex((n) => n.id === node.id);
  const result = idx > 0 ? `${baseName}${idx}` : baseName;

  return result;
};

interface BaseNodeProps {
  data: any;
  selected: boolean;
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
  fetchCredentials: (fieldKey: string) => void;
  fetchDependentOptions: (field: any, parentValue: string) => void;
  // Style constants
  referenceStyle: React.CSSProperties;
}

const BaseNode: React.FC<BaseNodeProps> = ({ data, selected, children }) => {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const edges = useEdges();
  const executionStore = useExecutionStore();

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
    fetchCredentials: credentialsHook.fetchCredentials,
    fetchDependentOptions: credentialsHook.fetchDependentOptions,
    // Style constants
    referenceStyle: referencesHook.referenceStyle,
  };

  return <>{children(renderProps)}</>;
};

export default BaseNode;
