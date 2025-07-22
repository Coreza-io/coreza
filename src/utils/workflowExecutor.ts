
import { Node, Edge } from '@xyflow/react';
import { nodeManifest } from '@/nodes/manifest';
import { resolveReferences, createDisplayNameMapping } from '@/utils/resolveReferences';
import { supabase } from '@/integrations/supabase/client';

interface WorkflowExecutorProps {
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[] | ((prevNodes: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prevEdges: Edge[]) => Edge[])) => void;
  setExecutingNode: (nodeId: string | null) => void;
  toast: (options: { title: string; description: string; variant?: 'destructive' }) => void;
}

export class WorkflowExecutor {
  private nodes: Node[];
  private edges: Edge[];
  private setNodes: (nodes: Node[] | ((prevNodes: Node[]) => Node[])) => void;
  private setEdges: (edges: Edge[] | ((prevEdges: Edge[]) => Edge[])) => void;
  private setExecutingNode: (nodeId: string | null) => void;
  private toast: (options: { title: string; description: string; variant?: 'destructive' }) => void;
  private nodeOutputs: Record<string, any> = {};
  private displayNameMapping: Record<string, string> = {};

  constructor({ nodes, edges, setNodes, setEdges, setExecutingNode, toast }: WorkflowExecutorProps) {
    this.nodes = nodes;
    this.edges = edges;
    this.setNodes = setNodes;
    this.setEdges = setEdges;
    this.setExecutingNode = setExecutingNode;
    this.toast = toast;
    this.displayNameMapping = createDisplayNameMapping(nodes);
  }

  private animateEdge(edgeId: string, animate: boolean) {
    this.setEdges((edges) =>
      edges.map((edge) =>
        edge.id === edgeId
          ? { ...edge, animated: animate, style: { ...edge.style, stroke: animate ? '#00ff00' : undefined } }
          : edge
      )
    );
  }

  private setNodeExecutionState(nodeId: string, isExecuting: boolean, hasError: boolean = false) {
    this.setNodes((nodes) =>
      nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                isExecuting,
                hasError,
              },
            }
          : node
      )
    );
  }

  private updateNodeOutput(nodeId: string, output: any) {
    // Store by both technical ID and display name for compatibility
    this.nodeOutputs[nodeId] = output;
    
    // Also store by display name if available
    const displayName = Object.keys(this.displayNameMapping).find(key => this.displayNameMapping[key] === nodeId);
    if (displayName) {
      this.nodeOutputs[displayName] = output;
    }

    this.setNodes((nodes) =>
      nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                output,
                lastExecuted: new Date().toISOString(),
              },
            }
          : node
      )
    );
  }

  private resolveNodeInputs(node: Node): Record<string, any> {
    const resolvedInputs: Record<string, any> = {};
    const nodeDefinition = node.data?.definition || nodeManifest[node.type as keyof typeof nodeManifest];
    
    if (!nodeDefinition || typeof nodeDefinition !== 'object' || !('fields' in nodeDefinition) || !Array.isArray(nodeDefinition.fields)) {
      return resolvedInputs;
    }

    for (const field of nodeDefinition.fields) {
      const rawValue = node.data?.values?.[field.key];
      if (rawValue && typeof rawValue === 'string') {
        // Pass the nodes array to resolveReferences for display name mapping
        resolvedInputs[field.key] = resolveReferences(rawValue, this.nodeOutputs, this.nodeOutputs, this.nodes);
      } else {
        resolvedInputs[field.key] = rawValue;
      }
    }

    return resolvedInputs;
  }

  async executeNode(nodeId: string, executedNodes: Set<string>): Promise<any> {
    if (executedNodes.has(nodeId)) {
      return this.nodeOutputs[nodeId] || null;
    }

    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) {
      console.error(`Node ${nodeId} not found`);
      return null;
    }

    // Get upstream nodes
    const upstreamEdges = this.edges.filter(edge => edge.target === nodeId);
    
    // Execute upstream nodes first
    for (const edge of upstreamEdges) {
      this.animateEdge(edge.id, true);
      await this.executeNode(edge.source, executedNodes);
      this.animateEdge(edge.id, false);
    }

    // Mark this node as executing
    this.setExecutingNode(nodeId);
    this.setNodeExecutionState(nodeId, true, false);

    try {
      console.log(`🚀 Executing node: ${nodeId} (${node.type})`);
      
      const nodeDefinition = node.data?.definition || nodeManifest[node.type as keyof typeof nodeManifest];
      if (!nodeDefinition || typeof nodeDefinition !== 'object' || !('action' in nodeDefinition) || !nodeDefinition.action) {
        console.log(`📋 Node ${nodeId} has no action defined, skipping execution`);
        executedNodes.add(nodeId);
        this.setNodeExecutionState(nodeId, false, false);
        this.setExecutingNode(null);
        return null;
      }

      // Resolve template variables in node inputs
      const resolvedInputs = this.resolveNodeInputs(node);
      console.log(`🔍 Resolved inputs for ${nodeId}:`, resolvedInputs);

      // Prepare request payload
      const requestPayload = {
        ...resolvedInputs,
        node_id: nodeId,
        node_type: node.type
      };

      const action = nodeDefinition.action as { url: string; method?: string };
      console.log(`📤 Sending request to ${action.url}:`, requestPayload);

      // Make API call
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1${action.url}`, {
        method: action.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`📥 Received response for ${nodeId}:`, result);

      // Update node with output
      this.updateNodeOutput(nodeId, result);
      executedNodes.add(nodeId);

      this.toast({
        title: "Node Executed",
        description: `${node.type} completed successfully`,
      });

      return result;

    } catch (error) {
      console.error(`❌ Error executing node ${nodeId}:`, error);
      this.setNodeExecutionState(nodeId, false, true);
      
      this.toast({
        title: "Execution Error",
        description: `Failed to execute ${node.type}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });

      executedNodes.add(nodeId); // Mark as executed even if failed to prevent infinite loops
      return null;
    } finally {
      this.setExecutingNode(null);
      this.setNodeExecutionState(nodeId, false, false);
    }
  }

  async executeAllNodes(): Promise<void> {
    console.log("🚀 Starting workflow execution");
    this.nodeOutputs = {}; // Reset outputs
    this.displayNameMapping = createDisplayNameMapping(this.nodes); // Refresh display name mapping
    
    const executedNodes = new Set<string>();
    
    // Find root nodes (nodes with no incoming edges)
    const rootNodes = this.nodes.filter(node => 
      !this.edges.some(edge => edge.target === node.id)
    );

    if (rootNodes.length === 0) {
      this.toast({
        title: "No Starting Nodes",
        description: "Please add at least one node without inputs to start execution",
        variant: "destructive",
      });
      return;
    }

    // Execute all root nodes
    for (const rootNode of rootNodes) {
      await this.executeNode(rootNode.id, executedNodes);
    }

    console.log("✅ Workflow execution completed");
  }
}
