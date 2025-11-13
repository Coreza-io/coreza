import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { IndicatorService } from "../../services/indicators";

export class IndicatorsExecutor implements INodeExecutor {
  readonly category = "Indicators";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const indicatorType = (node.name || node.node_type)?.toLowerCase();
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      console.log(
        `🔢 Executing ${indicatorType} indicator with params:`,
        resolvedParams
      );

      const result = await IndicatorService.calculate(
        indicatorType,
        resolvedParams
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${indicatorType} calculation failed`,
        };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: `Indicator execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
