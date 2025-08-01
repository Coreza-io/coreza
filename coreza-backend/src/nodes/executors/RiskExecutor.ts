import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from '../types';
import { RiskEngineService } from '../../services/risk';

export class RiskExecutor implements INodeExecutor {
  readonly category = 'Risk Management';

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    try {
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      const result = RiskEngineService.evaluate(resolvedParams);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, data: result.data };
    } catch (error) {
      return {
        success: false,
        error: `Risk engine execution failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
