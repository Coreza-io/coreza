import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
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
import { Save, Play, Pause, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { NodePalette } from "@/components/workflow/NodePalette";
import { RemovableEdge } from "@/components/workflow/RemovableEdge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

// Import node types
import NodeRouter from "@/components/nodes/NodeRouter";
import { nodeManifest } from "@/nodes/manifest";

// Create nodeTypes mapping both by manifest keys AND by node_type values
const nodeTypes = Object.fromEntries([
  // Map by manifest keys (for backward compatibility)
  ...Object.keys(nodeManifest).map((nodeKey) => [nodeKey, NodeRouter]),
  // Map by node_type values (for proper type mapping)
  ...Object.values(nodeManifest).map((nodeDef: any) => [nodeDef.node_type, NodeRouter])
]);

console.log("Available nodeTypes:", Object.keys(nodeTypes));
console.log("NodeManifest keys:", Object.keys(nodeManifest));

const edgeTypes = {
  removable: RemovableEdge,
};

// Initial nodes for demonstration  
const initialNodes: Node[] = [
  {
    id: 'hello-node',
    type: 'FinnHub', // Use the manifest key, not node_type
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user: authUser, loading: authLoading } = useAuth();
  
  // CRITICAL FIX: Make isNewWorkflow reactive to URL changes
  const isNewWorkflow = id === 'new' || !id;
  const projectId = searchParams.get('project'); // Get project ID from URL parameters
  
  const [workflowId, setWorkflowId] = useState<string | null>(isNewWorkflow ? null : id || null);
  
  // CRITICAL FIX: Sync workflowId with URL parameter changes
  useEffect(() => {
    if (!isNewWorkflow && id !== workflowId) {
      console.log("🔄 Syncing workflowId with URL:", { oldWorkflowId: workflowId, newId: id });
      setWorkflowId(id || null);
    }
  }, [id, isNewWorkflow, workflowId]);
  const [workflowName, setWorkflowName] = useState(
    isNewWorkflow ? "My workflow 1" : "Existing Workflow"
  );
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPaletteVisible, setIsPaletteVisible] = useState(true);
  const [executingNode, setExecutingNode] = useState<string | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
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
  const handleSaveWorkflow = async (isAutosave = false) => {
    if (!authUser) {
      if (!isAutosave) {
        toast({
          title: "Error",
          description: "Please log in to save workflows",
          variant: "destructive",
        });
      }
      return;
    }
    
    if (isAutosave) {
      setAutosaveStatus('saving');
    } else {
      setLoading(true);
    }

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
      user_id: authUser.id,
      name: workflowName,
      nodes: JSON.parse(JSON.stringify(minimalNodes)) as any,
      edges: JSON.parse(JSON.stringify(edges)) as any,
      updated_at: new Date().toISOString(),
      ...(projectId && { project_id: projectId }), // Include project_id if available
    };
    console.log("payload", payload);

    if (workflowId) {
      const { error } = await supabase
        .from("workflows")
        .update(payload)
        .eq("id", workflowId);
      if (isAutosave) {
        setAutosaveStatus(error ? 'idle' : 'saved');
        if (!error) {
          setTimeout(() => setAutosaveStatus('idle'), 2000); // Reset after 2 seconds
        }
      } else {
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
      }
    } else {
      const { data, error } = await supabase
        .from("workflows")
        .insert([payload])
        .select()
        .single();
      if (isAutosave) {
        setAutosaveStatus(error ? 'idle' : 'saved');
        if (!error && data) {
          setTimeout(() => setAutosaveStatus('idle'), 2000); // Reset after 2 seconds
        }
      } else {
        setLoading(false);
      }
      if (data) {
        console.log("🎯 Workflow saved, updating state:", {
          oldWorkflowId: workflowId,
          newWorkflowId: data.id,
          oldIsNewWorkflow: isNewWorkflow,
          currentUrl: window.location.pathname
        });
        
        setWorkflowId(data.id);
        
        // CRITICAL FIX: Use React Router's navigate instead of window.history
        // This ensures useParams() updates properly
        const newUrl = projectId 
          ? `/workflow/${data.id}?project=${projectId}`
          : `/workflow/${data.id}`;
        
        navigate(newUrl, { replace: true });
        
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
    if (!authUser || !workflowId) return;
    
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

  // Function to create a new node
  const createNode = useCallback((nodeType: string, position: { x: number; y: number }) => {
    const nodeDefinition = nodeManifest[nodeType];
    
    const newNode: Node = {
      id: `${nodeType}-${Date.now()}`,
      type: nodeType,
      position,
      data: { 
        label: nodeDefinition?.name || `${nodeType} node`,
        definition: nodeDefinition
      },
    };
    
    setNodes((nds) => nds.concat(newNode));
  }, [setNodes]);

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

      createNode(type, position);
    },
    [createNode],
  );

  // Handle node click from palette
  const handleNodeClick = useCallback((nodeType: string) => {
    // Position new node at center of viewport
    const position = {
      x: 250,
      y: 250,
    };
    
    createNode(nodeType, position);
    
    // Optionally hide palette after adding node
    setIsPaletteVisible(false);
  }, [createNode]);

  // Check for user authentication and load latest workflow
  useEffect(() => {
    console.log("🔄 Loading effect triggered:", {
      authLoading,
      authUser: !!authUser,
      isNewWorkflow,
      workflowId,
      currentId: id,
      currentUrl: window.location.pathname
    });
    
    if (authLoading) return; // Wait for auth to finish loading
    
    if (!authUser) {
      // Redirect to login if no user found
      navigate('/login');
      return;
    }

    const loadWorkflow = async () => {
      // Load workflow - either start fresh for new workflow or load specific existing workflow
      if (isNewWorkflow) {
        // For ALL new workflows, start completely fresh
        // Generate smart workflow name based on existing workflows
        setLoading(true);
        try {
          // Get existing workflow names to determine next number
          const { data: existingWorkflows, error } = await supabase
            .from("workflows")
            .select("name")
            .eq("user_id", authUser.id);

          let workflowName = "My workflow 1";
          
          if (!error && existingWorkflows) {
            // Find the highest number in existing "My workflow X" names
            const workflowNumbers = existingWorkflows
              .map(w => w.name)
              .filter(name => name.startsWith("My workflow "))
              .map(name => {
                const match = name.match(/My workflow (\d+)/);
                return match ? parseInt(match[1]) : 0;
              })
              .filter(num => !isNaN(num));

            const maxNumber = workflowNumbers.length > 0 ? Math.max(...workflowNumbers) : 0;
            const nextNumber = maxNumber + 1;
            
            workflowName = projectId ? `New Project Workflow ${nextNumber}` : `My workflow ${nextNumber}`;
          }

          setWorkflowName(workflowName);
        } catch (error) {
          console.error("Error generating workflow name:", error);
          // Fallback to default names
          setWorkflowName(projectId ? "New Project Workflow" : "My workflow 1");
        }
        
        setNodes(initialNodes);
        setEdges(initialEdges);
        setIsActive(false);
        setLoading(false);
      } else if (workflowId) {
        // Load specific existing workflow
        setLoading(true);
        try {
          const { data, error } = await supabase
            .from("workflows")
            .select("*")
            .eq("id", workflowId)
            .eq("user_id", authUser.id)
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
    };
    
    loadWorkflow();
  }, [authUser, authLoading, navigate, isNewWorkflow, workflowId, projectId]); // Use workflowId instead of id to prevent reloads on tab switch


  // Auto-hide palette when clicking outside or on editor
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isPaletteVisible) return;
      
      const target = event.target as Element;
      const palette = document.querySelector('.node-palette-container');
      const toggleButton = document.querySelector('.palette-toggle-button');
      
      if (palette && toggleButton && 
          !palette.contains(target) && 
          !toggleButton.contains(target)) {
        setIsPaletteVisible(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPaletteVisible]);

  // Handle ReactFlow clicks specifically
  const onPaneClick = useCallback(() => {
    if (isPaletteVisible) {
      setIsPaletteVisible(false);
    }
  }, [isPaletteVisible]);

  // Handle delete key to remove selected nodes
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      console.log("Key pressed:", event.key, "Code:", event.code, "Target:", event.target);
      if (event.key === 'Delete') {
        console.log("Delete key pressed - removing selected nodes");
        setNodes((nds) => nds.filter((node) => !node.selected));
        setEdges((eds) => eds.filter((edge) => !edge.selected));
      }
      if (event.key === 'Backspace') {
        console.log("Backspace key pressed but should NOT delete nodes");
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setNodes, setEdges]);

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] w-full">
      {/* Workflow Header - Fixed at top */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-border bg-card/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex flex-col gap-1">
            <Input
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
              className="text-xl font-bold bg-transparent border-none p-0 h-auto focus-visible:ring-0 hover:bg-muted/30 rounded px-2 py-1 transition-colors"
              placeholder="Workflow name"
            />
            <div className="flex items-center gap-2 px-2">
              <Badge 
                variant={isActive ? "default" : "secondary"}
                className="text-xs font-medium"
              >
                {isActive ? "Active" : "Draft"}
              </Badge>
              {autosaveStatus !== 'idle' && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  {autosaveStatus === 'saving' && (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Autosaving...</span>
                    </>
                  )}
                  {autosaveStatus === 'saved' && (
                    <span className="text-success">Saved</span>
                  )}
                </div>
              )}
              {autosaveStatus === 'idle' && !isNewWorkflow && (
                <span className="text-xs text-muted-foreground">
                  Auto-saved
                </span>
              )}
              {autosaveStatus === 'idle' && isNewWorkflow && (
                <span className="text-xs text-muted-foreground">
                  Unsaved
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            onClick={() => handleSaveWorkflow(false)}
            disabled={loading}
            variant="outline"
            className="h-10 px-4 font-medium hover:bg-muted/50 transition-colors"
          >
            <Save className="h-4 w-4 mr-2" />
            {loading ? "Saving..." : "Save"}
          </Button>
          
          <Button
            onClick={handleActivate}
            disabled={loading}
            className="h-10 px-6 font-medium bg-success hover:bg-success/90 text-success-foreground shadow-sm transition-all duration-200"
          >
            <Play className="h-4 w-4 mr-2" />
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>

      {/* Main Content Area - Canvas + Palette */}
      <div className="flex flex-1 overflow-hidden">
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
            onPaneClick={onPaneClick}
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

        {/* Right Sidebar - Node Palette */}
        {isPaletteVisible && (
          <div className="w-80 border-l border-border bg-sidebar node-palette-container flex-shrink-0">
            <NodePalette onNodeClick={handleNodeClick} />
          </div>
        )}
      </div>
      
      {/* Toggle Arrow - positioned relative to main content area */}
      <button
        onClick={() => setIsPaletteVisible(!isPaletteVisible)}
        className={`fixed top-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-l-lg p-2 shadow-lg hover:bg-muted transition-all duration-200 palette-toggle-button ${
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
