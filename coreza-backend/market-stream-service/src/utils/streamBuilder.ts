import type { SubscribeOptions } from "../marketGateways/types";

/**
 * Build Binance stream names from symbols and types
 * Matches the format used by buildBinanceSubscribeMessage
 */
export function buildBinanceStreamNames(
  symbols: string[],
  types: string[],
  options?: SubscribeOptions,
): string[] {
  return symbols.flatMap((symbol) =>
    types.map((type) => {
      const sym = symbol.toLowerCase();
      const klineInterval = options?.klineInterval ?? options?.interval;
      if (type === "kline" && klineInterval) {
        return `${sym}@kline_${klineInterval}`;
      }
      if ((type === "depth" || type === "depth_levels") && options?.depthLevels) {
        return `${sym}@depth${options.depthLevels}`;
      }
      if (type === "ticker") {
        return `${sym}@ticker`;
      }
      return `${sym}@${type}`;
    }),
  );
}

/**
 * Build Alpaca stream names from symbols and types
 */
export function buildAlpacaStreamNames(
  symbols: string[],
  types: string[],
  source?: string,
): string[] {
  if (source === "alpaca_news") {
    return symbols.map((symbol) => `news.${symbol.toUpperCase()}`);
  }

  // Format: bars.AAPL, trades.AAPL
  return symbols.flatMap((symbol) =>
    types.map((type) => `${type}.${symbol.toUpperCase()}`),
  );
}

/**
 * Build stream names based on source
 */
export function buildStreamNames(
  source: string,
  symbols: string[],
  eventTypes: string[],
  options?: { interval?: string; depthLevels?: string },
): string[] {
  if (source.startsWith("binance")) {
    return buildBinanceStreamNames(symbols, eventTypes, {
      klineInterval: options?.interval,
      depthLevels: options?.depthLevels,
    });
  }

  if (source.startsWith("alpaca")) {
    return buildAlpacaStreamNames(symbols, eventTypes, source);
  }

  // Default fallback
  return symbols.flatMap((symbol) =>
    eventTypes.map((eventType) => `${symbol.toLowerCase()}@${eventType}`),
  );
}
