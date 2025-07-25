import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { getBrokerService } from '../../services/brokers/registry';

export class BrokerExecutor implements INodeExecutor {
  readonly category = 'Broker';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const operation = node.values?.operation;
      const broker = node.type;
      const credential_id = node.values?.credential_id;
      
      if (!credential_id) {
        return {
          success: false,
          error: `${broker || 'Broker'} credential_id is required`
        };
      }

      // Resolve and merge node parameters with input data
      console.log(`🔧 [BROKER] Starting parameter resolution for node ${node.id}`);
      const resolvedParams = context?.resolveNodeParameters ? 
        context.resolveNodeParameters(node, input) : 
        { ...node.values, ...input };
      console.log(`🔧 [BROKER] Parameter resolution completed for node ${node.id}`);
      
      const brokerService = getBrokerService(broker);
      if (!brokerService) {
        return {
          success: false,
          error: `Unsupported broker: ${broker}`
        };
      }

      const result = await brokerService.execute({ 
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