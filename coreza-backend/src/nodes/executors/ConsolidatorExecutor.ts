import { ConsolidationError } from "../../engine/consolidation/TimeBarConsolidator";
import {
  buildConsolidatorStateKey,
  ConsolidatorValidationError,
  runConsolidatorStep,
} from "../../engine/consolidation/consolidatorShared";
import type { NodeExecutionContext } from "../../engine/types/executionContext";
import type { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { consolidatorLateBarRejectsCounter } from "../../utils/metrics";

export class ConsolidatorExecutor implements INodeExecutor {
  readonly category = "Consolidator";
  readonly syncCapable = true;

  execute(node: WorkflowNode, input: NodeInput, context?: NodeExecutionContext): NodeResult {
    let symbol = "";
    let sourceTimeframe = "";
    let targetTimeframe = "";
    try {
      const params = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      symbol = String(params.symbol ?? "").trim();
      sourceTimeframe = String(params.source_timeframe ?? "").trim();
      targetTimeframe = String(params.target_timeframe ?? "").trim();
      const timezone = String(params.timezone ?? "UTC").trim() || "UTC";
      const anchorTime = String(params.anchor_time ?? "").trim();
      const requestedScanGraceMs = Number(params.scan_grace_ms);
      const scanGraceMs = Number.isFinite(requestedScanGraceMs) && requestedScanGraceMs >= 0
        ? requestedScanGraceMs
        : undefined;
      const dataContext = context?.dataContext;
      if (!dataContext) {
        return {
          success: false,
          data: null,
          code: "STATE_UNAVAILABLE",
          error: "Consolidator requires an active execution data context",
        };
      }

      const parameters = {
        nodeId: node.id,
        symbol,
        sourceTimeframe,
        targetTimeframe,
        timezone,
        anchorTime,
        ...(scanGraceMs === undefined ? {} : { scanGraceMs }),
      };
      const stateKey = buildConsolidatorStateKey(parameters);
      const storedState: unknown = dataContext.getDataByKey(stateKey);
      const result = runConsolidatorStep(
        parameters,
        params.candle_data ?? input,
        storedState,
      );
      dataContext.setData(stateKey, result.state, {
        kind: "consolidator_state",
        nodeId: node.id,
        symbol,
        sourceTimeframe: result.payload.sourceTimeframe,
        targetTimeframe: result.payload.targetTimeframe,
        timezone,
        anchorTime,
        ...(scanGraceMs === undefined ? {} : { scanGraceMs }),
      });
      return {
        success: true,
        data: result.payload,
        control: { suppressDownstream: !result.payload.emitted },
      };
    } catch (error) {
      if (error instanceof ConsolidationError && error.code === "LATE_BAR_AFTER_EMIT") {
        consolidatorLateBarRejectsCounter.inc();
        return {
          success: true,
          data: {
            emitted: false,
            bar: null,
            workingBar: null,
            emissionReason: null,
            emittedAt: null,
            symbol,
            sourceTimeframe,
            targetTimeframe,
            lateBarDropped: true,
          },
          control: { suppressDownstream: true },
        };
      }
      return {
        success: false,
        data: null,
        code:
          error instanceof ConsolidationError ||
          error instanceof ConsolidatorValidationError
            ? error.code
            : "CONSOLIDATION_ERROR",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
