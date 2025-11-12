import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { getScreenerService } from "../../services/screeners/registry";

export class ScreenerExecutor implements INodeExecutor {
  readonly category = "Screener";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      const operation = node.values?.operation;
      const screener = node.subCategory ?? node.name ?? node.node_type;
      const credential_id = node.values?.credential_id;

      // Credential is optional for manual screeners
      if (!credential_id && screener !== "YahooFinance") {
        return {
          success: false,
          error: `${screener || "Screener"} credential_id is required`,
        };
      }

      // Resolve and merge node parameters with input data
      console.log(
        `📊 [SCREENER] Starting parameter resolution for node ${node.id}`
      );
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      console.log(
        `📊 [SCREENER] Parameter resolution completed for node ${node.id}`,
        resolvedParams
      );

      const screenerService = getScreenerService(screener);
      if (!screenerService) {
        return {
          success: false,
          error: `Unsupported screener: ${screener}`,
        };
      }

      console.log(
        `📊 [SCREENER] Executing ${screener} screener with operation: ${operation}`
      );
      const result = await screenerService.execute({
        user_id: context?.userId,
        credential_id,
        operation,
        ...resolvedParams,
        input,
      });

      if (!result.success) {
        return {
          success: false,
          error: result.error || `${screener} ${operation} operation failed`,
        };
      }

      console.log(`📊 [SCREENER] ${screener} screener completed successfully`);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error("[SCREENER] Execution error:", error);
      return {
        success: false,
        error: `Screener execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
