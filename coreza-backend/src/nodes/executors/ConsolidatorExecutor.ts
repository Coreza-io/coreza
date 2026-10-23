import { resultSuccess, resultFailure } from "../../contracts/nodeResult";
import { ConsolidationError } from "../../engine/consolidation/TimeBarConsolidator";
import {
  buildConsolidatorStateKey,
  ConsolidatorValidationError,
  runConsolidatorStep,
} from "../../engine/consolidation/consolidatorShared";
import type { NodeExecutionContext } from "../../engine/types/executionContext";
import type { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";

export class ConsolidatorExecutor implements INodeExecutor {
  readonly category = "Consolidator";
  readonly syncCapable = true;

  execute(node: WorkflowNode, input: NodeInput, context?: NodeExecutionContext): NodeResult {
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      const symbol = String(params.symbol ?? "").trim();
      const sourceTimeframe = String(params.source_timeframe ?? "").trim();
      const targetTimeframe = String(params.target_timeframe ?? "").trim();
      const timezone = String(params.timezone ?? "UTC").trim() || "UTC";
      const anchorTime = String(params.anchor_time ?? "").trim();
      const dataContext = context?.dataContext;
      if (!dataContext) {
        return resultFailure("Consolidator requires an active execution data context", { data: null, details: { code: "STATE_UNAVAILABLE" } });
      }

      const parameters = { symbol, sourceTimeframe, targetTimeframe, timezone, anchorTime };
      const stateKey = buildConsolidatorStateKey(parameters);
      const storedState: unknown = dataContext.getDataByKey(stateKey);
      const result = runConsolidatorStep(
        parameters,
        params.candle_data ?? input,
        storedState,
      );
      dataContext.setData(stateKey, result.state);
      return resultSuccess(result.payload);
    } catch (error) {
      return resultFailure(error instanceof Error ? error.message : String(error), { data: null, details: { code: error instanceof ConsolidationError ||
          error instanceof ConsolidatorValidationError
            ? error.code
            : "CONSOLIDATION_ERROR" } });
    }
  }
}
