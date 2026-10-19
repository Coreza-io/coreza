import type { Bar } from "../brokers/types";
import { parseTimeframe } from "../utils/timeframe";

export function sameMarketSymbol(left: unknown, right: unknown, assetType?: string): boolean {
  const a = String(left).trim().toUpperCase();
  const b = String(right).trim().toUpperCase();
  return a === b || (assetType === 'crypto' && a.replace('/', '') === b.replace('/', ''));
}

export function sameMarketTimeframe(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => {
    const raw = String(value).trim();
    const text = raw.toLowerCase().replace(/minutes?$/, 'm').replace(/hours?$/, 'h');
    // Uppercase M denotes months on some feeds; it must never alias minute bars.
    const month = /^(\d+)M$/.exec(raw) ?? /^(\d+)\s*months?$/.exec(text);
    if (month) return `month:${Number(month[1])}`;
    try { return parseTimeframe(text).milliseconds; } catch { return text; }
  };
  return normalize(left) === normalize(right);
}

function finiteNumber(value: unknown, field: string): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) {
    throw new Error(`Candle ${field} is required`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid candle ${field}`);
  return number;
}

/** Broker Bar timestamps are Unix milliseconds; raw feeds may use Unix seconds. */
export function candleTimestamp(value: unknown, unit: 'milliseconds' | 'auto' = 'auto'): number {
  const numeric = typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value));
  const time = numeric ? Number(value) : typeof value === "string" ? Date.parse(value) : NaN;
  const milliseconds = unit === 'auto' && numeric && Math.abs(time) < 100_000_000_000 ? time * 1000 : time;
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
    time: candleTimestamp(bar.time ?? bar.timestamp ?? bar.t ?? bar.date ?? bar.datetime,
      bar.time != null ? 'milliseconds' : 'auto'),
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
    result.closeTime = candleTimestamp(end, bar.closeTime != null ? 'milliseconds' : 'auto');
    if (result.closeTime < result.time) throw new Error('Candle end precedes its start');
  }
  for (const field of ["trades", "vwap", "quoteVolume", "takerBuyBaseVolume", "takerBuyQuoteVolume"] as const) {
    if (bar[field] != null) result[field] = finiteNumber(bar[field], field);
  }
  return result;
}

/** Normalize once at the historical boundary; never mutate a broker/cached array. */
export function normalizeCandles(bars: any[]): Bar[] {
  const symbols = new Set(bars.map(bar => bar?.symbol && String(bar.symbol).trim().toUpperCase()).filter(Boolean));
  if (symbols.size > 1) throw new Error('Mixed-symbol candles require an explicit series selection');
  return bars.map(normalizeCandle).sort((a, b) => a.time - b.time);
}

export function extractHistoricalCandles(
  output: any,
  requested: { symbol?: string; timeframe?: string; assetType?: string } = {},
  depth = 0,
): { bars: any[]; symbol?: string; timeframe?: string } {
  if (depth > 16) throw new Error('Historical candle payload nesting is too deep');
  const validateMetadata = (item: any, expected = requested) => {
    if (expected.symbol && item?.symbol && !sameMarketSymbol(item.symbol, expected.symbol, expected.assetType)) {
      throw new Error('Historical candle symbol does not match the request');
    }
    const timeframe = item?.interval ?? item?.timeframe;
    if (expected.timeframe && timeframe && !sameMarketTimeframe(timeframe, expected.timeframe)) {
      throw new Error('Historical candle timeframe does not match the request');
    }
  };
  const result = (bars: any[], metadata: any = {}) => {
    const symbol = metadata.symbol ?? requested.symbol ?? bars.find(bar => bar?.symbol)?.symbol;
    const labeledTimeframe = bars.find(bar => bar?.interval ?? bar?.timeframe);
    const timeframe = metadata.interval ?? metadata.timeframe ?? requested.timeframe ?? labeledTimeframe?.interval ?? labeledTimeframe?.timeframe;
    for (const bar of bars) validateMetadata(bar, { ...requested, symbol, timeframe });
    return { bars, symbol, timeframe };
  };
  const select = (series: any[]) => {
    if (series.length === 0) return result([]);
    const candidates = series.filter(item =>
      item && (!requested.symbol || sameMarketSymbol(item.symbol, requested.symbol, requested.assetType)) &&
      (!requested.timeframe || !(item.interval ?? item.timeframe) || sameMarketTimeframe(item.interval ?? item.timeframe, requested.timeframe)),
    );
    if (candidates.length !== 1) throw new Error("Historical candles require one matching symbol/timeframe");
    const item = candidates[0];
    if (!Array.isArray(item.bars)) throw new Error("Malformed historical bars");
    validateMetadata(item);
    return result(item.bars, item);
  };
  if (Array.isArray(output)) return result(output);
  if (!output || typeof output !== "object") throw new Error("Missing historical candles");
  validateMetadata(output);
  if (Array.isArray(output.BarSeries)) return select(output.BarSeries);
  for (const field of ["bars", "candles", "ohlcv", "prices", "data"]) {
    const value = output[field];
    if (Array.isArray(value)) return result(value, output);
    if (value && typeof value === "object") {
      if (field === "bars") return select(Object.entries(value).map(([symbol, bars]) => ({ symbol, bars })));
      return extractHistoricalCandles(value, {
        ...requested, symbol: output.symbol ?? requested.symbol,
        timeframe: output.interval ?? output.timeframe ?? requested.timeframe,
      }, depth + 1);
    }
  }
  throw new Error("Unsupported historical candle payload");
}
