import { Node, Edge } from '@xyflow/react';

export interface ExecutionContext {
  nodes: Node[];
  edges: Edge[];
  setNodes: (update: (nodes: Node[]) => Node[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void;
  setExecutingNode: (nodeId: string | null) => void;
  toast: (params: any) => void;
}

export interface NodeExecutionDetail {
  nodeId: string;
  executedNodes: Set<string>;
  allNodes: Node[];
  allEdges: Edge[];
  explicitlyTriggered?: boolean;
  onSuccess?: (result?: any) => void;
  onError?: (error: any) => void;
}

export class WorkflowExecutor {
  private context: ExecutionContext;
  private isAutoExecuting = false;

  constructor(context: ExecutionContext) {
    this.context = context;
  }

  /**
   * Get execution levels for parallel execution, excluding conditional targets
   */
  getExecutionLevels(): string[][] {
    console.log("🔥 Building execution levels...");
    
    // Identify nodes that are targets of conditional edges (true/false handles from If nodes)
    const conditionalTargetNodes = new Set<string>();
    this.context.edges.forEach(edge => {
      const sourceNode = this.context.nodes.find(n => n.id === edge.source);
      if (sourceNode && (sourceNode.data?.definition as any)?.name === "If") {
        if (edge.sourceHandle === 'true' || edge.sourceHandle === 'false') {
          conditionalTargetNodes.add(edge.target);
          console.log(`🚫 Excluding conditional target from auto-execution: ${edge.target} (from If node: ${edge.source})`);
        }
      }
    });
    
    // Only include nodes that are NOT conditional targets in automatic execution levels
    const nodeIds = this.context.nodes.map(node => node.id).filter(id => !conditionalTargetNodes.has(id));
    console.log(`✅ Nodes included in execution levels:`, nodeIds);
    console.log(`🚫 Conditional targets excluded:`, Array.from(conditionalTargetNodes));
    
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();
    
    // Initialize
    nodeIds.forEach(id => {
      inDegree.set(id, 0);
      adjList.set(id, []);
    });
    
    // Build adjacency list and calculate in-degrees
    this.context.edges.forEach(edge => {
      const source = edge.source;
      const target = edge.target;
      
      // Add edge to adjacency list if source is in execution levels
      if (adjList.has(source)) {
        adjList.get(source)!.push(target);
      }
      
      // Increment in-degree for target if it's in execution levels
      if (inDegree.has(target)) {
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
      console.log(`📊 Level ${levels.length - 1}:`, currentLevel);
      
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
    
    console.log(`🎯 Final execution levels:`, levels);
    return levels;
  }

  /**
   * Execute conditional chain starting from a specific node
   */
  async executeConditionalChain(startNodeId: string, completedNodes: Set<string>): Promise<void> {
    console.log(`🎯 Starting conditional chain execution from: ${startNodeId}`);
    
    return new Promise<void>((resolve) => {
      const nodeExecuteEvent = new CustomEvent('auto-execute-node', {
        detail: { 
          nodeId: startNodeId,
          executedNodes: completedNodes,
          allNodes: this.context.nodes,
          allEdges: this.context.edges,
          onSuccess: (result?: any) => {
            console.log(`✅ Conditional target node ${startNodeId} executed successfully`);
            completedNodes.add(startNodeId);
            
            // If this is also an If node, handle its conditional logic
            const currentNode = this.context.nodes.find(n => n.id === startNodeId);
            if ((currentNode?.data?.definition as any)?.name === "If" && result) {
              this.handleIfNodeResult(startNodeId, result, completedNodes);
            } else {
              // For non-If nodes, execute all immediate non-conditional downstream nodes
              this.executeDownstreamNodes(startNodeId, completedNodes);
            }
            resolve();
          },
          onError: (error: any) => {
            console.error(`❌ Conditional node ${startNodeId} failed:`, error);
            resolve();
          }
        } as NodeExecutionDetail
      });
      window.dispatchEvent(nodeExecuteEvent);
    });
  }

  /**
   * Handle If node result and execute appropriate conditional path
   */
  private handleIfNodeResult(nodeId: string, result: any, completedNodes: Set<string>): void {
    const conditionResult = result.true === true;
    console.log(`🔀 If node ${nodeId} condition: ${conditionResult}`);
   
    const outgoingEdges = this.context.edges.filter(edge => edge.source === nodeId);
    const activeEdge = conditionResult 
      ? outgoingEdges.find(edge => edge.sourceHandle === 'true')
      : outgoingEdges.find(edge => edge.sourceHandle === 'false');
   
    if (activeEdge) {
      console.log(`🎯 If node activating ${conditionResult ? 'TRUE' : 'FALSE'} path to: ${activeEdge.target}`);
      // Execute the conditional target immediately
      this.executeConditionalChain(activeEdge.target, new Set([...completedNodes]));
    }
  }

  /**
   * Execute downstream nodes for non-conditional flows
   */
  private executeDownstreamNodes(startNodeId: string, completedNodes: Set<string>): void {
    const downstreamEdges = this.context.edges.filter(edge => {
      if (edge.source !== startNodeId) return false;
      
      // Only include non-conditional edges (regular flow)
      const sourceNode = this.context.nodes.find(n => n.id === edge.source);
      const isConditionalEdge = sourceNode && 
        (sourceNode.data?.definition as any)?.name === "If" && 
        (edge.sourceHandle === 'true' || edge.sourceHandle === 'false');
      
      return !isConditionalEdge;
    });
    
    // Execute downstream nodes in parallel
    downstreamEdges.forEach(edge => {
      console.log(`🔄 Triggering downstream node: ${edge.target}`);
      this.executeConditionalChain(edge.target, new Set([...completedNodes]));
    });
  }

  /**
   * Execute a single node with visual feedback
   */
  async executeNode(nodeId: string, executedNodes: Set<string>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.context.setExecutingNode(nodeId);
      
      // Find all edges connected to this node
      const connectedEdges = this.context.edges.filter(edge => 
        edge.source === nodeId || edge.target === nodeId
      );
      
      // Highlight executing edges
      this.context.setEdges(currentEdges => 
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
      
      // Highlight executing node
      this.context.setNodes(currentNodes =>
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
      
      // Trigger node execution
      const nodeExecuteEvent = new CustomEvent('auto-execute-node', {
        detail: { 
          nodeId,
          executedNodes,
          allNodes: this.context.nodes,
          allEdges: this.context.edges,
          onSuccess: (result?: any) => {
            console.log(`✅ Node ${nodeId} executed successfully`, result);
            
            // Handle If node special logic
            const currentNode = this.context.nodes.find(n => n.id === nodeId);
            if ((currentNode?.data?.definition as any)?.name === "If" && result) {
              this.handleIfNodeResult(nodeId, result, executedNodes);
            }
            
            resolve();
          },
          onError: (error: any) => {
            console.error(`❌ Node ${nodeId} failed:`, error);
            reject(error);
          }
        } as NodeExecutionDetail
      });
      window.dispatchEvent(nodeExecuteEvent);
    });
  }

  /**
   * Execute all nodes in the workflow following dependency order
   */
  async executeAllNodes(): Promise<void> {
    console.log("🚀 executeAllNodes called");
    
    if (this.isAutoExecuting) {
      console.log("⚠️ Already executing, returning");
      return;
    }
    
    const executionLevels = this.getExecutionLevels();
    console.log("📋 Execution levels:", executionLevels);
    
    if (executionLevels.length === 0 || executionLevels.every(level => level.length === 0)) {
      console.log("❌ No nodes to execute");
      this.context.toast({
        title: "No Nodes",
        description: "No nodes to execute",
        variant: "destructive",
      });
      return;
    }
    
    this.isAutoExecuting = true;
    
    try {
      for (let levelIndex = 0; levelIndex < executionLevels.length; levelIndex++) {
        const currentLevel = executionLevels[levelIndex];
        
        if (currentLevel.length === 0) continue;
        
        console.log(`🔥 Executing Level ${levelIndex + 1}: [${currentLevel.join(', ')}]`);
        
        // Build executed nodes set from previous levels
        const executedNodes = new Set<string>();
        if (levelIndex > 0) {
          for (let prevLevel = 0; prevLevel < levelIndex; prevLevel++) {
            executionLevels[prevLevel].forEach(nodeId => executedNodes.add(nodeId));
          }
        }
        
        // Execute all nodes in this level in parallel
        await Promise.all(currentLevel.map(nodeId => 
          this.executeNode(nodeId, executedNodes)
        ));
        
        console.log(`✅ Level ${levelIndex + 1} completed`);
      }
      
      console.log("🎉 All execution levels completed successfully!");
      this.context.toast({
        title: "Execution Complete",
        description: "All workflow nodes executed successfully",
      });
      
    } catch (error) {
      console.error("❌ Execution failed:", error);
      this.context.toast({
        title: "Execution Failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      this.isAutoExecuting = false;
      this.context.setExecutingNode(null);
      
      // Reset all visual indicators
      this.context.setEdges(currentEdges => 
        currentEdges.map(edge => ({
          ...edge,
          animated: false,
          className: '',
          style: { ...edge.style, stroke: undefined, strokeWidth: undefined }
        }))
      );
      
      this.context.setNodes(currentNodes =>
        currentNodes.map(node => ({
          ...node,
          className: '',
          style: { ...node.style, border: undefined, backgroundColor: undefined, boxShadow: undefined }
        }))
      );
    }
  }

  setAutoExecuting(value: boolean): void {
    this.isAutoExecuting = value;
  }

  getIsAutoExecuting(): boolean {
    return this.isAutoExecuting;
  }
}