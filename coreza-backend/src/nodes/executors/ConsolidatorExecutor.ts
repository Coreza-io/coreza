import { resultSuccess, resultFailure } from "../../contracts/nodeResult";
import { ConsolidationError, type ConsolidatorState } from "../../engine/consolidation/TimeBarConsolidator";
import {
  buildConsolidatorStateKey,
  ConsolidatorValidationError,
  runConsolidatorStep,
} from "../../engine/consolidation/consolidatorShared";
import type { NodeExecutionContext } from "../../engine/types/executionContext";
import type { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { parseTimeframe } from "../../utils/timeframe";

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
      const endTimestamp = result.state.workingBar.endTimestamp;
      const barContext = context?.multiBarContext;
      if (context?.isWarmingUp && result.state.lastEmittedEndTimestamp !== endTimestamp) {
        const endTime = Date.parse(endTimestamp);
        const sourceMs = parseTimeframe(sourceTimeframe).milliseconds;
        const isAligned = (state: ConsolidatorState) =>
          (endTime - new Date(state.lastInput.timestamp).getTime()) % sourceMs === 0;
        // A source candle may straddle an offset bucket boundary. Let its
        // normal update deliver that bucket after the source candle closes.
        if (isAligned(result.state)) {
          barContext?.scheduleConsolidatorClose?.(
            node.id, stateKey, endTime,
            () => {
              const state: ConsolidatorState | undefined = dataContext.getDataByKey(stateKey);
              if (state?.workingBar.endTimestamp !== endTimestamp || state.lastEmittedEndTimestamp === endTimestamp
                || !isAligned(state)) return;
              dataContext.setData(stateKey, { ...state, lastEmittedEndTimestamp: endTimestamp });
              return resultSuccess({ ...result.payload, emitted: true, bar: state.workingBar, workingBar: state.workingBar });
            },
            context.getAllNodeResults,
            barContext,
          );
        }
      }
      return resultSuccess(result.payload);
    } catch (error) {
      return resultFailure(error instanceof Error ? error.message : String(error), { data: null, details: { code: error instanceof ConsolidationError ||
          error instanceof ConsolidatorValidationError
            ? error.code
            : "CONSOLIDATION_ERROR" } });
    }
  }
}
