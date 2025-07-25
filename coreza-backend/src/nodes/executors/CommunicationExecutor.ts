import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { CommunicationService } from '../../services/communications';

export class CommunicationExecutor implements INodeExecutor {
  readonly category = 'Communication';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const nodeType = node.type;
      const operation = node.values?.operation || 'send';

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters ? 
        context.resolveNodeParameters(node, input) : 
        { ...node.values, ...input };

      const combinedInput = {
        ...input,
        ...resolvedParams
      };

      let result;
      switch (nodeType) {
        case 'Gmail':
          result = await CommunicationService.execute('gmail', operation, combinedInput);
          break;
        case 'WhatsApp':
          result = await CommunicationService.execute('whatsapp', operation, combinedInput);
          break;
        default:
          return {
            success: false,
            error: `Unsupported communication node type: ${nodeType}`
          };
      }

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${nodeType} ${operation} operation failed`
        };
      }

      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Communication execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}