import { nodeDisplayName } from "@/domain/nodeNaming";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NodeInputSelector from "./NodeInputSelector";
import { useVariableSnapshot } from "@/hooks/useVariableSnapshot";
import type { Node } from "@xyflow/react";
import type { SemanticNode } from "@/contexts/canonicalGraphStore";
import DraggableFieldsPanel from "./DraggableFieldsPanel";
import { useUserPreferences } from "@/contexts/UserPreferencesContext";
import { useExecutionNodeData } from "@/contexts/ExecutionStoreContext";
import { useOptionalTopologyGraphSnapshot } from "@/contexts/StableNodeContext";
import { getPreviousNodes, getUpstreamDistances, resolveLiveInputData, resolvePreviousNodeId } from "./inputPanelSelection";

type NodeExecutionLog = {
  nodeId: string;
  nodeName: string;
  output?: any;
  input?: any;
  completedAt?: string;
  startedAt?: string;
};

const owns = (value: unknown, key: PropertyKey): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, key);

type InputPanelProps = {
  workflowId?: string;
  workflowSessionId?: string;
  nodeId?: string;
  nodes: readonly SemanticNode[];
  edges: readonly any[];
  isExpanded: boolean;
  handleDragStart?: (
    e: React.DragEvent,
    keyPath: string,
    value: string,
  ) => void;
  position?: "left" | "right";
  selectedPrevNodeId?: string;
  setSelectedPrevNodeId?: (id: string) => void;
  executionStore?: any;
  // Read-only mode for execution view
  readOnly?: boolean;
  executionInput?: any;
  // Recorded values are separate from the historical topology used for options.
  allNodeExecutions?: NodeExecutionLog[];
  historyNodes?: readonly SemanticNode[];
  historyEdges?: readonly { source: string; target: string; sourceHandle?: string | null }[];
};

const InputPanel: React.FC<InputPanelProps> = ({
  workflowId,
  workflowSessionId,
  nodeId,
  nodes: initialNodes,
  edges: initialEdges,
  isExpanded,
  handleDragStart,
  position = "left",
  selectedPrevNodeId,
  setSelectedPrevNodeId,
  executionStore,
  readOnly = false,
  allNodeExecutions,
  historyNodes,
  historyEdges,
}) => {
  // History is intentionally isolated from the live canonical document.
  const canonicalGraph = useOptionalTopologyGraphSnapshot(!readOnly);
  const { timezone: userTimezone } = useUserPreferences();
  const [activeTab, setActiveTab] = useState("previous");
  const variableQuery = useVariableSnapshot(isExpanded && activeTab === "variables" && !readOnly, workflowId, workflowSessionId);

  if (!readOnly && !canonicalGraph) {
    throw new Error("Live InputPanel must be used within StableNodeProvider");
  }
  const nodes = readOnly ? historyNodes ?? [] : canonicalGraph?.nodes ?? initialNodes;
  const edges = readOnly ? historyEdges ?? [] : canonicalGraph?.edges ?? initialEdges;

  const distances = useMemo(() => getUpstreamDistances(nodeId, edges), [nodeId, edges]);
  const previousNodes = useMemo(
    () => getPreviousNodes(nodeId, nodes, edges),
    [nodeId, nodes, edges],
  );

  // Prefer a direct 'done' edge source when connected (Loop aggregated output)
  const preferredPrevId = useMemo(() => {
    if (!nodeId || !edges) return undefined;
    const incomingDone = edges.find(
      (e) => e.target === nodeId && e.sourceHandle === "done",
    );
    return incomingDone?.source;
  }, [nodeId, edges]);

  const resolvedPrevNodeId = useMemo(
    () => resolvePreviousNodeId(selectedPrevNodeId, previousNodes, preferredPrevId),
    [preferredPrevId, previousNodes, selectedPrevNodeId],
  );

  // Repair selections against the same upstream options in both modes.
  useEffect(() => {
    if (typeof setSelectedPrevNodeId !== "function") return;
    const nextId = resolvedPrevNodeId ?? "";
    if (nextId !== (selectedPrevNodeId ?? "")) {
      setSelectedPrevNodeId(nextId);
    }
  }, [
    resolvedPrevNodeId,
    selectedPrevNodeId,
    setSelectedPrevNodeId,
  ]);

  const selectedSourceData = useExecutionNodeData(!readOnly && isExpanded ? resolvedPrevNodeId : null);
  const selectedExecution = allNodeExecutions?.find(exec => exec.nodeId === resolvedPrevNodeId);
  const historicalTimestamp = selectedExecution?.completedAt ?? selectedExecution?.startedAt;
  const timestamp = readOnly
    ? historicalTimestamp ? new Date(historicalTimestamp) : undefined
    : new Date();

  // Selecting an unexecuted historical branch must never fall back to editor data.
  const outputData = useMemo(() => {
    void selectedSourceData;
    if (readOnly) {
      return owns(selectedExecution, "output") ? selectedExecution.output : undefined;
    }
    return resolveLiveInputData(
      resolvedPrevNodeId,
      nodes,
      (sourceNodeId) => executionStore?.getNodeData(sourceNodeId),
    );
  }, [
    resolvedPrevNodeId,
    nodes,
    executionStore,
    selectedSourceData,
    readOnly,
    selectedExecution,
  ]);

  const nodeOptions = previousNodes.map(node => ({
    id: node.id,
    label: nodeDisplayName(node),
    distance: distances.get(node.id),
  }));
  const selectedId = resolvedPrevNodeId;

  if (!isExpanded) return null;

  return (
    <div
      onDoubleClick={(e) => e.stopPropagation()}
      className={`absolute ${
        position === "left" ? "right-full top-0 mr-2" : "left-full top-0 ml-2"
      } w-72 h-full z-10 bg-card border border-border rounded-lg shadow-elevated overflow-hidden coreza-expanded-input`}
    >
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <div className="font-semibold text-foreground text-sm tracking-tight">
          Input Data
        </div>
        {timestamp && Number.isFinite(timestamp.getTime()) && <div className="text-xs text-muted-foreground">
          {timestamp.toLocaleTimeString("en-US", {
            timeZone: userTimezone,
            hour12: false,
          })}{" "}
          {userTimezone}
        </div>}
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="nodrag nopan p-3 h-[calc(100%-42px)] overflow-auto">
        <TabsList aria-label="Input data source" className="mb-3 h-9 w-fit justify-start gap-4 rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger value="previous" className="rounded-none border-b-2 border-transparent px-1 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">Previous Node</TabsTrigger>
          <TabsTrigger value="variables" className="rounded-none border-b-2 border-transparent px-1 py-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">Variables</TabsTrigger>
        </TabsList>
        <TabsContent value="previous">
          {nodeOptions.length > 0 && setSelectedPrevNodeId && (
            <div className="mb-3">
              <NodeInputSelector options={nodeOptions} value={selectedId} onChange={setSelectedPrevNodeId} />
            </div>
          )}
          {readOnly && nodeOptions.length === 0 ? (
            <div className="text-sm text-muted-foreground italic text-center py-8">
              {historyNodes && historyEdges ? "No previous node connected." : "The workflow snapshot is unavailable for this run."}
            </div>
          ) : readOnly && !owns(selectedExecution, "output") ? (
            <div className="text-sm text-muted-foreground italic text-center py-8">
              No recorded output for this node in this run.
            </div>
          ) : previousNodes.length > 0 ? (
            <DraggableFieldsPanel
              data={outputData}
              persistentVariableKeys={outputData?.status === "success" ? outputData?.meta?.persistentVariableKeys : undefined}
              onDragStart={handleDragStart ?? (() => {})}
              sourceNodeId={selectedId}
            />
          ) : (
            <div className="text-sm text-muted-foreground italic text-center py-8">
              No previous node connected.
            </div>
          )}
        </TabsContent>
        <TabsContent value="variables">
          {readOnly ? (
            <p className="text-xs text-muted-foreground">Workflow variables are not included in execution history.</p>
          ) : !workflowId ? (
            <p className="text-xs text-muted-foreground">Save the workflow to view its variables.</p>
          ) : variableQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading variables...</p>
          ) : variableQuery.isError ? (
            <p role="alert" className="text-xs text-destructive">{variableQuery.error instanceof Error ? variableQuery.error.message : "Unable to load workflow variables."}</p>
          ) : variableQuery.data?.entries.length ? (
            <DraggableFieldsPanel
              data={variableQuery.data.values}
              variableNamespace
              sourceNodeId={nodeId}
              onDragStart={handleDragStart ?? (() => {})}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No variables in this scope yet. Execute a Persistent Edit Fields node to create them.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default InputPanel;
