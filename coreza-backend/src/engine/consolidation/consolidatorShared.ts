import type { Bar } from "../../backtest/simBroker/interfaces";
import { parseBar } from "../../utils/barParser";
import { validateTimeframeRatio } from "../../utils/timeframe";
import {
  TimeBarConsolidator,
  type ConsolidatorState,
} from "./TimeBarConsolidator";

export interface ConsolidatorParameters {
  nodeId: string;
  symbol: string;
  sourceTimeframe: string;
  targetTimeframe: string;
  timezone: string;
  anchorTime: string;
}

export interface ConsolidatorPayload {
  emissionId?: string;
  emitted: boolean;
  bar: Bar | null;
  workingBar: Bar | null;
  emissionReason: "boundary_input" | "time_scan" | null;
  emittedAt: string | null;
  symbol: string;
  sourceTimeframe: string;
  targetTimeframe: string;
}

export interface ConsolidatorStepResult {
  key: string;
  payload: ConsolidatorPayload;
  state: ConsolidatorState;
}

export class ConsolidatorValidationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CONSOLIDATOR_CONFIG"
      | "INVALID_BAR"
      | "INVALID_CONSOLIDATOR_STATE",
    message: string,
  ) {
    super(message);
    this.name = "ConsolidatorValidationError";
  }
}

export function buildConsolidatorStateKey(
  parameters: ConsolidatorParameters,
): string {
  const symbol = parameters.symbol.trim();
  const nodeId = parameters.nodeId.trim();
  if (!nodeId) {
    throw new ConsolidatorValidationError(
      "INVALID_CONSOLIDATOR_CONFIG",
      "node_id is required",
    );
  }
  if (!symbol) {
    throw new ConsolidatorValidationError(
      "INVALID_CONSOLIDATOR_CONFIG",
      "symbol is required",
    );
  }

  const ratio = validateTimeframeRatio(
    parameters.sourceTimeframe,
    parameters.targetTimeframe,
  );
  return [
    "consolidator",
    nodeId,
    symbol,
    ratio.source.normalized,
    ratio.target.normalized,
    parameters.timezone,
    parameters.anchorTime,
  ].join(":");
}

export function runConsolidatorStep(
  parameters: ConsolidatorParameters,
  candleData: unknown,
  storedState?: unknown,
): ConsolidatorStepResult {
  const key = buildConsolidatorStateKey(parameters);
  const bar = parseBar(candleData);
  if (!bar) {
    throw new ConsolidatorValidationError(
      "INVALID_BAR",
      "candle_data must be a valid finite OHLCV bar",
    );
  }
  if (storedState !== undefined && !isConsolidatorState(storedState)) {
    throw new ConsolidatorValidationError(
      "INVALID_CONSOLIDATOR_STATE",
      "Stored consolidator state is invalid",
    );
  }

  const consolidator = new TimeBarConsolidator({
    sourceTimeframe: parameters.sourceTimeframe,
    targetTimeframe: parameters.targetTimeframe,
    timezone: parameters.timezone,
    anchorTime: parameters.anchorTime,
  });
  const result = consolidator.update(bar, storedState);
  return {
    key,
    state: result.state,
    payload: {
      emitted: Boolean(result.emitted),
      bar: result.emitted ?? null,
      workingBar: result.state.workingBar ?? null,
      emissionReason: result.emissionReason ?? null,
      emittedAt: result.emittedAt ?? null,
      symbol: parameters.symbol,
      sourceTimeframe: validateTimeframeRatio(parameters.sourceTimeframe, parameters.targetTimeframe).source.normalized,
      targetTimeframe: validateTimeframeRatio(parameters.sourceTimeframe, parameters.targetTimeframe).target.normalized,
    },
  };
}

export function isConsolidatorState(value: unknown): value is ConsolidatorState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ConsolidatorState>;
  return Number.isSafeInteger(state.sourceBarCount) &&
    (state.sourceBarCount ?? -1) >= 0 &&
    (state.workingBar === undefined || (parseBar(state.workingBar) !== null &&
      Number.isFinite(new Date(state.workingBar.endTimestamp).getTime()))) &&
    (state.lastInput === undefined || parseBar(state.lastInput) !== null) &&
    (state.lastEmittedEndTimestamp === undefined ||
      Number.isFinite(new Date(state.lastEmittedEndTimestamp).getTime()));
}
