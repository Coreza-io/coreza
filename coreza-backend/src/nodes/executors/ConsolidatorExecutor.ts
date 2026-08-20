import { TimeBarConsolidator, ConsolidationError, type ConsolidatorState } from "../../engine/consolidation/TimeBarConsolidator";
import type { NodeExecutionContext } from "../../engine/types/executionContext";
import { parseBar } from "../../utils/barParser";
import { validateTimeframeRatio } from "../../utils/timeframe";
import type { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";

function isConsolidatorState(value: unknown): value is ConsolidatorState {
  if (!value || typeof value !== "object") return false;
  return "workingBar" in value && Boolean(value.workingBar) &&
    "lastInput" in value && Boolean(value.lastInput);
}

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
      if (!symbol) return { success: false, data: null, code: "INVALID_CONSOLIDATOR_CONFIG", error: "symbol is required" };
      const ratio = validateTimeframeRatio(sourceTimeframe, targetTimeframe);
      const bar = parseBar(params.candle_data ?? input);
      if (!bar) return { success: false, data: null, code: "INVALID_BAR", error: "candle_data must be a valid finite OHLCV bar" };
      if (!context?.getState || !context.setState) {
        return { success: false, data: null, code: "STATE_UNAVAILABLE", error: "Consolidator requires node execution state" };
      }

      const stateKey = [symbol, ratio.source.normalized, ratio.target.normalized, timezone, anchorTime].join(":");
      const consolidator = new TimeBarConsolidator({ sourceTimeframe, targetTimeframe, timezone, anchorTime });
      const storedState: unknown = context.getState(stateKey);
      if (storedState !== undefined && !isConsolidatorState(storedState)) {
        return { success: false, data: null, code: "INVALID_CONSOLIDATOR_STATE", error: "Stored consolidator state is invalid" };
      }
      const result = consolidator.update(bar, storedState);
      context.setState(stateKey, result.state);
      return {
        success: true,
        data: {
          emitted: Boolean(result.emitted),
          bar: result.emitted ?? null,
          workingBar: result.state.workingBar,
        },
        control: { suppressDownstream: !result.emitted },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        code: error instanceof ConsolidationError ? error.code : "CONSOLIDATION_ERROR",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
