export interface NodeInput { 
  [key: string]: any; 
}

export interface NodeResult { 
  success: boolean; 
  data?: any; 
  error?: string; 
}

export interface INodeExecutor {
  readonly category: string; // e.g. "IO", "Indicators", "Broker"
  execute(node: any, input: NodeInput, context?: any): Promise<NodeResult>;
}

// Type for workflow node structure
export interface WorkflowNode {
  id: string;
  type: string;
  category: string;
  values?: { [key: string]: any };
  data?: {
    definition?: any;
    values?: { [key: string]: any };
  };
}