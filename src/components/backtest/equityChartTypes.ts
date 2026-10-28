export type EquityChartType = "line" | "candle";
export type EquityInterval = "auto" | "1m" | "5m" | "15m" | "1h" | "1D";
export type FixedEquityInterval = Exclude<EquityInterval, "auto">;

export interface EquityChartContext {
  runId: string;
  mode: "backtest" | "live";
  active: boolean;
  initialCapital?: number | null;
  capitalInferred?: boolean;
}

export interface EquityCandle {
  startMs: number;
  endMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  returnPct: number | null;
  sampleCount: number;
  // Daily persisted rows do not retain individual observation timestamps.
  firstObservedMs: number | null;
  lastObservedMs: number | null;
  isProvisional: boolean;
  quality: "observed" | "sparse";
  returnSpansGap: boolean;
}

export interface EquityChartModel {
  candles: EquityCandle[];
  interval: FixedEquityInterval;
  candleAvailable: boolean;
  unavailableReason?: string;
  diagnostics: { invalidRows: number; duplicateRows: number; foreignRows: number };
}
