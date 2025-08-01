import React, { useEffect, useMemo } from "react";
import type { Node } from "@xyflow/react";
import { getAllUpstreamNodes } from "./getAllUpstreamNodes";
import DraggableFieldsPanel from "./DraggableFieldsPanel";
import { useReactFlow } from "@xyflow/react";

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
}) => {
  const { getNodes, getEdges } = useReactFlow();

  // Get fresh node/edge data on every render
  const nodes = getNodes();
  const edges = getEdges();

  // Upstream nodes with fresh data
  const previousNodes = useMemo(() => {
    if (!nodeId || !nodes || !edges) return [];
    return getAllUpstreamNodes(nodeId, edges, nodes);
  }, [nodeId, nodes, edges]);

  // Set first as selected by default if possible and setter present
  useEffect(() => {
    if (
      previousNodes.length > 0 &&
      !selectedPrevNodeId &&
      typeof setSelectedPrevNodeId === "function"
    ) {
      setSelectedPrevNodeId(previousNodes[0].id);
    }
  }, [previousNodes, selectedPrevNodeId, setSelectedPrevNodeId]);

  // Get outputData directly from current node state
  const outputData = useMemo(() => {
    if (!selectedPrevNodeId) return {};
    const prevNode = nodes.find((n) => n.id === selectedPrevNodeId);
    const result = prevNode?.data?.output || prevNode?.data?.input || {};
    return result;
  }, [selectedPrevNodeId, nodes]);

  if (!isExpanded) return null;

  return (
    <div
      className={`absolute ${
        position === "left" ? "right-full top-0 mr-2" : "left-full top-0 ml-2"
      } w-72 h-full z-10 bg-card border border-border rounded-lg shadow-elevated overflow-hidden`}
    >
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <div className="font-semibold text-foreground text-sm tracking-tight">
          Input Data
        </div>
        <div className="text-xs text-muted-foreground">
          {new Date().toLocaleTimeString()}
        </div>
      </div>
      <div className="p-3 h-[calc(100%-42px)] overflow-auto">
        {previousNodes.length > 0 ? (
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