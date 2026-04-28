/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

export interface ParsedStream {
  symbol: string;
  eventType: string;
  interval?: string;
}

/**
 * Parse native stream name to components
 * Binance: btcusdt@kline_1m -> { symbol: "BTCUSDT", eventType: "kline", interval: "1m" }
 * Alpaca: bars.AAPL -> { symbol: "AAPL", eventType: "bars" }
 */
export const KNOWN_TRADING_STREAMS = new Set([
  "trade_updates",
  "order_update",
  "ORDER_TRADE_UPDATE".toLowerCase(),
  "ALGO_UPDATE".toLowerCase(),
  "ACCOUNT_UPDATE".toLowerCase(),
  "ACCOUNT_CONFIG_UPDATE".toLowerCase(),
  "MARGIN_CALL".toLowerCase(),
  "listenKeyExpired".toLowerCase(),
  "executionReport".toLowerCase(),
  "outboundAccountPosition".toLowerCase(),
  "balanceUpdate".toLowerCase(),
]);

export function parseStreamName(
  source: string,
  streamName: string,
): ParsedStream {
  // Account-wide trading streams (no symbol)
  if (KNOWN_TRADING_STREAMS.has(streamName.toLowerCase())) {
    return { symbol: "", eventType: "order_update" };
  }

  if (source.startsWith("binance")) {
    const atIndex = streamName.indexOf("@");
    if (atIndex === -1) {
      return { symbol: streamName.toUpperCase(), eventType: "unknown" };
    }
    const sym = streamName.slice(0, atIndex).toUpperCase();
    const typeWithInterval = streamName.slice(atIndex + 1);

    if (typeWithInterval.startsWith("depth")) {
      return {
        symbol: sym,
        eventType: "depth",
        interval: typeWithInterval.slice(5) || "20",
      };
    }

    const underscoreIndex = typeWithInterval.indexOf("_");
    if (underscoreIndex !== -1) {
      return {
        symbol: sym,
        eventType: typeWithInterval.slice(0, underscoreIndex),
        interval: typeWithInterval.slice(underscoreIndex + 1),
      };
    }
    return { symbol: sym, eventType: typeWithInterval };
  }

  if (source === "alpaca" || source === "alpaca_market") {
    const dotIndex = streamName.indexOf(".");
    if (dotIndex === -1) {
      return { symbol: streamName.toUpperCase(), eventType: "unknown" };
    }
    return {
      symbol: streamName.slice(dotIndex + 1).toUpperCase(),
      eventType: streamName.slice(0, dotIndex),
    };
  }

  return { symbol: streamName.toUpperCase(), eventType: "unknown" };
}

/**
 * Get human-readable event type label
 */
export function getEventTypeLabel(eventType: string): string {
  const labels: Record<string, string> = {
    kline: "Candlestick (Kline)",
    trade: "Trade",
    aggTrade: "Aggregated Trade",
    depth: "Order Book Depth",
    ticker: "24h Ticker",
    bookTicker: "Best Bid/Ask",
    bars: "Bars (OHLCV)",
    trades: "Trades",
    quotes: "Quotes",
    order_update: "Order Updates (Fills)",
  };
  return labels[eventType] || eventType;
}

/**
 * Extract environment from source
 */
export function getEnvironment(source: string, override?: string): string {
  if (override) return override;
  if (source.includes("testnet")) return "Testnet";
  if (source.includes("paper")) return "Paper Trading";
  return "Live";
}
