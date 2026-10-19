import type { Bar } from "../brokers/types";

function finiteNumber(value: unknown, field: string): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) {
    throw new Error(`Candle ${field} is required`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid candle ${field}`);
  return number;
}

/** Broker Bar timestamps are Unix milliseconds; raw feeds may use Unix seconds. */
export function candleTimestamp(value: unknown): number {
  const numeric = typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value));
  const time = numeric ? Number(value) : typeof value === "string" ? Date.parse(value) : NaN;
  const milliseconds = numeric && Math.abs(time) < 100_000_000_000 ? time * 1000 : time;
  if (!Number.isFinite(milliseconds) || !Number.isFinite(new Date(milliseconds).getTime())) {
    throw new Error("Invalid candle timestamp");
  }
  return milliseconds;
}

export function normalizeCandle(bar: any): Bar {
  if (!bar || typeof bar !== "object" || Array.isArray(bar) || "dataRef" in bar) {
    throw new Error("Expected an OHLCV candle");
  }
  const result: Bar = {
    time: candleTimestamp(bar.time ?? bar.timestamp ?? bar.t ?? bar.date ?? bar.datetime),
    open: finiteNumber(bar.open ?? bar.o, "open"),
    high: finiteNumber(bar.high ?? bar.h, "high"),
    low: finiteNumber(bar.low ?? bar.l, "low"),
    close: finiteNumber(bar.close ?? bar.c, "close"),
    volume: finiteNumber(bar.volume ?? bar.v ?? bar.vol, "volume"),
  };
  if (result.high < Math.max(result.open, result.close, result.low) ||
      result.low > Math.min(result.open, result.close) || result.volume < 0) {
    throw new Error("Invalid candle OHLC range or volume");
  }
  const end = bar.closeTime ?? bar.endTimestamp;
  if (end != null) {
    result.closeTime = candleTimestamp(end);
    if (result.closeTime < result.time) throw new Error('Candle end precedes its start');
  }
  for (const field of ["trades", "vwap", "quoteVolume", "takerBuyBaseVolume", "takerBuyQuoteVolume"] as const) {
    if (bar[field] != null) result[field] = finiteNumber(bar[field], field);
  }
  return result;
}

/** Normalize once at the historical boundary; never mutate a broker/cached array. */
export function normalizeCandles(bars: any[]): Bar[] {
  const symbols = new Set(bars.map(bar => bar?.symbol).filter(Boolean));
  if (symbols.size > 1) throw new Error('Mixed-symbol candles require an explicit series selection');
  return bars.map(normalizeCandle).sort((a, b) => a.time - b.time);
}

export function extractHistoricalCandles(
  output: any,
  requested: { symbol?: string; timeframe?: string } = {},
): { bars: any[]; symbol?: string; timeframe?: string } {
  const select = (series: any[]) => {
    if (series.length === 0) return { bars: [], ...requested };
    const candidates = series.filter(item =>
      (!requested.symbol || String(item.symbol).toUpperCase() === String(requested.symbol).toUpperCase()) &&
      (!requested.timeframe || !item.interval || String(item.interval) === String(requested.timeframe)),
    );
    if (candidates.length !== 1) throw new Error("Historical candles require one matching symbol/timeframe");
    const item = candidates[0];
    if (!Array.isArray(item.bars)) throw new Error("Malformed historical bars");
    return { bars: item.bars, symbol: item.symbol, timeframe: item.interval };
  };
  if (Array.isArray(output)) return { bars: output, ...requested };
  if (!output || typeof output !== "object") throw new Error("Missing historical candles");
  if (requested.symbol && output.symbol && String(output.symbol).toUpperCase() !== String(requested.symbol).toUpperCase()) {
    throw new Error('Historical candle symbol does not match the request');
  }
  if (Array.isArray(output.BarSeries)) return select(output.BarSeries);
  for (const field of ["bars", "candles", "ohlcv", "prices", "data"]) {
    const value = output[field];
    if (Array.isArray(value)) return { bars: value, symbol: output.symbol, timeframe: output.interval ?? output.timeframe };
    if (value && typeof value === "object") {
      if (field === "bars") return select(Object.entries(value).map(([symbol, bars]) => ({ symbol, bars })));
      return extractHistoricalCandles(value, requested);
    }
  }
  throw new Error("Unsupported historical candle payload");
}
