/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import React, { useEffect, useMemo } from "react";
import type { Node } from "@xyflow/react";
import { getAllUpstreamNodes } from "./getAllUpstreamNodes";
import DraggableFieldsPanel from "./DraggableFieldsPanel";
import { useReactFlow } from "@xyflow/react";
import { summarizePreview } from "@/utils/preview";
import { useUserPreferences } from "@/contexts/UserPreferencesContext";

type NodeExecutionLog = {
  nodeId: string;
  nodeName: string;
  output?: any;
  input?: any;
};

type InputPanelProps = {
  nodeId?: string;
  nodes: Node<any>[];
  edges: any[];
  isExpanded: boolean;
  handleDragStart?: (
    e: React.DragEvent,
    keyPath: string,
    value: string
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
  // Always call hooks unconditionally (React rules), but use conditionally
  const reactFlowContext = useReactFlow();
  const { timezone: userTimezone } = useUserPreferences();

  // Get fresh node/edge data on every render (only in editor mode)
  const nodes = readOnly
    ? initialNodes
    : reactFlowContext.getNodes() || initialNodes;
  const edges = readOnly
    ? initialEdges
    : reactFlowContext.getEdges() || initialEdges;

  // Upstream nodes with fresh data
  const previousNodes = useMemo(() => {
    if (!nodeId || !nodes || !edges) return [];
    return getAllUpstreamNodes(nodeId, edges, nodes);
  }, [nodeId, nodes, edges]);

  // Prefer a direct 'done' edge source when connected (Loop aggregated output)
  const preferredPrevId = useMemo(() => {
    if (!nodeId || !edges) return undefined;
    const incomingDone = edges.find(
      (e) => e.target === nodeId && e.sourceHandle === "done"
    );
    return incomingDone?.source;
  }, [nodeId, edges]);

  // Set default selected previous node (prefer 'done' source)
  useEffect(() => {
    if (typeof setSelectedPrevNodeId !== "function" || selectedPrevNodeId)
      return;
    if (preferredPrevId) {
      setSelectedPrevNodeId(preferredPrevId);
      return;
    }
    if (previousNodes.length > 0) {
      setSelectedPrevNodeId(previousNodes[0].id);
    }
  }, [
    preferredPrevId,
    previousNodes,
    selectedPrevNodeId,
    setSelectedPrevNodeId,
  ]);

  // Set default selection in readOnly mode
  useEffect(() => {
    if (!readOnly || !allNodeExecutions || selectedPrevNodeId) return;
    if (typeof setSelectedPrevNodeId !== "function") return;

    // Select the first executed node by default
    if (allNodeExecutions.length > 0) {
      setSelectedPrevNodeId(allNodeExecutions[0].nodeId);
    }
  }, [readOnly, allNodeExecutions, selectedPrevNodeId, setSelectedPrevNodeId]);

  // Get outputData - use executionInput directly in readOnly mode
  const outputData = useMemo(() => {
    // In readOnly mode with allNodeExecutions, use selected node's output
    if (readOnly && allNodeExecutions && selectedPrevNodeId) {
      const selectedExec = allNodeExecutions.find(
        (e) => e.nodeId === selectedPrevNodeId
      );
      return selectedExec?.output ?? {};
    }
    // Fallback to executionInput if no selection
    if (readOnly && executionInput !== undefined) {
      return executionInput;
    }
    if (!selectedPrevNodeId) return {};
    const prevNode = nodes.find((n) => n.id === selectedPrevNodeId);
    const result =
      executionStore?.getNodeData(selectedPrevNodeId)?.output ??
      prevNode?.data?.output ??
      prevNode?.data?.input ??
      {};
    return result;
  }, [
    selectedPrevNodeId,
    nodes,
    executionStore,
    readOnly,
    executionInput,
    allNodeExecutions,
  ]);

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
        <div className="text-xs text-muted-foreground">
          {new Date().toLocaleTimeString("en-US", {
            timeZone: userTimezone,
            hour12: false,
          })}{" "}
          {userTimezone}
        </div>
      </div>
      <div className="p-3 h-[calc(100%-42px)] overflow-auto">
        {readOnly ? (
          // In readOnly mode, show dropdown with all executed nodes
          <>
            {allNodeExecutions &&
              allNodeExecutions.length > 0 &&
              setSelectedPrevNodeId && (
                <div className="mb-3">
                  <label className="block text-xs font-semibold mb-2 text-muted-foreground">
                    Previous Node:
                  </label>
                  <select
                    className="w-full border border-border p-2 rounded-md text-xs bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                    value={selectedPrevNodeId || ""}
                    onChange={(e) => setSelectedPrevNodeId(e.target.value)}
                  >
                    <option value="">Select node...</option>
                    {allNodeExecutions.map((exec) => (
                      <option key={exec.nodeId} value={exec.nodeId}>
                        {exec.nodeName || exec.nodeId}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            <div className="mb-2">
              <DraggableFieldsPanel
                data={outputData}
                onDragStart={handleDragStart ?? (() => {})}
              />
            </div>
          </>
        ) : previousNodes.length > 0 ? (
          <>
            {setSelectedPrevNodeId &&
            typeof setSelectedPrevNodeId === "function" ? (
              <div className="mb-3">
                <label className="block text-xs font-semibold mb-2 text-muted-foreground">
                  Previous Node:
                </label>
                <select
                  className="w-full border border-border p-2 rounded-md text-xs bg-background text-foreground focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  value={selectedPrevNodeId || ""}
                  onChange={(e) => setSelectedPrevNodeId(e.target.value)}
                >
                  <option value="">Select node...</option>
                  {previousNodes.map((node: Node<any>) => (
                    <option key={node.id} value={node.id}>
                      {node.id}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="mb-2">
              <DraggableFieldsPanel
                data={outputData}
                onDragStart={handleDragStart ?? (() => {})}
              />
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground italic text-center py-8">
            No previous node connected.
          </div>
        )}
      </div>
    </div>
  );
};

export default InputPanel;
