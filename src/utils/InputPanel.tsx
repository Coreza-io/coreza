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
import { Input } from "@/components/ui/input";
import { useVariableSnapshot } from "@/hooks/useVariableSnapshot";
import type { Node } from "@xyflow/react";
import { getAllUpstreamNodes } from "./getAllUpstreamNodes";
import DraggableFieldsPanel from "./DraggableFieldsPanel";
import { useUserPreferences } from "@/contexts/UserPreferencesContext";
import { useExecutionStoreVersion } from "@/contexts/ExecutionStoreContext";
import { useOptionalSemanticGraphSnapshot } from "@/contexts/StableNodeContext";
import { resolveHistoricalNodeId, resolveLiveInputData, resolvePreviousNodeId } from "./inputPanelSelection";

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
  nodeId?: string;
  nodes: Node<any>[];
  edges: any[];
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
  // All node executions for dropdown in readOnly mode
  allNodeExecutions?: NodeExecutionLog[];
};

const InputPanel: React.FC<InputPanelProps> = ({
  workflowId,
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
  executionInput,
  allNodeExecutions,
}) => {
  // History is intentionally isolated from the live canonical document.
  const canonicalGraph = useOptionalSemanticGraphSnapshot(!readOnly);
  const executionStoreVersion = useExecutionStoreVersion();
  const { timezone: userTimezone } = useUserPreferences();
  const [activeTab, setActiveTab] = useState("previous");
  const [search, setSearch] = useState("");
  const variableQuery = useVariableSnapshot(isExpanded && activeTab === "variables" && !readOnly, workflowId);

  if (!readOnly && !canonicalGraph) {
    throw new Error("Live InputPanel must be used within StableNodeProvider");
  }
  const nodes = readOnly ? initialNodes : canonicalGraph?.nodes ?? initialNodes;
  const edges = readOnly ? initialEdges : canonicalGraph?.edges ?? initialEdges;

  // Upstream nodes with fresh data
  const previousNodes = useMemo(() => {
    if (!nodeId) return [];
    const upstream = readOnly
      ? getAllUpstreamNodes(nodeId, initialEdges, initialNodes)
      : canonicalGraph?.getUpstreamNodes(nodeId) ?? [];
    // Order by graph distance, independent of projected cluster/member array order.
    const incoming = new Map<string, string[]>();
    for (const edge of edges) {
      const sources = incoming.get(edge.target) ?? [];
      sources.push(edge.source);
      incoming.set(edge.target, sources);
    }
    const order = new Map([[nodeId, 0]]);
    const queue = [nodeId];
    for (let i = 0; i < queue.length; i++) {
      for (const source of incoming.get(queue[i]) ?? []) {
        if (order.has(source)) continue;
        order.set(source, order.size);
        queue.push(source);
      }
    }
    return [...upstream].filter(node => node.id !== nodeId).sort((a, b) =>
      (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  }, [canonicalGraph, edges, initialEdges, initialNodes, nodeId, readOnly]);

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

  // Repair stale projected/deleted selections as soon as canonical topology changes.
  useEffect(() => {
    if (readOnly || typeof setSelectedPrevNodeId !== "function") return;
    if (resolvedPrevNodeId !== selectedPrevNodeId) {
      setSelectedPrevNodeId(resolvedPrevNodeId ?? "");
    }
  }, [
    readOnly,
    resolvedPrevNodeId,
    selectedPrevNodeId,
    setSelectedPrevNodeId,
  ]);

  const historicalNodeId = resolveHistoricalNodeId(selectedPrevNodeId, allNodeExecutions ?? []);
  const selectedExecution = allNodeExecutions?.find(exec => exec.nodeId === historicalNodeId);
  const historicalTimestamp = selectedExecution?.completedAt ?? selectedExecution?.startedAt;
  const timestamp = readOnly
    ? historicalTimestamp ? new Date(historicalTimestamp) : undefined
    : new Date();

  useEffect(() => {
    if (readOnly && setSelectedPrevNodeId && selectedPrevNodeId !== (historicalNodeId ?? "")) {
      setSelectedPrevNodeId(historicalNodeId ?? "");
    }
  }, [readOnly, historicalNodeId, selectedPrevNodeId, setSelectedPrevNodeId]);

  // Get outputData - use executionInput directly in readOnly mode
  const outputData = useMemo(() => {
    void executionStoreVersion;
    if (readOnly) {
      if (selectedExecution) return owns(selectedExecution, "output") ? selectedExecution.output : {};
      return executionInput !== undefined ? executionInput : {};
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
    executionStoreVersion,
    readOnly,
    executionInput,
    selectedExecution,
  ]);

  const nodeOptions = readOnly
    ? (allNodeExecutions ?? []).map(exec => ({ id: exec.nodeId, label: exec.nodeName || exec.nodeId }))
    : previousNodes.map(node => ({ id: node.id, label: nodeDisplayName(node) }));
  const query = search.trim().toLowerCase();
  const matchingNodes = nodeOptions.filter(node =>
    node.label.toLowerCase().includes(query) || node.id.toLowerCase().includes(query));
  const selectedId = readOnly ? historicalNodeId : resolvedPrevNodeId;
  const selectedOption = nodeOptions.find(node => node.id === selectedId);

  if (!isExpanded) return null;

  return (
    <div
      onDoubleClick={(e) => e.stopPropagation()}
      className={`absolute ${
        position === "left" ? "right-full top-0 mr-2" : "left-full top-0 ml-2"
      } w-72 h-full z-10 bg-card border border-border rounded-lg shadow-elevated overflow-hidden`}
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
        <TabsList aria-label="Input data source" className="grid w-full grid-cols-2 mb-3">
          <TabsTrigger value="previous">Previous Node</TabsTrigger>
          <TabsTrigger value="variables">Variables</TabsTrigger>
        </TabsList>
        <TabsContent value="previous">
          {nodeOptions.length > 0 && setSelectedPrevNodeId && (
            <div className="mb-3 space-y-2">
              <Input
                type="search"
                aria-label="Search previous nodes"
                placeholder="Search nodes..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 text-xs"
              />
              <select
                aria-label={readOnly ? "Select executed node" : "Select previous node"}
                className="w-full border border-border p-2 rounded-md text-xs bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                value={selectedId || ""}
                onChange={e => setSelectedPrevNodeId(e.target.value)}
              >
                <option value="">Select node...</option>
                {selectedOption && !matchingNodes.some(node => node.id === selectedId) && (
                  <option value={selectedOption.id} hidden>{selectedOption.label}</option>
                )}
                {matchingNodes.map(node => (
                  <option key={node.id} value={node.id}>{node.label}</option>
                ))}
              </select>
              {matchingNodes.length === 0 && (
                <p className="text-xs text-muted-foreground">No matching nodes.</p>
              )}
            </div>
          )}
          {readOnly && nodeOptions.length === 0 ? (
            <div className="text-sm text-muted-foreground italic text-center py-8">
              No node execution details available for this run.
            </div>
          ) : readOnly || previousNodes.length > 0 ? (
            <DraggableFieldsPanel
              data={outputData}
              persistentVariableKeys={outputData?.success === true && outputData?.status === "success" ? outputData?.meta?.persistentVariableKeys : undefined}
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
            <p role="alert" className="text-xs text-destructive">Unable to load workflow variables.</p>
          ) : variableQuery.data?.entries.length ? (
            <DraggableFieldsPanel
              data={variableQuery.data.values}
              variableNamespace
              sourceNodeId={nodeId}
              onDragStart={handleDragStart ?? (() => {})}
            />
          ) : (
            <p className="text-xs text-muted-foreground">No workflow variables saved yet. Execute a Persistent Edit Fields node to create them.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default InputPanel;
