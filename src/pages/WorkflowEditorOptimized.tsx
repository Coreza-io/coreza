import React, { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Connection, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAuth } from "@/contexts/AuthContext";
import { ExecutionStoreProvider } from "@/contexts/ExecutionStoreContext";
import { useWorkflowState } from "@/hooks/useWorkflowState";
import { useWorkflowExecution } from "@/hooks/useWorkflowExecution";
import { WorkflowHeader } from "@/components/workflow/WorkflowHeader";
import { WorkflowCanvas } from "@/components/workflow/WorkflowCanvas";
import { nodeManifest } from "@/nodes/manifest";

const WorkflowEditorContent = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user: authUser, loading: authLoading } = useAuth();
  
  const isNewWorkflow = id === 'new' || !id;
  const projectId = searchParams.get('project');
  
  const [isPaletteVisible, setIsPaletteVisible] = useState(true);
  
  // Use optimized workflow state management
  const [workflowState, workflowActions] = useWorkflowState(
    isNewWorkflow ? null : id || null,
    projectId
  );
  
  // Use optimized execution management
  const [executionState, executionActions] = useWorkflowExecution(
    workflowState.nodes,
    workflowState.edges,
    workflowActions.setNodes,
    workflowActions.setEdges
  );

  // Load workflow on mount or ID change
  useEffect(() => {
    if (authLoading) return;
    
    if (!authUser) {
      navigate('/login');
      return;
    }

    workflowActions.loadWorkflow(id, projectId);
  }, [authUser, authLoading, id, projectId, navigate]);

  // Handle activation toggle
  const handleActivate = useCallback(async () => {
    if (!authUser || !workflowState.workflowId) return;
    
    workflowActions.setIsActive(!workflowState.isActive);
    await workflowActions.saveWorkflow(true); // Autosave the activation state
  }, [authUser, workflowState.workflowId, workflowState.isActive, workflowActions]);

  // Handle connections
  const onConnect = useCallback((params: Connection) => {
    const id = `edge_${Date.now()}`;
    const newEdge = {
      id,
      ...params,
      type: 'removable',
    };
    workflowActions.setEdges(prev => [...prev, newEdge]);
  }, [workflowActions]);

  // Handle node double click for execution
  const onNodeDoubleClick = useCallback(async (event: React.MouseEvent, node: any) => {
    event.preventDefault();
    if (!executionState.isExecuting) {
      await executionActions.executeNode(node.id);
    }
  }, [executionState.isExecuting, executionActions]);

  // Handle drag and drop
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    
    const type = event.dataTransfer.getData('application/reactflow');
    if (!type || !(type in nodeManifest)) return;

    const reactFlowBounds = event.currentTarget.getBoundingClientRect();
    const position = {
      x: event.clientX - reactFlowBounds.left,
      y: event.clientY - reactFlowBounds.top,
    };

    workflowActions.createNode(type, position);
  }, [workflowActions]);

  // Handle node click from palette
  const handleNodeClick = useCallback((nodeType: string) => {
    const position = { x: 250, y: 250 };
    workflowActions.createNode(nodeType, position);
    setIsPaletteVisible(false);
  }, [workflowActions]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Delete') {
        const selectedNodes = workflowState.nodes.filter(node => node.selected);
        const selectedEdges = workflowState.edges.filter(edge => edge.selected);
        
        if (selectedNodes.length > 0) {
          workflowActions.setNodes(prev => prev.filter(node => !node.selected));
        }
        if (selectedEdges.length > 0) {
          workflowActions.setEdges(prev => prev.filter(edge => !edge.selected));
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [workflowState.nodes, workflowState.edges, workflowActions]);

  // Auto-save on changes
  useEffect(() => {
    if (workflowState.hasUnsavedChanges && !isNewWorkflow) {
      const timeout = setTimeout(() => {
        workflowActions.saveWorkflow(true);
      }, 2000);
      
      return () => clearTimeout(timeout);
    }
  }, [workflowState.hasUnsavedChanges, isNewWorkflow, workflowActions]);

  const isDisabled = executionState.isExecuting || workflowState.loading;

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] w-full">
      <WorkflowHeader
        workflowName={workflowState.workflowName}
        onWorkflowNameChange={workflowActions.setWorkflowName}
        isActive={workflowState.isActive}
        onActivate={handleActivate}
        onSave={() => workflowActions.saveWorkflow(false)}
        onExecute={executionActions.executeAllNodes}
        onStopExecution={executionActions.stopExecution}
        loading={workflowState.loading}
        saving={workflowState.saving}
        isExecuting={executionState.isExecuting}
        hasUnsavedChanges={workflowState.hasUnsavedChanges}
        nodeCount={workflowState.nodes.length}
        disabled={isDisabled}
      />
      
      <WorkflowCanvas
        nodes={workflowState.nodes}
        edges={workflowState.edges}
        onNodesChange={workflowActions.setNodes}
        onEdgesChange={workflowActions.setEdges}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={handleNodeClick}
        isPaletteVisible={isPaletteVisible}
        onTogglePalette={() => setIsPaletteVisible(!isPaletteVisible)}
        disabled={isDisabled}
      />
    </div>
  );
};

const WorkflowEditorOptimized = () => (
  <ReactFlowProvider>
    <ExecutionStoreProvider>
      <WorkflowEditorContent />
    </ExecutionStoreProvider>
  </ReactFlowProvider>
);

export default WorkflowEditorOptimized;