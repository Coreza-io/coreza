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
import NodeRouter from "@/components/nodes/NodeRouter";
import { nodeManifest } from "@/nodes/manifest";

// Dynamically create nodeTypes from nodeManifest
const nodeTypes = Object.fromEntries(
  Object.keys(nodeManifest).map((nodeType) => [nodeType, NodeRouter])
);

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
      definition: nodeManifest.FinnHub
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
  const [loading, setLoading] = useState(false);
  const [isPaletteVisible, setIsPaletteVisible] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string; name: string } | null>(null);
  const [executingNode, setExecutingNode] = useState<string | null>(null);
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({
      ...params,
      type: 'removable',
      animated: false, // Only animate during execution
    }, eds)),
    [setEdges],
  );

  // Execute a node and animate outgoing edges
  const executeNode = useCallback((nodeId: string) => {
    setExecutingNode(nodeId);
    
    // Find all edges coming out of this node
    const outgoingEdges = edges.filter(edge => edge.source === nodeId);
    
    // Animate the outgoing edges
    setEdges(currentEdges => 
      currentEdges.map(edge => 
        outgoingEdges.some(outEdge => outEdge.id === edge.id)
          ? { ...edge, animated: true, className: 'animated' }
          : edge
      )
    );
    
    // Simulate execution time
    setTimeout(() => {
      setExecutingNode(null);
      // Stop animation
      setEdges(currentEdges => 
        currentEdges.map(edge => 
          outgoingEdges.some(outEdge => outEdge.id === edge.id)
            ? { ...edge, animated: false, className: '' }
            : edge
        )
      );
    }, 2000);
  }, [edges, setEdges]);

  // Handle node double click to execute
  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    executeNode(node.id);
  }, [executeNode]);

  // Save workflow to Supabase
  const handleSaveWorkflow = async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "Please log in to save workflows",
        variant: "destructive",
      });
      return;
    }
    
    setLoading(true);

    // 1) Turn each node into a "minimal" version without its definition
    const minimalNodes = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      sourcePosition: n.sourcePosition,
      targetPosition: n.targetPosition,
      // ONLY keep the user's inputs + last output (or whatever you actually need)
      values: n.data.values
    }));

    const payload = {
      user_id: user.id,
      name: workflowName,
      nodes: JSON.parse(JSON.stringify(minimalNodes)) as any,
      edges: JSON.parse(JSON.stringify(edges)) as any,
      updated_at: new Date().toISOString(),
    };
    console.log("payload", payload);

    if (workflowId) {
      const { error } = await supabase
        .from("workflows")
        .update(payload)
        .eq("id", workflowId);
      setLoading(false);
      if (!error) {
        toast({
          title: "Success",
          description: "Workflow updated!",
        });
      } else {
        toast({
          title: "Error",
          description: "Error saving workflow: " + error.message,
          variant: "destructive",
        });
      }
    } else {
      const { data, error } = await supabase
        .from("workflows")
        .insert([payload])
        .select()
        .single();
      setLoading(false);
      if (data) {
        setWorkflowId(data.id);
        toast({
          title: "Success",
          description: "Workflow saved!",
        });
      } else {
        toast({
          title: "Error",
          description: "Error saving: " + error.message,
          variant: "destructive",
        });
      }
    }
  };

  const handleActivate = async () => {
    if (!user || !workflowId) return;
    
    try {
      setIsActive(!isActive);
      
      // If workflow is saved, update the active status in database
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

      const nodeDefinition = nodeManifest[type];
      
      const newNode: Node = {
        id: `${type}-${Date.now()}`,
        type,
        position,
        data: { 
          label: nodeDefinition?.name || `${type} node`,
          definition: nodeDefinition
        },
      };
      
      setNodes((nds) => nds.concat(newNode));
    },
    [setNodes],
  );

  // Check for user authentication and load latest workflow
  useEffect(() => {
    const checkUserAndLoadWorkflow = async () => {
      const userEmail = localStorage.getItem('userEmail');
      const userId = localStorage.getItem('userId');
      const userName = localStorage.getItem('userName');
      
      if (userEmail && userId && userName) {
        const userObj = { id: userId, email: userEmail, name: userName };
        setUser(userObj);
        
        // Load workflow - either latest for new workflow or specific existing workflow
        if (isNewWorkflow) {
          // Auto-load latest workflow if this is a new workflow
          setLoading(true);
          try {
            const { data, error } = await supabase
              .from("workflows")
              .select("*")
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();

            if (data && !error) {
              setWorkflowId(data.id);
              setWorkflowName(data.name || "Untitled Workflow");
              setIsActive(!!data.is_active);
              
              // Load nodes and edges
              if (data.nodes && Array.isArray(data.nodes)) {
                // Restore node definitions from manifest when loading from database
                const restoredNodes = (data.nodes as unknown as Node[]).map(node => ({
                  ...node,
                  data: {
                    ...node.data,
                    definition: node.data?.definition || nodeManifest[node.type as keyof typeof nodeManifest]
                  }
                }));
                setNodes(restoredNodes);
              }
              if (data.edges && Array.isArray(data.edges)) {
                setEdges(data.edges as unknown as Edge[]);
              }
              
              // Update URL without page reload
              window.history.replaceState(null, '', `/workflow/${data.id}`);
            }
          } catch (error) {
            console.error("Error loading latest workflow:", error);
          }
          setLoading(false);
        } else if (workflowId) {
          // Load specific existing workflow
          setLoading(true);
          try {
            const { data, error } = await supabase
              .from("workflows")
              .select("*")
              .eq("id", workflowId)
              .eq("user_id", userId)
              .single();

            if (data && !error) {
              setWorkflowName(data.name || "Untitled Workflow");
              setIsActive(!!data.is_active);
              
              // Load nodes and edges
              if (data.nodes && Array.isArray(data.nodes)) {
                // Restore node definitions from manifest when loading from database
                const restoredNodes = (data.nodes as unknown as Node[]).map(node => ({
                  ...node,
                  data: {
                    ...node.data,
                    definition: node.data?.definition || nodeManifest[node.type as keyof typeof nodeManifest]
                  }
                }));
                setNodes(restoredNodes);
              }
              if (data.edges && Array.isArray(data.edges)) {
                setEdges(data.edges as unknown as Edge[]);
              }
            } else {
              console.error("Workflow not found or access denied");
              navigate('/workflows');
            }
          } catch (error) {
            console.error("Error loading workflow:", error);
            navigate('/workflows');
          }
          setLoading(false);
        }
      } else {
        // Redirect to login if no user found
        navigate('/login');
      }
    };
    
    checkUserAndLoadWorkflow();
  }, [navigate, isNewWorkflow, workflowId, setNodes, setEdges]);

  // Persist workflow state to localStorage
  useEffect(() => {
    if (workflowId && nodes.length > 0) {
      const workflowState = {
        id: workflowId,
        name: workflowName,
        nodes,
        edges,
        isActive,
        lastSaved: new Date().toISOString()
      };
      localStorage.setItem(`workflow_${workflowId}`, JSON.stringify(workflowState));
    }
  }, [workflowId, workflowName, nodes, edges, isActive]);

  // Load persisted workflow state on page refresh
  useEffect(() => {
    if (workflowId && !isNewWorkflow) {
      const persistedState = localStorage.getItem(`workflow_${workflowId}`);
      if (persistedState) {
        try {
          const state = JSON.parse(persistedState);
          setWorkflowName(state.name || "Untitled Workflow");
          setIsActive(!!state.isActive);
          if (state.nodes && state.nodes.length > 0) {
            // Restore node definitions from manifest when loading from localStorage
            const restoredNodes = state.nodes.map((node: any) => ({
              ...node,
              data: {
                ...node.data,
                definition: node.data?.definition || nodeManifest[node.type as keyof typeof nodeManifest]
              }
            }));
            setNodes(restoredNodes);
          }
          if (state.edges) {
            setEdges(state.edges);
          }
        } catch (error) {
          console.error("Error loading persisted workflow state:", error);
        }
      }
    }
  }, [workflowId, isNewWorkflow, setNodes, setEdges]);

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
              onClick={handleSaveWorkflow}
              disabled={loading}
              variant="outline"
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? "Saving..." : "Save"}
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
            onNodeDoubleClick={onNodeDoubleClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            className="workflow-canvas"
            style={{ backgroundColor: 'hsl(var(--trading-grid))' }}
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
