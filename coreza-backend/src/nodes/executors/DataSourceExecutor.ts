import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { DataService } from "../../services/data";
import { RedisService } from "../../services/RedisService";

export class DataSourceExecutor implements INodeExecutor {
  readonly category = "DataSource";

  async execute(
    node: WorkflowNode,
    input: NodeInput,
    context?: any
  ): Promise<NodeResult> {
    try {
      // Check both node.type and node.name since JSON definitions use 'name'
      const nodeType = node.type || node.name;
      const operation = node.values?.operation || "get_quote";

      // Resolve and merge node parameters with input data
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };

      // Special handling for backtesting - ensure historical data operations
      if (
        resolvedParams.historical ||
        resolvedParams.start_date ||
        resolvedParams.end_date
      ) {
        resolvedParams.operation = "get_historical_data";
      }

      const combinedInput = {
        ...input,
        ...resolvedParams,
      };

      console.log(
        `🔍 [DataSource] Executing ${nodeType} with params:`,
        combinedInput
      );

      let result;
      switch (nodeType) {
        case "FinnHub":
          result = await DataService.execute(
            "finnhub",
            resolvedParams.operation,
            combinedInput
          );
          break;
        case "YahooFinance":
          resolvedParams.operation = "get_history";
          result = await DataService.execute(
            "yahoofinance",
            resolvedParams.operation,
            combinedInput
          );
          break;
        case "RedisStore":
          const userId = context?.userId || input.userId;
          const credentialId = resolvedParams.credential_id;
          
          if (!userId || !credentialId) {
            return {
              success: false,
              error: "userId and credential_id are required for Redis operations"
            };
          }
          
          result = await RedisService.execute({
            userId,
            credentialId,
            operation: resolvedParams.operation,
            scope: resolvedParams.scope,
            key: resolvedParams.key,
            value: resolvedParams.value,
            keyType: resolvedParams.keyType,
            pattern: resolvedParams.pattern,
            channel: resolvedParams.channel,
            hashField: resolvedParams.hashField,
            setMember: resolvedParams.setMember,
            popDirection: resolvedParams.popDirection,
            pushDirection: resolvedParams.pushDirection,
          members: resolvedParams.members,
          member: resolvedParams.member,
          otherKeys: resolvedParams.otherKeys,
          incrementBy: resolvedParams.incrementBy,
            ttl: resolvedParams.ttl,
            workflowId: context?.workflowId || input.workflowId
          });
          break;
        default:
          return {
            success: false,
            error: `Unsupported data source node type: ${nodeType}`,
          };
      }

      if (!result.success) {
        return {
          success: false,
          error:
            result.error ||
            `${nodeType} ${resolvedParams.operation} operation failed`,
        };
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: `Data source execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
