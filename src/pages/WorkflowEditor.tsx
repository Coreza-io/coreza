import { useState, useCallback, useEffect, useMemo } from "react";
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
  MarkerType,
  useReactFlow,
  ConnectionLineType,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Save, Play, Pause, ChevronLeft, ChevronRight, Loader2, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { NodePalette } from "@/components/workflow/NodePalette";
import { RemovableEdge } from "@/components/workflow/RemovableEdge";
import { LoopEdge } from "@/components/workflow/LoopEdge";
import { LoopNode, LoopNodeData } from "@/components/workflow/LoopNode";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

// Import node types
import NodeRouter from "@/components/nodes/NodeRouter";
import { nodeManifest } from "@/nodes/manifest";
import { WorkflowExecutor } from "@/utils/workflowExecutor";

// Base node type mapping (excluding custom Loop node)
const baseNodeTypes = Object.fromEntries([
  // Map by manifest keys (skip Loop; it'll use a custom component)
  ...Object.keys(nodeManifest)
    .filter((nodeKey) => nodeKey !== 'Loop')
    .map((nodeKey) => [nodeKey, NodeRouter]),
  // Map by node_type values (for proper type mapping)
  ...Object.values(nodeManifest).map((nodeDef: any) => [nodeDef.node_type, NodeRouter])
]);

//console.log("Available nodeTypes:", Object.keys(nodeTypes));
//console.log("NodeManifest keys:", Object.keys(nodeManifest));

const edgeTypes = {
  removable: RemovableEdge,
  loop: LoopEdge,
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

const WorkflowEditorContent = () => {
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
      //console.log("🔄 Syncing workflowId with URL:", { oldWorkflowId: workflowId, newId: id });
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
  const [isAutoExecuting, setIsAutoExecuting] = useState(false);
  const [executionQueue, setExecutionQueue] = useState<string[]>([]);
  
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const rf = useReactFlow();

  // Handle "+" click on Loop node to add a new downstream node
  const handleAddNode = useCallback(
    (loopNodeId: string) => {
      const position = rf.getNode(loopNodeId)?.position || { x: 0, y: 0 };
      const newNode: Node = {
        id: `node_${Date.now()}`,
        type: 'default',
        position: { x: position.x + 200, y: position.y },
        data: { label: 'New Node' },
      };
      setNodes((ns) => [...ns, newNode]);

      const newEdge: Edge = {
        id: `edge_${loopNodeId}_${newNode.id}`,
        source: loopNodeId,
        sourceHandle: 'done',
        target: newNode.id,
        type: 'removable',
      };
      setEdges((es) => [...es, newEdge]);
    },
    [rf, setNodes, setEdges]
  );

  // Merge base node types with custom Loop node
  const nodeTypes = useMemo(() => ({
    ...baseNodeTypes,
    Loop: (props: any) => (
      <LoopNode
        {...props}
        data={{ ...(props.data as LoopNodeData), onAddNode: handleAddNode }}
      />
    ),
  }), [handleAddNode]);

  // Auto-inject self-loop edges (done -> in)
  useEffect(() => {
    setEdges((es) => {
      const loopNodeIds = nodes.filter((n) => n.type === 'Loop').map((n) => n.id);
      const selfEdges = loopNodeIds.map((id) => ({
        id: `self_${id}`,
        source: id,
        sourceHandle: 'done',
        target: id,
        targetHandle: 'in',
        type: 'loop',
        style: { stroke: '#22c55e', strokeWidth: 3 },
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' },
      }));
      const withoutSelf = es.filter((e) => !e.id.startsWith('self_'));
      const merged = [...withoutSelf];
      selfEdges.forEach((se) => {
        if (!merged.find((e) => e.id === se.id)) merged.push(se);
      });
      return merged;
    });
  }, [nodes, setEdges]);

  const styledEdges = useMemo(() =>
    edges.map(e => {
      if (e.sourceHandle === 'loop') {
        const loopNode = nodes.find(n => n.id === e.source);
        const loopItems = (loopNode?.data?.loopItems as any[]) || [];
        return {
          ...e,
          type: 'loop',
          style: { stroke: '#22c55e', strokeWidth: 3 },
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#22c55e',
          },
          data: {
            ...e.data,
            label: `${loopItems.length} item${loopItems.length > 1 ? 's' : ''}`,
          },
        };
      }
      return e;
    }),
  [edges, nodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({
      ...params,
      type: 'removable',
      animated: false, // Only animate during execution
    }, eds)),
    [setEdges],
  );

  // Memoized WorkflowExecutor instance - only recreate when structure changes
  const workflowExecutor = useMemo(() => {
    if (nodes.length === 0) return null;
    
    return new WorkflowExecutor({
      nodes,
      edges,
      setNodes,
      setEdges,
      setExecutingNode,
      toast
    });
  }, [nodes.length, edges.length, setNodes, setEdges, setExecutingNode, toast]);

  // Execute all nodes with the queue-based WorkflowExecutor
  const executeAllNodes = useCallback(async () => {
    if (!workflowExecutor) {
      toast({
        title: "Error",
        description: "No workflow to execute",
        variant: "destructive",
      });
      return;
    }
    
    setIsAutoExecuting(true);
    await workflowExecutor.executeAllNodes();
    setIsAutoExecuting(false);
  }, [workflowExecutor, toast]);

  // Handle node double click to execute
  // Double click to execute one node only (optional: show highlight/animation)
  const onNodeDoubleClick = useCallback(async (event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    await workflowExecutor.executeNode(node.id, new Set());
  }, [workflowExecutor]);

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
      category: (n.data.definition as any)?.category,
      subCategory: (n.data.definition as any)?.subCategory,
      position: n.position,
      sourcePosition: n.sourcePosition,
      targetPosition: n.targetPosition,
      // ONLY keep the user's inputs + last output (or whatever you actually need)
      values: n.data.values,
      // Save display name information for reference resolution
      //displayName: (n.data.values as any)?.label || (n.data.definition as any)?.name || n.type
    }));

    // Get existing node IDs
    const existingNodeIds = new Set(minimalNodes.map(node => node.id));
    
    // Clean edges by removing execution-related properties and filter out edges to non-existent nodes
    const cleanEdges = edges
      .filter(edge => existingNodeIds.has(edge.source) && existingNodeIds.has(edge.target))
      .map(edge => {
        const cleanEdge: any = {
          id: edge.id,
          type: edge.type,
          source: edge.source,
          target: edge.target,
        };
        
        // Only include handles if they exist
        if (edge.sourceHandle) cleanEdge.sourceHandle = edge.sourceHandle;
        if (edge.targetHandle) cleanEdge.targetHandle = edge.targetHandle;
        
        // Only include basic style properties (no execution styling)
        if (edge.style?.strokeLinecap || edge.style?.strokeLinejoin) {
          cleanEdge.style = {
            strokeLinecap: edge.style?.strokeLinecap || 'round',
            strokeLinejoin: edge.style?.strokeLinejoin || 'round',
          };
        }
        
        return cleanEdge;
      });

    const payload = {
      user_id: authUser.id,
      name: workflowName,
      nodes: JSON.parse(JSON.stringify(minimalNodes)) as any,
      edges: JSON.parse(JSON.stringify(cleanEdges)) as any,
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

      //console.log("Workflow status changed:", !isActive ? "activated" : "deactivated");
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
    
    // Generate human-readable ID by counting existing nodes of same type
    const existingNodesOfType = nodes.filter(node => node.type === nodeType);
    const nodeId = existingNodesOfType.length === 0 ? nodeType : `${nodeType}${existingNodesOfType.length}`;
    
    const newNode: Node = {
      id: nodeId,
      type: nodeType,
      position,
      data: { 
        label: nodeDefinition?.name || `${nodeType} node`,
        definition: nodeDefinition
      },
    };
    
    setNodes((nds) => nds.concat(newNode));
  }, [setNodes, nodes]);

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
  const [hasLoadedWorkflowId, setHasLoadedWorkflowId] = useState<string | null>(null);
  
  useEffect(() => {
    
    if (authLoading) return; // Wait for auth to finish loading
    
    if (!authUser) {
      // Redirect to login if no user found
      navigate('/login');
      return;
    }

    // Prevent reloading if we've already loaded this workflow
    if (hasLoadedWorkflowId && workflowId === hasLoadedWorkflowId) {
      //console.log("🚫 Skipping reload - workflow already loaded");
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
        setHasLoadedWorkflowId('new');
      } else if (workflowId && workflowId !== hasLoadedWorkflowId) {
        // Load specific existing workflow only if it's different from what we've loaded
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
                  definition: node.data?.definition || nodeManifest[node.type as keyof typeof nodeManifest],
                  // Ensure values are properly mapped to data.values for BaseNode to use
                  values: (node as any).values || node.data?.values || {},
                  // Restore display name for backward compatibility
                  displayName: node.id 
                  //displayName: (node as any).displayName || (node.data?.values as any)?.label || nodeManifest[node.type as keyof typeof nodeManifest]?.name || node.type
                }
              }));
              setNodes(restoredNodes);
              
              // Clean up invalid edges after nodes are set
              if (data.edges && Array.isArray(data.edges)) {
                const validEdges = (data.edges as unknown as Edge[]).filter(edge => {
                  // Check if edge connects to a valid source handle
                  const sourceNode = restoredNodes.find(n => n.id === edge.source);
                  if (!sourceNode || !edge.sourceHandle) return true; // Keep non-handle edges
                  
                  // For Switch nodes, validate that the sourceHandle exists in cases
                  const nodeDefinition = sourceNode.data?.definition as any;
                  const nodeType = nodeDefinition?.name;
                  if (nodeType === "Switch") {
                    const cases = sourceNode.data?.values?.cases || (sourceNode as any).values?.cases || [];
                    const validHandles = cases.map((c: any) => c.caseValue || `case${cases.indexOf(c) + 1}`);
                    validHandles.push("default"); // Add default handle
                    
                    if (!validHandles.includes(edge.sourceHandle)) {
                      console.log(`🗑️ Removing invalid edge: ${edge.id} - handle "${edge.sourceHandle}" not found in Switch node`);
                      return false; // Remove invalid edge
                    }
                  }
                  
                  return true; // Keep valid edge
                });
                
                setEdges(validEdges);
              }
            } else if (data.edges && Array.isArray(data.edges)) {
              // If no nodes but edges exist, just set edges directly
              setEdges(data.edges as unknown as Edge[]);
            }
            setHasLoadedWorkflowId(workflowId);
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
  }, [authUser, authLoading, navigate, isNewWorkflow, workflowId]); // Removed id from dependencies to prevent reload on tab switch


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
      //console.log("Key pressed:", event.key, "Code:", event.code, "Target:", event.target);
      if (event.key === 'Delete') {
        //console.log("Delete key pressed - removing selected nodes");
        setNodes((nds) => nds.filter((node) => !node.selected));
        setEdges((eds) => eds.filter((edge) => !edge.selected));
      }
      if (event.key === 'Backspace') {
        //console.log("Backspace key pressed but should NOT delete nodes");
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
            onClick={executeAllNodes}
            disabled={loading || isAutoExecuting || nodes.length === 0}
            variant="secondary"
            className="h-10 px-4 font-medium bg-primary/10 hover:bg-primary/20 text-primary border-primary/20 transition-all duration-200"
          >
            {isAutoExecuting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Execute All
              </>
            )}
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
            edges={styledEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
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

const WorkflowEditor = () => (
  <ReactFlowProvider>
    <WorkflowEditorContent />
  </ReactFlowProvider>
);

export default WorkflowEditor;
