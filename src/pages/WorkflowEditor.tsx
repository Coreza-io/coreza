import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
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
import { Save, Play, Pause, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { NodePalette } from "@/components/workflow/NodePalette";
import { RemovableEdge } from "@/components/workflow/RemovableEdge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
  const navigate = useNavigate();
  const { toast } = useToast();
  const isNewWorkflow = id === 'new' || !id;
  
  const [workflowId, setWorkflowId] = useState<string | null>(isNewWorkflow ? null : id || null);
  const [workflowName, setWorkflowName] = useState(
    isNewWorkflow ? "My workflow 1" : "Existing Workflow"
  );
  const [isActive, setIsActive] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPaletteVisible, setIsPaletteVisible] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  
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
    console.log("handleSave function called");
    setIsSaving(true);
    try {
      // For now, using a demo user ID in proper UUID format since we have custom authentication
      // In a real implementation, you'd get this from your custom auth context
      const userId = "550e8400-e29b-41d4-a716-446655440000"; // Valid UUID format for demo
      console.log("Using userId:", userId);
      
      const workflowData = {
        name: workflowName,
        nodes: JSON.parse(JSON.stringify(nodes.map(node => ({
          id: node.id,
          type: node.type,
          position: node.position,
          data: node.data
        })))),
        edges: JSON.parse(JSON.stringify(edges.map(edge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null,
          type: edge.type || null,
          animated: edge.animated || false,
          style: edge.style ? JSON.stringify(edge.style) : null
        })))),
        user_id: userId,
        is_active: isActive
      };

      let result;
      if (workflowId) {
        // Update existing workflow
        result = await supabase
          .from('workflows')
          .update(workflowData)
          .eq('id', workflowId)
          .select()
          .single();
      } else {
        // Create new workflow
        result = await supabase
          .from('workflows')
          .insert([workflowData])
          .select()
          .single();
      }

      if (result.error) {
        console.error('Supabase error details:', JSON.stringify(result.error, null, 2));
        console.error('Error code:', result.error.code);
        console.error('Error message:', result.error.message);
        console.error('Error details:', result.error.details);
        toast({
          title: "Error",
          description: `Database error: ${result.error.message || 'Failed to save workflow. Please try again.'}`,
          variant: "destructive",
        });
        return;
      }

      // Update local state with the saved workflow ID
      if (!workflowId && result.data) {
        setWorkflowId(result.data.id);
        // Update URL without page reload
        window.history.replaceState(null, '', `/workflow-editor/${result.data.id}`);
      }

      toast({
        title: "Success",
        description: "Workflow saved successfully!",
      });

      console.log("Workflow saved successfully:", result.data);
    } catch (error) {
      console.error("Failed to save workflow:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred while saving.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleActivate = async () => {
    try {
      setIsActive(!isActive);
      
      // If workflow is saved, update the active status in database
      if (workflowId) {
        const { error } = await supabase
          .from('workflows')
          .update({ is_active: !isActive })
          .eq('id', workflowId);

        if (error) {
          console.error('Failed to update workflow status:', error);
          // Revert the local state change
          setIsActive(isActive);
          toast({
            title: "Error",
            description: "Failed to update workflow status.",
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Success",
          description: `Workflow ${!isActive ? 'activated' : 'deactivated'} successfully!`,
        });
      }

      console.log("Workflow status changed:", !isActive ? "activated" : "deactivated");
    } catch (error) {
      console.error("Failed to change workflow status:", error);
      // Revert the local state change
      setIsActive(isActive);
      toast({
        title: "Error",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
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

      // Get the ReactFlow wrapper element to calculate relative position
      const reactFlowBounds = event.currentTarget.getBoundingClientRect();
      const position = {
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
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
      {isPaletteVisible && (
        <div className="w-80 border-l border-border bg-sidebar">
          <NodePalette />
        </div>
      )}
      
      {/* Toggle Arrow */}
      <button
        onClick={() => setIsPaletteVisible(!isPaletteVisible)}
        className={`fixed top-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-l-lg p-2 shadow-lg hover:bg-muted transition-all duration-200 ${
          isPaletteVisible ? 'right-80' : 'right-0'
        }`}
      >
        {isPaletteVisible ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
    </div>
  );
};

export default WorkflowEditor;