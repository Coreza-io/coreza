import { z, ZodTypeAny } from "zod";

export interface ToolDefinition {
  description: string;
  schema: ZodTypeAny;
  category: string;
}

const marketDataSchema = z.object({
  symbol: z.string().describe("Ticker or instrument symbol (e.g., AAPL, BTCUSD)"),
  timeframe: z
    .string()
    .optional()
    .describe("Bar interval such as 1m, 5m, 1h, 1d, 1wk, 1mo"),
  start_date: z
    .string()
    .optional()
    .describe("Start date (YYYY-MM-DD) for historical data"),
  end_date: z
    .string()
    .optional()
    .describe("End date (YYYY-MM-DD) for historical data"),
  limit: z.number().optional().describe("Maximum number of bars to return"),
  operation: z
    .string()
    .optional()
    .describe("Optional provider-specific operation (e.g., get_history, get_quote)"),
});

const indicatorBaseSchema = z.object({
  dataRef: z
    .string()
    .optional()
    .describe("Reference to market data from a previous fetch"),
  series: z
    .array(z.number())
    .optional()
    .describe("Price series to run the indicator on if no dataRef is provided"),
});

const tradeBaseSchema = z.object({
  operation: z
    .string()
    .describe("Trade operation such as place_order, get_orders, cancel_order"),
  symbol: z.string().optional().describe("Symbol or trading pair for the order"),
  side: z.enum(["buy", "sell"]).optional().describe("Order side"),
  qty: z.number().optional().describe("Order quantity or size"),
  type: z
    .enum(["market", "limit", "stop", "stop_limit", "trailing_stop"])
    .optional()
    .describe("Order type"),
  limit_price: z.number().optional().describe("Limit price when applicable"),
  stop_price: z.number().optional().describe("Stop price when applicable"),
  trail_price: z.number().optional().describe("Trailing stop dollar amount"),
  trail_percent: z.number().optional().describe("Trailing stop percent"),
  credential_id: z
    .string()
    .optional()
    .describe("Credential identifier for the broker connection"),
});

const screenerSchema = z.object({
  filters: z.any().optional().describe("Screening filters or query payload"),
  limit: z.number().optional().describe("Maximum number of results"),
  sort: z.string().optional().describe("Sort expression for screener results"),
});

const mathSchema = z.object({
  left: z.any().optional().describe("Left operand value"),
  right: z.any().optional().describe("Right operand value"),
  operator: z
    .string()
    .optional()
    .describe("Math operator such as +, -, *, /, ^, %, ==, >, <")
    .default("+"),
});

const transformSchema = z.object({
  value: z.any().optional().describe("Value to transform"),
  operator: z
    .string()
    .optional()
    .describe("Transform operation such as map, filter, reduce, concat"),
  arg1: z.any().optional().describe("First argument for the transform operation"),
  arg2: z.any().optional().describe("Second argument for the transform operation"),
});

const dateSchema = z.object({
  operation: z
    .string()
    .describe("Date operation such as now, add, subtract, format, parse"),
  amount: z.number().optional().describe("Amount of time units to add/subtract"),
  unit: z
    .string()
    .optional()
    .describe("Time unit for date math (seconds, minutes, hours, days, weeks)").default("days"),
  format: z
    .string()
    .optional()
    .describe("Date format string for formatting/parsing"),
  value: z
    .string()
    .optional()
    .describe("Input date value when parsing or offsetting"),
});

const fieldSchema = z.object({
  operation: z
    .string()
    .optional()
    .describe("Field operation such as add, remove, rename, set"),
  field: z.string().optional().describe("Field name to target"),
  value: z.any().optional().describe("Value to set for the field"),
  fields: z
    .record(z.any())
    .optional()
    .describe("Bulk field payload for add/set operations"),
});

const httpRequestSchema = z.object({
  method: z
    .string()
    .optional()
    .describe("HTTP method to use (GET, POST, PUT, DELETE, etc.)"),
  url: z.string().describe("Target URL for the HTTP request"),
  headers: z
    .record(z.any())
    .optional()
    .describe("Custom headers to include"),
  params: z
    .record(z.any())
    .optional()
    .describe("Query string parameters"),
  body: z.any().optional().describe("Request body payload"),
  auth_type: z
    .string()
    .optional()
    .describe("Authentication type: none, bearer, basic, api_key"),
  bearer_token: z.string().optional().describe("Bearer token for auth"),
  basic_username: z.string().optional().describe("Username for basic auth"),
  basic_password: z.string().optional().describe("Password for basic auth"),
  api_key_location: z
    .string()
    .optional()
    .describe("Where to place the API key: header or query"),
  api_key_value: z.string().optional().describe("API key value if used"),
  timeout: z
    .number()
    .optional()
    .describe("Request timeout in seconds"),
});

const webSearchSchema = z.object({
  query: z.string().describe("Search query to execute"),
  numResults: z
    .number()
    .optional()
    .describe("Number of search results to return (default 10)"),
});

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // Market Data
  YahooFinance: {
    description:
      "Get historical OHLCV market data from Yahoo Finance for analysis and backtesting.",
    schema: marketDataSchema,
    category: "DataSource",
  },
  Polygon: {
    description:
      "Fetch market data from Polygon.io including aggregates and historical bars.",
    schema: marketDataSchema,
    category: "DataSource",
  },
  FinnHub: {
    description: "Retrieve quotes, news, and historical bars from Finnhub.",
    schema: marketDataSchema,
    category: "DataSource",
  },
  Alpaca: {
    description: "Request historical or real-time market data from Alpaca.",
    schema: marketDataSchema,
    category: "Market",
  },
  Binance: {
    description: "Get crypto market data from Binance including kline candles.",
    schema: marketDataSchema,
    category: "Market",
  },
  Schwab: {
    description: "Access equity market data from Charles Schwab.",
    schema: marketDataSchema,
    category: "Market",
  },
  Dhan: {
    description: "Fetch market data from Dhan for Indian markets.",
    schema: marketDataSchema,
    category: "Market",
  },
  Market: {
    description: "Generic market data fetcher supporting broker data sources.",
    schema: marketDataSchema,
    category: "Market",
  },

  // Indicators
  RSI: {
    description:
      "Calculate Relative Strength Index (RSI) to gauge overbought or oversold conditions.",
    schema: indicatorBaseSchema.extend({
      period: z.number().optional().describe("RSI lookback period (default 14)"),
    }),
    category: "Indicators",
  },
  EMA: {
    description: "Compute Exponential Moving Average over a data series.",
    schema: indicatorBaseSchema.extend({
      period: z.number().optional().describe("Lookback period for EMA"),
    }),
    category: "Indicators",
  },
  SMA: {
    description: "Compute Simple Moving Average over a data series.",
    schema: indicatorBaseSchema.extend({
      period: z.number().optional().describe("Lookback period for SMA"),
    }),
    category: "Indicators",
  },
  MACD: {
    description: "Calculate MACD along with signal line and histogram.",
    schema: indicatorBaseSchema.extend({
      fastPeriod: z.number().optional().describe("Fast EMA period"),
      slowPeriod: z.number().optional().describe("Slow EMA period"),
      signalPeriod: z.number().optional().describe("Signal line period"),
    }),
    category: "Indicators",
  },
  BB: {
    description: "Generate Bollinger Bands for volatility analysis.",
    schema: indicatorBaseSchema.extend({
      period: z.number().optional().describe("Moving average period"),
      stdDev: z
        .number()
        .optional()
        .describe("Standard deviation multiplier for bands"),
    }),
    category: "Indicators",
  },
  ADX: {
    description: "Calculate Average Directional Index (ADX) for trend strength.",
    schema: indicatorBaseSchema.extend({
      period: z.number().optional().describe("ADX lookback period"),
    }),
    category: "Indicators",
  },
  Stoch: {
    description: "Compute Stochastic Oscillator values (fast/slow %K and %D).",
    schema: indicatorBaseSchema.extend({
      kPeriod: z.number().optional().describe("%K period length"),
      dPeriod: z.number().optional().describe("%D period length"),
      smooth: z.number().optional().describe("Smoothing factor"),
    }),
    category: "Indicators",
  },
  Ichimoku: {
    description: "Calculate Ichimoku Cloud indicator components.",
    schema: indicatorBaseSchema.extend({
      conversionPeriod: z.number().optional().describe("Tenkan-sen period"),
      basePeriod: z.number().optional().describe("Kijun-sen period"),
      spanBPeriod: z.number().optional().describe("Senkou Span B period"),
      displacement: z.number().optional().describe("Displacement for spans"),
    }),
    category: "Indicators",
  },
  OBV: {
    description: "Compute On-Balance Volume for volume momentum analysis.",
    schema: indicatorBaseSchema,
    category: "Indicators",
  },
  VWAP: {
    description: "Calculate Volume Weighted Average Price for intraday analysis.",
    schema: indicatorBaseSchema,
    category: "Indicators",
  },
  VolumeOscillator: {
    description: "Compute Volume Oscillator comparing fast and slow volume averages.",
    schema: indicatorBaseSchema.extend({
      fastPeriod: z.number().optional().describe("Fast volume MA period"),
      slowPeriod: z.number().optional().describe("Slow volume MA period"),
    }),
    category: "Indicators",
  },
  SupportResistance: {
    description: "Identify support and resistance levels from price data.",
    schema: indicatorBaseSchema.extend({
      window: z.number().optional().describe("Window size for swing detection"),
      sensitivity: z
        .number()
        .optional()
        .describe("Sensitivity for defining levels"),
    }),
    category: "Indicators",
  },

  // Brokers (Trade)
  AlpacaTrade: {
    description:
      "Execute trades on Alpaca including market, limit, stop, and trailing stop orders.",
    schema: tradeBaseSchema,
    category: "Broker",
  },
  BinanceTrade: {
    description: "Place or manage crypto orders on Binance.",
    schema: tradeBaseSchema,
    category: "Broker",
  },
  DhanTrade: {
    description: "Execute equity trades on Dhan with basic order operations.",
    schema: tradeBaseSchema,
    category: "Broker",
  },
  SchwabTrade: {
    description: "Place or manage trades via Charles Schwab APIs.",
    schema: tradeBaseSchema,
    category: "Broker",
  },

  // Screeners
  AlpacaScreener: {
    description: "Screen stocks using Alpaca screener APIs (market cap, volume, sector).",
    schema: screenerSchema,
    category: "Screener",
  },
  BinanceScreener: {
    description: "Filter Binance instruments by volume, price change, and symbol patterns.",
    schema: screenerSchema,
    category: "Screener",
  },
  YahooFinanceScreener: {
    description: "Use Yahoo Finance screener presets or custom filters to find tickers.",
    schema: screenerSchema,
    category: "Screener",
  },
  SchwabScreener: {
    description: "Run Charles Schwab screeners to discover equities meeting criteria.",
    schema: screenerSchema,
    category: "Screener",
  },

  // Utilities
  Math: {
    description: "Perform math operations or comparisons on two operands.",
    schema: mathSchema,
    category: "ControlFlow",
  },
  Transform: {
    description: "Transform or map data using common collection operations.",
    schema: transformSchema,
    category: "ControlFlow",
  },
  Date: {
    description: "Work with dates: get current time, add/subtract durations, format values.",
    schema: dateSchema,
    category: "ControlFlow",
  },
  Field: {
    description: "Edit, add, or remove fields within the payload.",
    schema: fieldSchema,
    category: "ControlFlow",
  },
  HttpRequest: {
    description: "Make HTTP requests to external APIs with optional authentication.",
    schema: httpRequestSchema,
    category: "Utility",
  },
  GoogleWebSearch: {
    description:
      "Search the web using Google Custom Search and return concise search results.",
    schema: webSearchSchema,
    category: "Tool",
  },
};
