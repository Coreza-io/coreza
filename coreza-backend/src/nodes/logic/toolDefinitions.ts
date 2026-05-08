import { ZodTypeAny } from "zod";
import { buildToolDefinitions } from "../../brokers/capabilities";

export interface ToolDefinition {
  description: string;
  category: string;
  schema?: ZodTypeAny;
}

// Non-broker tool definitions (static)
const STATIC_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // Market Data (non-broker sources)
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

  // Screeners (non-broker)
  YahooFinanceScreener: {
    description: "Use Yahoo Finance screener presets or custom filters to find tickers.",
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

// Merge static definitions with broker-generated ones (config-driven)
export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  ...STATIC_TOOL_DEFINITIONS,
  ...buildToolDefinitions(),
};
