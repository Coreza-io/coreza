export type IndicatorTypeId =
  | "rsi"
  | "ema"
  | "sma"
  | "macd"
  | "bb"
  | "adx"
  | "stoch"
  | "vwap"
  | "obv"
  | "volume_oscillator"
  | "ichimoku"
  | "support_resistance";

export type IndicatorChannel = {
  key: string;
  aliases?: string[];
  label: string;
  color: string;
  style?: "line" | "histogram";
  dashed?: boolean;
};

export type IndicatorSpec = {
  id: IndicatorTypeId;
  label: string;
  pane: "price" | "panel";
  kind: "line" | "bands" | "levels" | "multi";
  channels?: IndicatorChannel[];
  bands?: { upper: string; middle?: string; lower: string };
  levels?: { supports: string; resistances: string };
  referenceLines?: Array<{ price: number; color: string; label?: string }>;
};

const INDICATOR_SPECS: Record<IndicatorTypeId, IndicatorSpec> = {
  rsi: {
    id: "rsi",
    label: "RSI",
    pane: "panel",
    kind: "multi",
    channels: [{ key: "value", label: "RSI", color: "#8b5cf6" }],
    referenceLines: [
      { price: 30, color: "#64748b", label: "RSI 30" },
      { price: 70, color: "#64748b", label: "RSI 70" },
    ],
  },
  ema: {
    id: "ema",
    label: "EMA",
    pane: "price",
    kind: "line",
    channels: [{ key: "value", label: "EMA", color: "#3b82f6" }],
  },
  sma: {
    id: "sma",
    label: "SMA",
    pane: "price",
    kind: "line",
    channels: [{ key: "value", label: "SMA", color: "#0ea5e9" }],
  },
  macd: {
    id: "macd",
    label: "MACD",
    pane: "panel",
    kind: "multi",
    channels: [
      { key: "macd", label: "MACD", color: "#3b82f6" },
      { key: "signal", label: "Signal", color: "#f59e0b", dashed: true },
      { key: "histogram", label: "Histogram", color: "#a855f7", style: "histogram" },
    ],
  },
  bb: { id: "bb", label: "Bollinger Bands", pane: "price", kind: "bands", bands: { upper: "upper", middle: "middle", lower: "lower" } },
  adx: {
    id: "adx",
    label: "ADX",
    pane: "panel",
    kind: "multi",
    channels: [
      { key: "adx", label: "ADX", color: "#3b82f6" },
      { key: "pdi", label: "+DI", color: "#22c55e" },
      { key: "mdi", label: "-DI", color: "#ef4444" },
    ],
  },
  stoch: {
    id: "stoch",
    label: "Stochastic",
    pane: "panel",
    kind: "multi",
    channels: [
      { key: "k", label: "%K", color: "#3b82f6" },
      { key: "d", label: "%D", color: "#f59e0b", dashed: true },
    ],
    referenceLines: [
      { price: 20, color: "#64748b", label: "Stoch 20" },
      { price: 80, color: "#64748b", label: "Stoch 80" },
    ],
  },
  vwap: { id: "vwap", label: "VWAP", pane: "price", kind: "line", channels: [{ key: "vwap", label: "VWAP", color: "#14b8a6" }] },
  obv: { id: "obv", label: "OBV", pane: "panel", kind: "line", channels: [{ key: "obv", label: "OBV", color: "#6366f1" }] },
  volume_oscillator: { id: "volume_oscillator", label: "Volume Oscillator", pane: "panel", kind: "line", channels: [{ key: "value", label: "Volume Oscillator", color: "#10b981" }] },
  ichimoku: {
    id: "ichimoku",
    label: "Ichimoku",
    pane: "price",
    kind: "multi",
    channels: [
      { key: "conversion", label: "Tenkan (Conversion)", color: "#3b82f6" },
      { key: "base", label: "Kijun (Base)", color: "#f59e0b" },
      { key: "spanA", label: "Senkou Span A", color: "#22c55e" },
      { key: "spanB", label: "Senkou Span B", color: "#ef4444" },
    ],
  },
  support_resistance: {
    id: "support_resistance",
    label: "Support & Resistance",
    pane: "price",
    kind: "levels",
    levels: { supports: "support", resistances: "resistance" },
  },
};

export const getIndicatorSpec = (id?: string): IndicatorSpec | undefined => {
  if (!id) return undefined;
  return INDICATOR_SPECS[id as IndicatorTypeId];
};
