import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { BrokerService } from '../../services/brokers';

export class BrokerExecutor implements INodeExecutor {
  readonly category = 'Broker';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const operation = node.values?.operation;
      const broker = node.values?.type;
      const credential_id = node.values?.credential_id;
      
      if (!credential_id) {
        return {
          success: false,
          error: `${broker || 'Broker'} credential_id is required`
        };
      }

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters ? 
        context.resolveNodeParameters(node, input) : 
        { ...node.values, ...input };
      
      const result = await BrokerService.execute(broker, { 
        user_id: context?.userId,
        credential_id,
        operation,
        ...resolvedParams,
        input
      });
      
      if (!result.success) {
        return {
          success: false,
          error: result.error || `${broker} ${operation} operation failed`
        };
      }
      
      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      return {
        success: false,
        error: `Broker execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}