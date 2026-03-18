import { ZodTypeAny } from "zod";

export interface ToolDefinition {
  description: string;
  category: string;
  schema?: ZodTypeAny;
}

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // Market Data
  YahooFinance: {
    description:
      "Get historical OHLCV market data from Yahoo Finance for analysis and backtesting.",
    category: "DataSource",
  },
  Polygon: {
    description:
      "Fetch market data from Polygon.io including aggregates and historical bars.",
    category: "DataSource",
  },
  FinnHub: {
    description: "Retrieve quotes, news, and historical bars from Finnhub.",
    category: "DataSource",
  },
  Alpaca: {
    description: "Request historical or real-time market data from Alpaca.",
    category: "Market",
  },
  Binance: {
    description: "Get crypto market data from Binance including kline candles.",
    category: "Market",
  },
  Schwab: {
    description: "Access equity market data from Charles Schwab.",
    category: "Market",
  },
  Dhan: {
    description: "Fetch market data from Dhan for Indian markets.",
    category: "Market",
  },
  Market: {
    description: "Generic market data fetcher supporting broker data sources.",
    category: "Market",
  },

  // Indicators
  RSI: {
    description:
      "Calculate Relative Strength Index (RSI) to gauge overbought or oversold conditions.",
    category: "Indicators",
  },
  EMA: {
    description: "Compute Exponential Moving Average over a data series.",
    category: "Indicators",
  },
  SMA: {
    description: "Compute Simple Moving Average over a data series.",
    category: "Indicators",
  },
  MACD: {
    description: "Calculate MACD along with signal line and histogram.",
    category: "Indicators",
  },
  BB: {
    description: "Generate Bollinger Bands for volatility analysis.",
    category: "Indicators",
  },
  ADX: {
    description: "Calculate Average Directional Index (ADX) for trend strength.",
    category: "Indicators",
  },
  Stoch: {
    description: "Compute Stochastic Oscillator values (fast/slow %K and %D).",
    category: "Indicators",
  },
  Ichimoku: {
    description: "Calculate Ichimoku Cloud indicator components.",
    category: "Indicators",
  },
  OBV: {
    description: "Compute On-Balance Volume for volume momentum analysis.",
    category: "Indicators",
  },
  VWAP: {
    description: "Calculate Volume Weighted Average Price for intraday analysis.",
    category: "Indicators",
  },
  VolumeOscillator: {
    description: "Compute Volume Oscillator comparing fast and slow volume averages.",
    category: "Indicators",
  },
  SupportResistance: {
    description: "Identify support and resistance levels from price data.",
    category: "Indicators",
  },

  // Brokers (Trade)
  AlpacaTrade: {
    description:
      "Execute trades on Alpaca including market, limit, stop, and trailing stop orders.",
    category: "Broker",
  },
  BinanceTrade: {
    description: "Place or manage crypto orders on Binance.",
    category: "Broker",
  },
  DhanTrade: {
    description: "Execute equity trades on Dhan with basic order operations.",
    category: "Broker",
  },
  SchwabTrade: {
    description: "Place or manage trades via Charles Schwab APIs.",
    category: "Broker",
  },

  // Screeners
  AlpacaScreener: {
    description: "Screen stocks using Alpaca screener APIs (market cap, volume, sector).",
    category: "Screener",
  },
  BinanceScreener: {
    description: "Filter Binance instruments by volume, price change, and symbol patterns.",
    category: "Screener",
  },
  YahooFinanceScreener: {
    description: "Use Yahoo Finance screener presets or custom filters to find tickers.",
    category: "Screener",
  },
  SchwabScreener: {
    description: "Run Charles Schwab screeners to discover equities meeting criteria.",
    category: "Screener",
  },

  // Utilities
  Math: {
    description: "Perform math operations or comparisons on two operands.",
    category: "ControlFlow",
  },
  Transform: {
    description: "Transform or map data using common collection operations.",
    category: "ControlFlow",
  },
  Date: {
    description: "Work with dates: get current time, add/subtract durations, format values.",
    category: "ControlFlow",
  },
  Field: {
    description: "Edit, add, or remove fields within the payload.",
    category: "ControlFlow",
  },
  HttpRequest: {
    description: "Make HTTP requests to external APIs with optional authentication.",
    category: "Utility",
  },
  GoogleWebSearch: {
    description:
      "Search the web using Google Custom Search and return concise search results.",
    category: "Tool",
  },
};
