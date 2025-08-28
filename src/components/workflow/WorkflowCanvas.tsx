import React, { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Connection,
  BackgroundVariant,
  MiniMap,
  Controls,
  Background,
  ConnectionLineType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { NodePalette } from "@/components/workflow/NodePalette";
import EdgeManager from "@/components/workflow/EdgeManager";
import { LoopNode, LoopNodeData } from "@/components/workflow/LoopNode";
import NodeRouter from "@/components/nodes/NodeRouter";
import { nodeManifest } from "@/nodes/manifest";

interface WorkflowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (nodes: Node[]) => void;
  onEdgesChange: (edges: Edge[]) => void;
  onConnect: (connection: Connection) => void;
  onNodeDoubleClick?: (event: React.MouseEvent, node: Node) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onNodeClick: (nodeType: string) => void;
  isPaletteVisible: boolean;
  onTogglePalette: () => void;
  className?: string;
  disabled?: boolean;
}

// Base node type mapping (excluding custom Loop node)
const baseNodeTypes = Object.fromEntries([
  ...Object.keys(nodeManifest)
    .filter((nodeKey) => nodeKey !== 'Loop')
    .map((nodeKey) => [nodeKey, NodeRouter]),
  ...Object.values(nodeManifest).map((nodeDef: any) => [nodeDef.node_type, NodeRouter])
]);

const edgeTypes = {
  default: EdgeManager.SelfLoopEdge,
  loop: EdgeManager.LoopEdge,
  removable: EdgeManager.DefaultEdge,
};

export const WorkflowCanvas: React.FC<WorkflowCanvasProps> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeDoubleClick,
  onDrop,
  onDragOver,
  onNodeClick,
  isPaletteVisible,
  onTogglePalette,
  className,
  disabled = false,
}) => {
  const removeEdgeCallbackRef = useRef<(edgeId: string) => void>();

  // Initialize remove edge callback
  const removeEdge = useCallback((edgeId: string) => {
    onEdgesChange(edges.filter(e => e.id !== edgeId));
  }, [onEdgesChange, edges]);

  useEffect(() => {
    removeEdgeCallbackRef.current = removeEdge;
  }, [removeEdge]);

  // Handle loop node operations
  const handleAddNode = useCallback((loopNodeId: string) => {
    const loopNode = nodes.find(n => n.id === loopNodeId);
    if (!loopNode) return;

    const position = {
      x: loopNode.position.x + 200,
      y: loopNode.position.y
    };

    const newNode: Node = {
      id: `node_${Date.now()}`,
      type: 'default',
      position,
      data: { label: 'New Node' },
    };

    onNodesChange([...nodes, newNode]);

    const edgeId = `edge_${loopNodeId}_${newNode.id}`;
    const newEdge: Edge = {
      id: edgeId,
      source: loopNodeId,
      sourceHandle: 'done',
      target: newNode.id,
      type: 'removable',
      data: { onRemoveEdge: () => removeEdgeCallbackRef.current?.(edgeId) },
    };

    onEdgesChange([...edges, newEdge]);
  }, [nodes, edges, onNodesChange, onEdgesChange]);

  const handleRemoveLoop = useCallback((loopNodeId: string) => {
    const filteredEdges = edges.filter(e => e.source !== loopNodeId && e.target !== loopNodeId);
    onEdgesChange(filteredEdges);
  }, [edges, onEdgesChange]);

  // Merge base node types with custom Loop node
  const nodeTypes = React.useMemo(() => ({
    ...baseNodeTypes,
    Loop: (props: any) => (
      <LoopNode
        {...props}
        data={{ ...(props.data as LoopNodeData), onAddNode: handleAddNode }}
      />
    ),
  }), [handleAddNode]);

  const handleConnect = useCallback((params: Connection) => {
    const id = `edge_${Date.now()}`;
    const newEdge: Edge = {
      id,
      ...params,
      type: 'removable',
      data: { onRemoveEdge: () => removeEdgeCallbackRef.current?.(id) },
    };
    onConnect(params);
  }, [onConnect]);

  const onPaneClick = useCallback(() => {
    if (isPaletteVisible) {
      onTogglePalette();
    }
  }, [isPaletteVisible, onTogglePalette]);

  return (
    <div className={`flex flex-1 overflow-hidden ${className || ''}`}>
      {/* ReactFlow Canvas */}
      <div className="flex-1 bg-trading-grid relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes) => {
            // Convert React Flow changes to direct node updates
            let updatedNodes = [...nodes];
            const removedNodeIds: string[] = [];
            
            changes.forEach(change => {
              if (change.type === 'position' && change.position) {
                const index = updatedNodes.findIndex(n => n.id === change.id);
                if (index >= 0) {
                  updatedNodes[index] = { ...updatedNodes[index], position: change.position };
                }
              } else if (change.type === 'select') {
                const index = updatedNodes.findIndex(n => n.id === change.id);
                if (index >= 0) {
                  updatedNodes[index] = { ...updatedNodes[index], selected: change.selected };
                }
              } else if (change.type === 'remove') {
                removedNodeIds.push(change.id);
                updatedNodes = updatedNodes.filter(n => n.id !== change.id);
              }
            });
            
            // Clean up edges connected to removed nodes
            if (removedNodeIds.length > 0) {
              const filteredEdges = edges.filter(edge => 
                !removedNodeIds.includes(edge.source) && !removedNodeIds.includes(edge.target)
              );
              onEdgesChange(filteredEdges);
            }
            
            onNodesChange(updatedNodes);
          }}
          onEdgesChange={(changes) => {
            // Convert React Flow changes to direct edge updates
            let updatedEdges = [...edges];
            changes.forEach(change => {
              if (change.type === 'select') {
                const index = updatedEdges.findIndex(e => e.id === change.id);
                if (index >= 0) {
                  updatedEdges[index] = { ...updatedEdges[index], selected: change.selected };
                }
              } else if (change.type === 'remove') {
                updatedEdges = updatedEdges.filter(e => e.id !== change.id);
              }
            });
            onEdgesChange(updatedEdges);
          }}
          onConnect={handleConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
          className="workflow-canvas"
          style={{ backgroundColor: 'hsl(var(--trading-grid))' }}
          nodesDraggable={!disabled}
          nodesConnectable={!disabled}
          elementsSelectable={!disabled}
          panOnDrag={!disabled}
          zoomOnScroll={!disabled}
          selectNodesOnDrag={!disabled}
        >
          <Background 
            variant={BackgroundVariant.Dots} 
            gap={16} 
            size={0.8}
            color="hsl(var(--muted-foreground) / 0.60)"
          />
          <MiniMap 
            className="!bg-card !border-border"
            maskColor="hsl(var(--muted) / 0.6)"
          />
          <Controls 
            className="!bg-card !border-border [&>button]:!bg-transparent [&>button]:!border-border hover:[&>button]:!bg-muted"
          />
        </ReactFlow>

        {/* Execution Status Overlay */}
        <AnimatePresence>
          {disabled && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-50"
            >
              <div className="bg-card border rounded-lg p-6 shadow-lg">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="h-4 w-4 bg-primary rounded-full animate-pulse" />
                  <span className="font-medium">Workflow Executing...</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right Sidebar - Node Palette */}
      <AnimatePresence>
        {isPaletteVisible && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="border-l border-border bg-sidebar node-palette-container flex-shrink-0 overflow-hidden"
          >
            <NodePalette onNodeClick={onNodeClick} />
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Toggle Arrow */}
      <motion.button
        onClick={onTogglePalette}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={`fixed top-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-l-lg p-2 shadow-lg hover:bg-muted transition-all duration-200 palette-toggle-button ${
          isPaletteVisible ? 'right-80' : 'right-0'
        }`}
        style={{
          right: isPaletteVisible ? '320px' : '0px',
        }}
      >
        {isPaletteVisible ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        )}
      </motion.button>
    </div>
  );
};