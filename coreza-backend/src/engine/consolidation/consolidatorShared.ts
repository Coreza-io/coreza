import type { Bar } from "../../backtest/simBroker/interfaces";
import { parseBar } from "../../utils/barParser";
import { validateTimeframeRatio } from "../../utils/timeframe";
import {
  ConsolidationError,
  TimeBarConsolidator,
  type ConsolidationResult,
  type ConsolidatorState,
} from "./TimeBarConsolidator";

export interface ConsolidatorParameters {
  symbol: string;
  sourceTimeframe: string;
  targetTimeframe: string;
  timezone: string;
  anchorTime: string;
}

export interface ConsolidatorPayload {
  timeframe: string;
  emitted: boolean;
  bar: Bar | null;
  workingBar: Bar;
}

export interface ConsolidatorStepResult {
  key: string;
  payload: ConsolidatorPayload;
  state: ConsolidatorState;
}

export function buildConsolidatorConfigFingerprint(
  parameters: ConsolidatorParameters,
): string {
  return [
    parameters.symbol,
    parameters.sourceTimeframe,
    parameters.targetTimeframe,
    parameters.timezone || "UTC",
    parameters.anchorTime,
  ]
    .map((value) => String(value ?? "").trim())
    .map((value) => `${value.length}:${value}`)
    .join("|");
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
  if (!symbol) {
    throw new ConsolidatorValidationError(
      "INVALID_CONSOLIDATOR_CONFIG",
      "symbol is required",
    );
  }

  let ratio: ReturnType<typeof validateTimeframeRatio>;
  try {
    ratio = validateTimeframeRatio(
      parameters.sourceTimeframe,
      parameters.targetTimeframe,
    );
  } catch (error) {
    throw new ConsolidatorValidationError(
      "INVALID_CONSOLIDATOR_CONFIG",
      error instanceof Error ? error.message : "Invalid Consolidator timeframes",
    );
  }
  return [
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
  const validatedState = isConsolidatorState(storedState)
    ? storedState
    : undefined;

  let result: ConsolidationResult;
  try {
    const consolidator = new TimeBarConsolidator({
      sourceTimeframe: parameters.sourceTimeframe,
      targetTimeframe: parameters.targetTimeframe,
      timezone: parameters.timezone,
      anchorTime: parameters.anchorTime,
    });
    result = consolidator.update(bar, validatedState);
  } catch (error) {
    if (error instanceof ConsolidationError) throw error;
    throw new ConsolidatorValidationError(
      "INVALID_CONSOLIDATOR_CONFIG",
      error instanceof Error ? error.message : "Invalid Consolidator configuration",
    );
  }
  return {
    key,
    state: result.state,
    payload: {
      timeframe: validateTimeframeRatio(parameters.sourceTimeframe, parameters.targetTimeframe).target.normalized,
      emitted: Boolean(result.emitted),
      bar: result.emitted ?? null,
      workingBar: result.state.workingBar,
    },
  };
}

function isConsolidatorState(value: unknown): value is ConsolidatorState {
  if (!value || typeof value !== "object") return false;
  return (
    "workingBar" in value &&
    Boolean(value.workingBar) &&
    "lastInput" in value &&
    Boolean(value.lastInput)
  );
}
