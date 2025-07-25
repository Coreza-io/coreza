import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';

export class IOExecutor implements INodeExecutor {
  readonly category = 'IO';

  async execute(node: WorkflowNode, input: NodeInput): Promise<NodeResult> {
    try {
      // Handle different IO node types
      const nodeType = node.type;
      
      switch (nodeType) {
        case 'ChatInput':
          return this.executeChatInput(node, input);
        default:
          return { 
            success: false, 
            error: `Unsupported IO node type: ${nodeType}` 
          };
      }
    } catch (error) {
      return { 
        success: false, 
        error: `IO execution failed: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  private async executeChatInput(node: WorkflowNode, input: NodeInput): Promise<NodeResult> {
    // Handle chat input logic
    const message = node.values?.message || input.message || '';
    
    return {
      success: true,
      data: {
        message,
        timestamp: new Date().toISOString(),
        source: 'chat_input'
      }
    };
  }
}