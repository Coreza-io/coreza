import { useState, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import {
  ReactFlow,
  addEdge,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Save, Play, Pause, Settings, Search } from "lucide-react";
import { motion } from "framer-motion";
import { NodePalette } from "@/components/workflow/NodePalette";
import { RemovableEdge } from "@/components/workflow/RemovableEdge";

// Import node types
import GenericNode from "@/components/nodes/GenericNode";
import { nodeManifest } from "@/nodes/manifest";

// Create node types dynamically from manifest
const nodeTypes = nodeManifest.reduce((acc, node) => {
  acc[node.config.node_type] = GenericNode;
  return acc;
}, {} as Record<string, any>);

const edgeTypes = {
  removable: RemovableEdge,
};

// Initial nodes for demonstration
const initialNodes: Node[] = [
  {
    id: 'hello-node',
    type: 'finnhub',
    position: { x: 100, y: 100 },
    data: { 
      label: 'Welcome to Coreza!',
      config: nodeManifest.find(n => n.config.node_type === 'finnhub')?.config
    },
  },
];

const initialEdges: Edge[] = [];

const WorkflowEditor = () => {
  const { id } = useParams();
  const isNewWorkflow = id === 'new' || !id;
  
  const [workflowName, setWorkflowName] = useState(
    isNewWorkflow ? "My workflow 1" : "Existing Workflow"
  );
  const [isActive, setIsActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({
      ...params,
      type: 'removable',
      animated: true,
      style: { stroke: 'hsl(217 91% 60%)' }
    }, eds)),
    [setEdges],
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // TODO: Save to Supabase
      const workflowData = {
        name: workflowName,
        nodes: nodes.map(node => ({
          id: node.id,
          type: node.type,
          position: node.position,
          data: node.data
        })),
        edges: edges.map(edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle
        }))
      };
      console.log("Saving workflow:", workflowData);
      
      // Simulate save delay
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Failed to save workflow:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleActivate = async () => {
    try {
      // TODO: Activate workflow via API
      console.log("Activating workflow:", workflowName);
      setIsActive(!isActive);
    } catch (error) {
      console.error("Failed to activate workflow:", error);
    }
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = {
        x: event.clientX - 250, // Adjust for sidebar width
        y: event.clientY - 100,  // Adjust for header height
      };

      const nodeConfig = nodeManifest.find(n => n.config.node_type === type);
      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: { 
          label: nodeConfig?.config.name || `${type} node`,
          config: nodeConfig?.config
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes],
  );

  // Handle delete key to remove selected nodes
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        setNodes((nds) => nds.filter((node) => !node.selected));
        setEdges((eds) => eds.filter((edge) => !edge.selected));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setNodes, setEdges]);

  return (
    <div className="flex h-[calc(100vh-6rem)] w-full">
      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col">
        {/* Workflow Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-4">
            <Input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="text-lg font-semibold bg-transparent border-none p-0 h-auto focus-visible:ring-0"
              placeholder="Workflow name"
            />
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? "Active" : "Draft"}
            </Badge>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              variant="outline"
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? "Saving..." : "Save"}
            </Button>
            <Button
              onClick={handleActivate}
              className={isActive ? "bg-warning hover:bg-warning/90" : "bg-success hover:bg-success/90"}
            >
              {isActive ? (
                <>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Activate
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ReactFlow Canvas */}
        <div className="flex-1 bg-trading-grid">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            className="workflow-canvas"
            style={{ backgroundColor: 'hsl(var(--trading-grid))' }}
          >
            <Background 
              variant={BackgroundVariant.Dots} 
              gap={20} 
              size={1}
              color="hsl(var(--border))"
            />
            <MiniMap 
              className="!bg-card !border-border"
              maskColor="hsl(var(--muted) / 0.6)"
            />
            <Controls 
              className="!bg-card !border-border [&>button]:!bg-transparent [&>button]:!border-border hover:[&>button]:!bg-muted"
            />
          </ReactFlow>
        </div>
      </div>

      {/* Right Sidebar - Node Palette */}
      <motion.div
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="w-80 border-l border-border bg-sidebar"
      >
        <NodePalette />
      </motion.div>
    </div>
  );
};

export default WorkflowEditor;