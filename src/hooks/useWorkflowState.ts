import { useState, useCallback, useEffect, useRef } from 'react';
import { Node, Edge } from '@xyflow/react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useExecutionStore } from '@/contexts/ExecutionStoreContext';
import { nodeManifest } from '@/nodes/manifest';

export interface WorkflowState {
  workflowId: string | null;
  workflowName: string;
  isActive: boolean;
  nodes: Node[];
  edges: Edge[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;
}

export interface WorkflowActions {
  setWorkflowName: (name: string) => void;
  setIsActive: (active: boolean) => void;
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  saveWorkflow: (isAutosave?: boolean) => Promise<boolean>;
  loadWorkflow: (id: string | null, projectId?: string | null) => Promise<boolean>;
  resetWorkflow: () => void;
  createNode: (nodeType: string, position: { x: number; y: number }) => void;
}

export const useWorkflowState = (
  initialWorkflowId: string | null = null,
  projectId: string | null = null
): [WorkflowState, WorkflowActions] => {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const executionStore = useExecutionStore();
  const debounceTimeoutRef = useRef<NodeJS.Timeout>();
  const lastSavedStateRef = useRef<string>('');

  // Core state
  const [state, setState] = useState<WorkflowState>({
    workflowId: initialWorkflowId,
    workflowName: initialWorkflowId ? 'Loading...' : 'My workflow 1',
    isActive: false,
    nodes: [],
    edges: [],
    loading: false,
    saving: false,
    error: null,
    hasUnsavedChanges: false,
  });

  // Generate unique node ID that doesn't conflict with existing nodes
  const generateUniqueNodeId = useCallback((nodeType: string) => {
    const existingIds = new Set(state.nodes.map(node => node.id));
    
    let nodeId = nodeType;
    if (existingIds.has(nodeId)) {
      let counter = 1;
      while (existingIds.has(`${nodeType}${counter}`)) {
        counter++;
      }
      nodeId = `${nodeType}${counter}`;
    }
    
    return nodeId;
  }, [state.nodes]);

  // Check if current state differs from last saved state
  const checkUnsavedChanges = useCallback(() => {
    const currentState = JSON.stringify({
      name: state.workflowName,
      nodes: state.nodes,
      edges: state.edges,
      isActive: state.isActive
    });
    
    const hasChanges = currentState !== lastSavedStateRef.current;
    setState(prev => ({ ...prev, hasUnsavedChanges: hasChanges }));
    
    return hasChanges;
  }, [state.workflowName, state.nodes, state.edges, state.isActive]);

  // Update last saved state reference
  const updateLastSavedState = useCallback(() => {
    lastSavedStateRef.current = JSON.stringify({
      name: state.workflowName,
      nodes: state.nodes,
      edges: state.edges,
      isActive: state.isActive
    });
    setState(prev => ({ ...prev, hasUnsavedChanges: false }));
  }, [state.workflowName, state.nodes, state.edges, state.isActive]);

  // Actions
  const setWorkflowName = useCallback((name: string) => {
    setState(prev => ({ ...prev, workflowName: name }));
  }, []);

  const setIsActive = useCallback((active: boolean) => {
    setState(prev => ({ ...prev, isActive: active }));
  }, []);

  const setNodes = useCallback((nodes: Node[] | ((prev: Node[]) => Node[])) => {
    setState(prev => ({
      ...prev,
      nodes: typeof nodes === 'function' ? nodes(prev.nodes) : nodes
    }));
  }, []);

  const setEdges = useCallback((edges: Edge[] | ((prev: Edge[]) => Edge[])) => {
    setState(prev => ({
      ...prev,
      edges: typeof edges === 'function' ? edges(prev.edges) : edges
    }));
  }, []);

  const createNode = useCallback((nodeType: string, position: { x: number; y: number }) => {
    const nodeDefinition = nodeManifest[nodeType];
    if (!nodeDefinition) {
      console.error(`Unknown node type: ${nodeType}`);
      return;
    }

    const nodeId = generateUniqueNodeId(nodeType);
    const newNode: Node = {
      id: nodeId,
      type: nodeType,
      position,
      data: {
        label: nodeDefinition.name || `${nodeType} node`,
        definition: nodeDefinition,
        values: {},
        fieldState: {},
        displayName: undefined // Let BaseNode calculate proper displayName
      },
    };

    setNodes(prev => [...prev, newNode]);
  }, [generateUniqueNodeId, setNodes]);

  const saveWorkflow = useCallback(async (isAutosave = false): Promise<boolean> => {
    if (!authUser) {
      if (!isAutosave) {
        toast({
          title: "Error",
          description: "Please log in to save workflows",
          variant: "destructive",
        });
      }
      return false;
    }

    setState(prev => ({ ...prev, saving: true, error: null }));

    try {
      // Prepare clean data for saving
      const minimalNodes = state.nodes.map(node => ({
        id: node.id, // This will now be the renamed ID (e.g., "uptrend" instead of "If1")
        type: node.type,
        category: (node.data.definition as any)?.category,
        subCategory: (node.data.definition as any)?.subCategory,
        position: node.position,
        sourcePosition: node.sourcePosition,
        targetPosition: node.targetPosition,
        values: node.data.values || {},
        fieldState: node.data.fieldState || {}, // Save fieldState to preserve UI state
        displayName: node.data.displayName, // Save custom displayName
      }));

      // Get existing node IDs for edge validation
      const existingNodeIds = new Set(minimalNodes.map(node => node.id));
      
      // Clean edges by removing execution-related properties and filtering invalid edges
      const cleanEdges = state.edges
        .filter(edge => existingNodeIds.has(edge.source) && existingNodeIds.has(edge.target))
        .map(edge => {
          const cleanEdge: any = {
            id: edge.id,
            type: edge.type || 'removable',
            source: edge.source,
            target: edge.target,
          };
          
          if (edge.sourceHandle) cleanEdge.sourceHandle = edge.sourceHandle;
          if (edge.targetHandle) cleanEdge.targetHandle = edge.targetHandle;
          
          return cleanEdge;
        });

      const payload = {
        user_id: authUser.id,
        name: state.workflowName,
        nodes: JSON.parse(JSON.stringify(minimalNodes)),
        edges: JSON.parse(JSON.stringify(cleanEdges)),
        is_active: state.isActive,
        updated_at: new Date().toISOString(),
        ...(projectId && { project_id: projectId }),
      };

      let result;
      if (state.workflowId) {
        // Update existing workflow
        result = await supabase
          .from("workflows")
          .update(payload)
          .eq("id", state.workflowId)
          .eq("user_id", authUser.id);
      } else {
        // Create new workflow
        result = await supabase
          .from("workflows")
          .insert([payload])
          .select()
          .single();
      }

      if (result.error) {
        throw result.error;
      }

      // Update workflow ID if creating new workflow
      if (!state.workflowId && result.data) {
        setState(prev => ({ ...prev, workflowId: result.data.id }));
      }

      updateLastSavedState();

      if (!isAutosave) {
        toast({
          title: "Success",
          description: state.workflowId ? "Workflow updated!" : "Workflow saved!",
        });
      }

      return true;
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error occurred';
      setState(prev => ({ ...prev, error: errorMessage }));
      
      if (!isAutosave) {
        toast({
          title: "Error",
          description: `Failed to save workflow: ${errorMessage}`,
          variant: "destructive",
        });
      }
      
      return false;
    } finally {
      setState(prev => ({ ...prev, saving: false }));
    }
  }, [authUser, state, projectId, toast, updateLastSavedState]);

  const loadWorkflow = useCallback(async (id: string | null, projectId?: string | null): Promise<boolean> => {
    if (!authUser || !id || id === 'new') {
      // Generate smart workflow name for new workflows
      try {
        const { data: existingWorkflows, error } = await supabase
          .from("workflows")
          .select("name")
          .eq("user_id", authUser?.id || '');

        if (!error && existingWorkflows) {
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
          const workflowName = projectId ? `New Project Workflow ${nextNumber}` : `My workflow ${nextNumber}`;
          
          setState(prev => ({
            ...prev,
            workflowId: null,
            workflowName,
            nodes: [],
            edges: [],
            isActive: false,
            error: null,
          }));
        }
      } catch (error) {
        console.error("Error generating workflow name:", error);
      }

      // Clear execution context for new workflow
      executionStore.clear();
      updateLastSavedState();
      return true;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const { data, error } = await supabase
        .from("workflows")
        .select("*")
        .eq("id", id)
        .eq("user_id", authUser.id)
        .single();

      if (error || !data) {
        throw new Error("Workflow not found or access denied");
      }

      // Clear execution context when loading different workflow
      executionStore.clear();

      // Restore nodes with definitions
      const restoredNodes = ((data.nodes as unknown) as Node[] || []).map(node => ({
        ...node,
        data: {
          ...node.data,
          definition: node.data?.definition || nodeManifest[node.type as keyof typeof nodeManifest],
          values: (node as any).values || node.data?.values || {},
          fieldState: (node as any).fieldState || node.data?.fieldState || {}, // Restore fieldState to preserve UI state
          displayName: (node as any).displayName || node.data?.displayName, // Restore custom displayName
        }
      }));

      // Restore edges with validation
      const restoredEdges = ((data.edges as unknown) as Edge[] || []).map(edge => ({
        ...edge,
        type: edge.type || 'removable',
        data: { ...edge.data }
      }));

      setState(prev => ({
        ...prev,
        workflowId: id,
        workflowName: data.name || "Untitled Workflow",
        isActive: !!data.is_active,
        nodes: restoredNodes,
        edges: restoredEdges,
      }));

      updateLastSavedState();
      return true;
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to load workflow';
      setState(prev => ({ ...prev, error: errorMessage }));
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
      
      return false;
    } finally {
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [authUser, executionStore, updateLastSavedState, toast]);

  const resetWorkflow = useCallback(() => {
    executionStore.clear();
    setState({
      workflowId: null,
      workflowName: 'My workflow 1',
      isActive: false,
      nodes: [],
      edges: [],
      loading: false,
      saving: false,
      error: null,
      hasUnsavedChanges: false,
    });
    lastSavedStateRef.current = '';
  }, [executionStore]);

  // Check for unsaved changes when state changes
  useEffect(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    debounceTimeoutRef.current = setTimeout(() => {
      checkUnsavedChanges();
    }, 100);

    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [checkUnsavedChanges]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return [
    state,
    {
      setWorkflowName,
      setIsActive,
      setNodes,
      setEdges,
      saveWorkflow,
      loadWorkflow,
      resetWorkflow,
      createNode,
    }
  ];
};