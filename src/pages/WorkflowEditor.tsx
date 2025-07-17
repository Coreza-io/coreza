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
import { Save, Play, Pause, ChevronLeft, ChevronRight, Loader2, Zap } from "lucide-react";
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
  const [isAutoExecuting, setIsAutoExecuting] = useState(false);
  const [executionQueue, setExecutionQueue] = useState<string[]>([]);
  
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

  // Function to get execution levels for parallel execution
  const getExecutionLevels = useCallback(() => {
    const nodeIds = nodes.map(node => node.id);
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();
    
    // Initialize
    nodeIds.forEach(id => {
      inDegree.set(id, 0);
      adjList.set(id, []);
    });
    
    // Build adjacency list and calculate in-degrees
    // Skip conditional nodes' unused paths during topological sort
    const activeEdges = edges.filter(edge => {
      // For now, include all edges - conditional logic will be handled during execution
      return true;
    });
    
    activeEdges.forEach(edge => {
      const source = edge.source;
      const target = edge.target;
      
      if (adjList.has(source) && inDegree.has(target)) {
        adjList.get(source)!.push(target);
        inDegree.set(target, inDegree.get(target)! + 1);
      }
    });
    
    // Group nodes by execution levels
    const levels: string[][] = [];
    const currentInDegree = new Map(inDegree);
    
    while (currentInDegree.size > 0) {
      // Find all nodes with no remaining dependencies (in-degree = 0)
      const currentLevel: string[] = [];
      
      currentInDegree.forEach((degree, nodeId) => {
        if (degree === 0) {
          currentLevel.push(nodeId);
        }
      });
      
      if (currentLevel.length === 0) {
        // Circular dependency detected
        console.warn("Circular dependency detected in workflow");
        break;
      }
      
      levels.push(currentLevel);
      
      // Remove current level nodes and update in-degrees
      currentLevel.forEach(nodeId => {
        currentInDegree.delete(nodeId);
        
        // Reduce in-degree for all neighbors
        adjList.get(nodeId)!.forEach(neighbor => {
          if (currentInDegree.has(neighbor)) {
            const newDegree = currentInDegree.get(neighbor)! - 1;
            currentInDegree.set(neighbor, newDegree);
          }
        });
      });
    }
    
    return levels;
  }, [nodes, edges]);

  // Auto-execute all nodes in parallel levels
  const executeAllNodes = useCallback(async () => {
    if (isAutoExecuting) return;
    
    const executionLevels = getExecutionLevels();
    if (executionLevels.length === 0 || executionLevels.every(level => level.length === 0)) {
      toast({
        title: "No Nodes",
        description: "No nodes to execute",
        variant: "destructive",
      });
      return;
    }
    
    setIsAutoExecuting(true);
    const totalNodes = executionLevels.flat().length;
    setExecutionQueue(executionLevels.flat());
    
    try {
      for (let levelIndex = 0; levelIndex < executionLevels.length; levelIndex++) {
        const currentLevel = executionLevels[levelIndex];
        
        if (currentLevel.length === 0) continue;
        
        console.log(`🔥 Executing Level ${levelIndex + 1}: [${currentLevel.join(', ')}] - ${currentLevel.length} nodes in parallel`);
        
        // Before executing this level, verify all dependencies from previous levels are complete
        const executedNodes = new Set<string>();
        if (levelIndex > 0) {
          // Add all nodes from previous levels to executedNodes
          for (let prevLevel = 0; prevLevel < levelIndex; prevLevel++) {
            executionLevels[prevLevel].forEach(nodeId => executedNodes.add(nodeId));
          }
        }
        
        // Execute all nodes in this level in parallel
        await Promise.all(currentLevel.map(nodeId => 
          new Promise<void>((resolve, reject) => {
            setExecutingNode(nodeId);
            
            // Find all edges connected to this node (incoming and outgoing)
            const connectedEdges = edges.filter(edge => 
              edge.source === nodeId || edge.target === nodeId
            );
            
            // Highlight the executing node and animate connected edges in green
            setEdges(currentEdges => 
              currentEdges.map(edge => 
                connectedEdges.some(connectedEdge => connectedEdge.id === edge.id)
                  ? { 
                      ...edge, 
                      animated: true, 
                      className: 'executing-edge',
                      style: { 
                        ...edge.style, 
                        stroke: '#22c55e', 
                        strokeWidth: 3,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round'
                      }
                    }
                  : edge
              )
            );
            
            // Highlight the executing node in green
            setNodes(currentNodes =>
              currentNodes.map(node =>
                node.id === nodeId
                  ? {
                      ...node,
                      className: 'executing-node',
                      style: {
                        ...node.style,
                        border: '3px solid #22c55e',
                        backgroundColor: '#f0fdf4',
                        boxShadow: '0 0 20px rgba(34, 197, 94, 0.4)'
                      }
                    }
                  : node
              )
            );
            
            // Trigger actual node execution by dispatching a custom event
            const nodeExecuteEvent = new CustomEvent('auto-execute-node', {
              detail: { 
                nodeId,
                executedNodes, // Pass the set of completed nodes from previous levels
                allNodes: nodes, // Pass all nodes for dependency checking
                allEdges: edges, // Pass all edges for dependency checking
                onSuccess: (result?: any) => {
                  console.log(`✅ Node ${nodeId} executed successfully`, result);
                  
                  // Special handling for If nodes to determine which path to take
                  const currentNode = nodes.find(n => n.id === nodeId);
                  if ((currentNode?.data?.definition as any)?.name === "If" && result) {
                    console.log(`🔀 If node result:`, result);
                    
                    // Get the condition evaluation result from the API response
                    const conditionResult = result[0]?.result ?? false;
                    console.log(`🔀 If node condition evaluated to: ${conditionResult}`);
                    
                    // Find outgoing edges for this If node
                    const outgoingEdges = edges.filter(edge => edge.source === nodeId);
                    const trueEdge = outgoingEdges.find(edge => edge.sourceHandle === 'true');
                    const falseEdge = outgoingEdges.find(edge => edge.sourceHandle === 'false');
                    
                    // Only activate the edge that matches the condition result
                    const activeEdge = conditionResult ? trueEdge : falseEdge;
                    if (activeEdge) {
                      console.log(`🎯 If node activating ${conditionResult ? 'TRUE' : 'FALSE'} path to node: ${activeEdge.target}`);
                      
                      // Update the nodes to add the next execution level based on condition
                      setTimeout(() => {
                        // Dispatch execution event for the target node
                        const nextNodeEvent = new CustomEvent('auto-execute-node', {
                          detail: { 
                            nodeId: activeEdge.target,
                            executedNodes: new Set([...executedNodes, nodeId]),
                            allNodes: nodes,
                            allEdges: edges,
                            onSuccess: () => console.log(`✅ Conditional target node ${activeEdge.target} executed`),
                            onError: (error: any) => console.error(`❌ Conditional target node ${activeEdge.target} failed:`, error)
                          }
                        });
                        window.dispatchEvent(nextNodeEvent);
                      }, 100);
                    }
                  }
                  
                  // Node stays green during success - will be reset after timeout
                },
                onError: (error: any) => {
                  console.error(`❌ Node ${nodeId} execution failed:`, error);
                  // Highlight node in red for errors
                  setNodes(currentNodes =>
                    currentNodes.map(node =>
                      node.id === nodeId
                        ? {
                            ...node,
                            className: 'error-node',
                            style: {
                              ...node.style,
                              border: '3px solid #ef4444',
                              backgroundColor: '#fef2f2',
                              boxShadow: '0 0 20px rgba(239, 68, 68, 0.4)'
                            }
                          }
                        : node
                    )
                  );
                  
                  // Highlight connected edges in red for errors
                  setEdges(currentEdges => 
                    currentEdges.map(edge => 
                      connectedEdges.some(connectedEdge => connectedEdge.id === edge.id)
                        ? { 
                            ...edge, 
                            animated: false, 
                            className: 'error-edge',
                            style: { 
                              ...edge.style, 
                              stroke: '#ef4444', 
                              strokeWidth: 3,
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round'
                            }
                          }
                        : edge
                    )
                  );
                }
              }
            });
            window.dispatchEvent(nodeExecuteEvent);
            
            // Simulate execution time (3 seconds per node to allow for API calls)
            setTimeout(() => {
              // Reset node and edge styling after execution (only if not in error state)
              setNodes(currentNodes =>
                currentNodes.map(node => {
                  if (node.id === nodeId && node.className !== 'error-node') {
                    return {
                      ...node,
                      className: undefined,
                      style: undefined
                    };
                  }
                  return node;
                })
              );
              
              setEdges(currentEdges => 
                currentEdges.map(edge => {
                  if (connectedEdges.some(connectedEdge => connectedEdge.id === edge.id) && edge.className !== 'error-edge') {
                    return { 
                      ...edge, 
                      animated: false, 
                      className: '',
                      style: undefined
                    };
                  }
                  return edge;
                })
              );
              resolve();
            }, 3000);
          })
        ));
        
        console.log(`✅ Level ${levelIndex + 1} completed`);
        
        // Clear executing node after each level
        setExecutingNode(null);
        
        // Small delay between levels to show progression
        if (levelIndex < executionLevels.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      toast({
        title: "Execution Complete",
        description: `Successfully executed ${totalNodes} nodes across ${executionLevels.length} levels`,
      });
    } catch (error) {
      toast({
        title: "Execution Failed",
        description: "An error occurred during auto-execution",
        variant: "destructive",
      });
    } finally {
      setIsAutoExecuting(false);
      setExecutionQueue([]);
      setExecutingNode(null);
    }
  }, [nodes, edges, isAutoExecuting, getExecutionLevels, setEdges, toast]);

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
  const [hasLoadedWorkflowId, setHasLoadedWorkflowId] = useState<string | null>(null);
  
  useEffect(() => {
    console.log("🔄 Loading effect triggered:", {
      authLoading,
      authUser: !!authUser,
      isNewWorkflow,
      workflowId,
      currentId: id,
      currentUrl: window.location.pathname,
      hasLoadedWorkflowId
    });
    
    if (authLoading) return; // Wait for auth to finish loading
    
    if (!authUser) {
      // Redirect to login if no user found
      navigate('/login');
      return;
    }

    // Prevent reloading if we've already loaded this workflow
    if (hasLoadedWorkflowId && workflowId === hasLoadedWorkflowId) {
      console.log("🚫 Skipping reload - workflow already loaded");
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
                  values: (node as any).values || node.data?.values || {}
                }
              }));
              setNodes(restoredNodes);
            }
            if (data.edges && Array.isArray(data.edges)) {
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
