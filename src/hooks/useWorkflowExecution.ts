/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Node, Edge } from '@xyflow/react';
import { WorkflowExecutor } from '@/utils/workflowExecutor';
import { useToast } from '@/hooks/use-toast';
import { useExecutionStore } from '@/contexts/ExecutionStoreContext';

export interface ExecutionState {
  isExecuting: boolean;
  executingNode: string | null;
  executionQueue: string[];
  executionMetrics: {
    startTime: number | null;
    completedNodes: Set<string>;
    failedNodes: Set<string>;
    totalNodes: number;
  };
  error: string | null;
}

export interface ExecutionActions {
  executeAllNodes: () => Promise<void>;
  executeNode: (nodeId: string) => Promise<any>;
  stopExecution: () => void;
  clearExecutionState: () => void;
  setExecutingNode: (nodeId: string | null) => void;
}

export const useWorkflowExecution = (
  nodes: Node[],
  edges: Edge[],
  setNodes: (update: (nodes: Node[]) => Node[]) => void,
  setEdges: (update: (edges: Edge[]) => Edge[]) => void
): [ExecutionState, ExecutionActions] => {
  const { toast } = useToast();
  const executionStore = useExecutionStore();
  const workflowExecutorRef = useRef<WorkflowExecutor | null>(null);
  const executionAbortRef = useRef<AbortController | null>(null);

  const [state, setState] = useState<ExecutionState>({
    isExecuting: false,
    executingNode: null,
    executionQueue: [],
    executionMetrics: {
      startTime: null,
      completedNodes: new Set(),
      failedNodes: new Set(),
      totalNodes: 0,
    },
    error: null,
  });

  // Initialize workflow executor when nodes/edges change
  useEffect(() => {
    if (nodes.length === 0) {
      workflowExecutorRef.current = null;
      return;
    }

    workflowExecutorRef.current = new WorkflowExecutor({
      nodes,
      edges,
      setNodes,
      setEdges,
      setExecutingNode: (nodeId: string | null) => {
        setState(prev => ({ ...prev, executingNode: nodeId }));
      },
      toast,
      executionStore,
    });

    return () => {
      workflowExecutorRef.current = null;
    };
  }, [nodes.length, edges.length, setNodes, setEdges, toast, executionStore]);

  const setExecutingNode = useCallback((nodeId: string | null) => {
    setState(prev => ({ ...prev, executingNode: nodeId }));
  }, []);

  const executeAllNodes = useCallback(async () => {
    if (!workflowExecutorRef.current) {
      toast({
        title: "Error",
        description: "No workflow to execute",
        variant: "destructive",
      });
      return;
    }

    if (state.isExecuting) {
      console.warn('Execution already in progress');
      return;
    }

    // Create abort controller for this execution
    executionAbortRef.current = new AbortController();

    setState(prev => ({
      ...prev,
      isExecuting: true,
      error: null,
      executionMetrics: {
        startTime: performance.now(),
        completedNodes: new Set(),
        failedNodes: new Set(),
        totalNodes: nodes.length,
      },
    }));

    try {
      await workflowExecutorRef.current.executeAllNodes();
      
      toast({
        title: "Execution Complete",
        description: "Workflow executed successfully",
      });
    } catch (error: any) {
      const errorMessage = error.message || 'Execution failed';
      setState(prev => ({ ...prev, error: errorMessage }));
      
      toast({
        title: "Execution Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setState(prev => ({ ...prev, isExecuting: false, executingNode: null }));
      executionAbortRef.current = null;
    }
  }, [state.isExecuting, nodes.length, toast]);

  const executeNode = useCallback(async (nodeId: string): Promise<any> => {
    if (!workflowExecutorRef.current) {
      throw new Error("No workflow executor available");
    }

    if (state.isExecuting) {
      console.warn('Cannot execute single node while workflow execution is in progress');
      return;
    }

    setState(prev => ({ ...prev, executingNode: nodeId, error: null }));

    try {
      const result = await workflowExecutorRef.current.executeNode(nodeId, new Set());
      return result;
    } catch (error: any) {
      const errorMessage = error.message || 'Node execution failed';
      setState(prev => ({ ...prev, error: errorMessage }));
      throw error;
    } finally {
      setState(prev => ({ ...prev, executingNode: null }));
    }
  }, [state.isExecuting]);

  const stopExecution = useCallback(() => {
    if (executionAbortRef.current) {
      executionAbortRef.current.abort();
    }

    if (workflowExecutorRef.current) {
      workflowExecutorRef.current.setAutoExecuting(false);
    }

    setState(prev => ({
      ...prev,
      isExecuting: false,
      executingNode: null,
      error: null,
    }));

    toast({
      title: "Execution Stopped",
      description: "Workflow execution has been stopped",
    });
  }, [toast]);

  const clearExecutionState = useCallback(() => {
    executionStore.clear();
    setState(prev => ({
      ...prev,
      isExecuting: false,
      executingNode: null,
      executionQueue: [],
      executionMetrics: {
        startTime: null,
        completedNodes: new Set(),
        failedNodes: new Set(),
        totalNodes: 0,
      },
      error: null,
    }));
  }, [executionStore]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (executionAbortRef.current) {
        executionAbortRef.current.abort();
      }
    };
  }, []);

  return [
    state,
    {
      executeAllNodes,
      executeNode,
      stopExecution,
      clearExecutionState,
      setExecutingNode,
    }
  ];
};