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

  // DB uses values as the canonical config for these nodes; UI edits live in fieldState.
  const REPEATER_NODES_USING_VALUES = useRef(new Set(['If', 'Switch', 'Edit Fields']));

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

  // ------- helpers -------
  const generateUniqueNodeId = useCallback((nodeType: string) => {
    const existingIds = new Set(state.nodes.map(n => n.id));
    let nodeId = nodeType;
    if (existingIds.has(nodeId)) {
      let counter = 1;
      while (existingIds.has(`${nodeType}${counter}`)) counter++;
      nodeId = `${nodeType}${counter}`;
    }
    return nodeId;
  }, [state.nodes]);

  // Copy fieldState into values for nodes where DB expects values (If/Switch/Edit Fields)
  const materializeValuesFromFieldState = useCallback((node: any) => {
    if (!REPEATER_NODES_USING_VALUES.current.has(node.type)) return node;

    const fs = node?.data?.fieldState ?? {};
    const v  = node?.data?.values ?? {};

    if (node.type === 'If') {
      const conditions = fs.conditions ?? v.conditions ?? [];
      const logicalOps = fs.logicalOps ?? v.logicalOps ?? [];
      const logicalOp  = fs.logicalOp  ?? v.logicalOp  ?? undefined;
      return {
        ...node,
        data: {
          ...node.data,
          values: {
            ...v,
            conditions,
            ...(logicalOps?.length ? { logicalOps } : {}),
            ...(logicalOp ? { logicalOp } : {}),
          },
        },
      };
    }

    if (node.type === 'Switch') {
      const inputValue  = fs.inputValue   ?? v.inputValue   ?? '';
      const cases       = fs.cases        ?? v.cases        ?? [];
      const defaultCase = fs.defaultCase  ?? v.defaultCase  ?? '';
      return {
        ...node,
        data: {
          ...node.data,
          values: {
            ...v,
            inputValue,
            cases,
            defaultCase,
          },
        },
      };
    }

    if (node.type === 'Edit Fields') {
      // For Edit Fields, only preserve valid fields and merge with fieldState
      const validFields = ['fields', 'persistent'];
      const preservedValues = validFields.reduce((acc, field) => {
        if (v[field] !== undefined) acc[field] = v[field];
        return acc;
      }, {} as any);
      
      const fields     = fs.fields     ?? preservedValues.fields     ?? [];
      const persistent = fs.persistent ?? preservedValues.persistent ?? '';
      
      return {
        ...node,
        data: {
          ...node.data,
          values: {
            ...preservedValues, // Only valid fields
            fields,
            persistent,
          },
        },
      };
    }

    return node;
  }, []);

  // Build the exact snapshot we persist & use for dirty-check
  const buildPersistableGraph = useCallback(() => {
    console.log('🏗️ buildPersistableGraph called with state.nodes:', state.nodes.map(n => ({ id: n.id, type: n.type, values: n.data?.values, fieldState: n.data?.fieldState })));
    
    // 1) create a materialized copy (fs → values) for nodes that need it
    const materialized = state.nodes.map(n => materializeValuesFromFieldState(n));
    
    console.log('🏗️ After materializeValuesFromFieldState:', materialized.map(n => ({ id: n.id, type: n.type, values: n.data?.values, fieldState: n.data?.fieldState })));

    // 2) minimal nodes that go to DB (keep values as truth, also store fieldState for future-proof)
    const minimalNodes = materialized.map((node: any) => ({
      id: node.id,
      type: node.type,
      category: node?.data?.definition?.category,
      subCategory: node?.data?.definition?.subCategory,
      position: node.position,
      sourcePosition: node.sourcePosition,
      targetPosition: node.targetPosition,
      data: {
        values: node?.data?.values || {},
        fieldState: node?.data?.fieldState || {}, // stored too (for future)
        displayName: node?.data?.displayName,
      },
    }));

    console.log('🏗️ Final minimalNodes being saved:', JSON.stringify(minimalNodes, null, 2));

    const existingIds = new Set(minimalNodes.map(n => n.id));

    const cleanEdges = state.edges
      .filter(e => existingIds.has(e.source) && existingIds.has(e.target))
      .map((edge) => {
        const clean: any = {
          id: edge.id,
          type: edge.type || 'removable',
          source: edge.source,
          target: edge.target,
        };
        if (edge.sourceHandle) clean.sourceHandle = edge.sourceHandle;
        if (edge.targetHandle) clean.targetHandle = edge.targetHandle;
        return clean;
      });

    return {
      name: state.workflowName,
      isActive: state.isActive,
      nodes: minimalNodes,
      edges: cleanEdges,
    };
  }, [state.nodes, state.edges, state.workflowName, state.isActive, materializeValuesFromFieldState]);

  const checkUnsavedChanges = useCallback(() => {
    const snapshot = buildPersistableGraph();
    const current = JSON.stringify(snapshot);
    const hasChanges = current !== lastSavedStateRef.current;
    setState(prev => ({ ...prev, hasUnsavedChanges: hasChanges }));
    return hasChanges;
  }, [buildPersistableGraph]);

  const updateLastSavedState = useCallback(() => {
    const snapshot = buildPersistableGraph();
    lastSavedStateRef.current = JSON.stringify(snapshot);
    setState(prev => ({ ...prev, hasUnsavedChanges: false }));
  }, [buildPersistableGraph]);

  // ------- actions -------
  const setWorkflowName = useCallback((name: string) => {
    setState(prev => ({ ...prev, workflowName: name }));
  }, []);

  const setIsActive = useCallback((active: boolean) => {
    setState(prev => ({ ...prev, isActive: active }));
  }, []);

  const setNodes = useCallback((nodes: Node[] | ((prev: Node[]) => Node[])) => {
    setState(prev => ({
      ...prev,
      nodes: typeof nodes === 'function' ? (nodes as (p: Node[]) => Node[])(prev.nodes) : nodes
    }));
  }, []);

  const setEdges = useCallback((edges: Edge[] | ((prev: Edge[]) => Edge[])) => {
    setState(prev => ({
      ...prev,
      edges: typeof edges === 'function' ? (edges as (p: Edge[]) => Edge[])(prev.edges) : edges
    }));
  }, []);

  const createNode = useCallback((nodeType: string, position: { x: number; y: number }) => {
    const definition = nodeManifest[nodeType];
    if (!definition) {
      console.error(`Unknown node type: ${nodeType}`);
      return;
    }
    const nodeId = generateUniqueNodeId(nodeType);
    
    // Initialize fieldState with default values from definition
    const initialFieldState = definition.fields 
      ? Object.fromEntries(
          definition.fields.map((f: any) => [
            f.key, 
            f.type === "repeater" ? f.default || [] : f.default || ""
          ])
        )
      : {};
    
    console.log('🆕 Creating new node:', { nodeType, nodeId, definition: definition.name, initialFieldState });
    
    const newNode: Node = {
      id: nodeId,
      type: nodeType,
      position,
      data: {
        label: definition.name || `${nodeType} node`,
        definition,
        values: {},
        fieldState: initialFieldState,
        displayName: undefined, // BaseNode computes a friendly display name
      },
    };
    
    console.log('🆕 New node created:', newNode);
    setNodes(prev => [...prev, newNode]);
  }, [generateUniqueNodeId, setNodes]);

  const saveWorkflow = useCallback(async (isAutosave = false): Promise<boolean> => {
    if (!authUser) {
      if (!isAutosave) {
        toast({ title: 'Error', description: 'Please log in to save workflows', variant: 'destructive' });
      }
      return false;
    }

    setState(prev => ({ ...prev, saving: true, error: null }));

    try {
      // Build persistable snapshot (same used for dirty-check)
      const graph = buildPersistableGraph();
      
      console.log('💾 saveWorkflow payload nodes:', JSON.stringify(graph.nodes, null, 2));

      const payload = {
        user_id: authUser.id,
        name: graph.name,
        nodes: JSON.parse(JSON.stringify(graph.nodes)),
        edges: JSON.parse(JSON.stringify(graph.edges)),
        is_active: graph.isActive,
        updated_at: new Date().toISOString(),
        ...(projectId && { project_id: projectId }),
      };
      
      console.log('💾 Full payload being sent to Supabase:', JSON.stringify(payload.nodes, null, 2));

      let result;
      if (state.workflowId) {
        result = await supabase
          .from('workflows')
          .update(payload)
          .eq('id', state.workflowId)
          .eq('user_id', authUser.id);
      } else {
        result = await supabase
          .from('workflows')
          .insert([payload])
          .select()
          .single();
      }

      if (result.error) throw result.error;

      if (!state.workflowId && result.data) {
        setState(prev => ({ ...prev, workflowId: result.data.id }));
      }

      updateLastSavedState();

      if (!isAutosave) {
        toast({ title: 'Success', description: state.workflowId ? 'Workflow updated!' : 'Workflow saved!' });
      }

      return true;
    } catch (err: any) {
      const msg = err?.message || 'Unknown error occurred';
      setState(prev => ({ ...prev, error: msg }));
      if (!isAutosave) {
        toast({ title: 'Error', description: `Failed to save workflow: ${msg}`, variant: 'destructive' });
      }
      return false;
    } finally {
      setState(prev => ({ ...prev, saving: false }));
    }
  }, [authUser, state.workflowId, projectId, toast, buildPersistableGraph, updateLastSavedState]);

  const loadWorkflow = useCallback(async (id: string | null, projectIdParam?: string | null): Promise<boolean> => {
    if (!authUser || !id || id === 'new') {
      // Generate smart name for new workflow
      try {
        const { data: existing, error } = await supabase
          .from('workflows')
          .select('name')
          .eq('user_id', authUser?.id || '');

        if (!error && existing) {
          const nums = existing
            .map(w => w.name)
            .filter(n => n?.startsWith('My workflow '))
            .map(n => {
              const m = n.match(/My workflow (\d+)/);
              return m ? parseInt(m[1]) : 0;
            })
            .filter(n => !isNaN(n));
          const next = (nums.length ? Math.max(...nums) : 0) + 1;
          const workflowName = projectId ? `New Project Workflow ${next}` : `My workflow ${next}`;
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
      } catch (e) {
        console.error('Error generating workflow name:', e);
      }

      executionStore.clear();
      updateLastSavedState();
      return true;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('*')
        .eq('id', id)
        .eq('user_id', authUser.id)
        .single();

      if (error || !data) {
        console.error('Workflow query error:', error);
        throw new Error('Workflow not found or access denied');
      }

      console.log('🔄 Loading workflow:', data.name, 'with nodes:', data.nodes);
      
      executionStore.clear();

      // Rehydrate nodes with definitions + fieldState (hydrated from values if needed)
      const restoredNodes: Node[] = ((data.nodes as unknown) as any[] || []).map((node: any) => {
        console.log('🔄 Processing node:', node.type, node.id);
        
        const def = nodeManifest[node.type as keyof typeof nodeManifest];
        if (!def) {
          console.warn(`⚠️ No definition found for node type: ${node.type}`);
        }

        const values = node.data?.values ?? node.values ?? {};
        let fieldState = node.data?.fieldState ?? node.fieldState ?? {};
        const displayName = node.data?.displayName ?? node.displayName;
        const { values: _v, fieldState: _fs, displayName: _dn, ...rest } = node;

        if (REPEATER_NODES_USING_VALUES.current.has(node.type) && (!fieldState || Object.keys(fieldState).length === 0)) {
          if (node.type === 'If') {
            fieldState = {
              ...values,
              conditions: Array.isArray(values.conditions) ? values.conditions : [],
              logicalOps: Array.isArray(values.logicalOps) ? values.logicalOps : [],
            };
          } else if (node.type === 'Switch') {
            fieldState = {
              ...values,
              cases: Array.isArray(values.cases) ? values.cases : [],
            };
          } else if (node.type === 'Edit Fields') {
            fieldState = {
              ...values,
              fields: Array.isArray(values.fields) ? values.fields : [],
              logicalOps: Array.isArray(values.logicalOps) ? values.logicalOps : [],
            };
          }
        }

        return {
          ...rest,
          data: {
            ...(node.data || {}),
            definition: node.data?.definition || def,
            values,
            fieldState,
            displayName,
          },
        };
      });

      // Edges cleanup
      const restoredEdges: Edge[] = ((data.edges as unknown) as Edge[] || []).map(edge => ({
        ...edge,
        type: edge.type || 'removable',
        data: { ...(edge as any).data },
      }));

      setState(prev => ({
        ...prev,
        workflowId: id,
        workflowName: data.name || 'Untitled Workflow',
        isActive: !!data.is_active,
        nodes: restoredNodes,
        edges: restoredEdges,
      }));

      updateLastSavedState();
      return true;
    } catch (err: any) {
      const msg = err?.message || 'Failed to load workflow';
      setState(prev => ({ ...prev, error: msg }));
      toast({ title: 'Error', description: msg, variant: 'destructive' });
      return false;
    } finally {
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [authUser, executionStore, updateLastSavedState, toast, projectId]);

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

  // ------ dirty check debounce ------
  useEffect(() => {
    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(() => {
      checkUnsavedChanges();
    }, 120); // small debounce for UX
    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, [checkUnsavedChanges]);

  // cleanup
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
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
    },
  ];
};
