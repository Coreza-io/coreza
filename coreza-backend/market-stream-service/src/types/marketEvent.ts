// Unified market event format - all sources normalize to this
// Uses short field names to match REST API format (t, o, h, l, c, v)
//
// "ticker" covers summary-style updates (e.g., Binance 24h ticker) that provide
// snapshot statistics instead of tick-level trades or quotes.
export type MarketEventType =
  | "trade"
  | "aggTrade"
  | "quote"
  | "bar"
  | "kline"
  | "daily_bar"
  | "updated_bar"
  | "news"
  | "ticker"
  | "miniTicker"
  | "depth"
  | "order_update";

export type MarketSource =
  keyof typeof import("../marketGateways").GATEWAY_CONFIGS;
export type Timeframe = "tick" | "1m" | "5m" | "15m" | "1h" | "1d";

export interface CorezaMarketEvent {
  // Identification
  source: MarketSource;
  symbol: string; // Normalized: "AAPL", "BTCUSD", "RELIANCE"
  type: MarketEventType;

  // Timing (Unix timestamp ms or ISO string)
  t?: number | string;

  // Trade data (short names)
  p?: number; // price
  q?: number; // quantity
  x?: string; // exchange

  // Quote data (short names)
  b?: number; // bid price
  B?: number; // bid quantity
  a?: number; // ask price
  A?: number; // ask quantity

  // Bar/OHLCV data (short names)
  o?: number; // open
  h?: number; // high
  l?: number; // low
  c?: number; // close
  v?: number; // volume
  vw?: number; // vwap

  // Ticker data
  pc?: number; // price change
  pcp?: number; // price change percent

  // Depth data (order book)
  bids?: Array<{ p: number; q: number }>;
  asks?: Array<{ p: number; q: number }>;

  // AggTrade specific
  aggregateTradeId?: number;
  firstTradeId?: number;
  lastTradeId?: number;
  isBuyerMaker?: boolean;

  // Order update data (from trading WebSocket)
  orderEvent?: string; // fill, partial_fill, canceled, rejected, etc.
  orderId?: string;
  side?: string; // buy, sell
  filledQty?: number;
  filledAvgPrice?: number;
  orderStatus?: string; // filled, partially_filled, canceled, etc.
  orderSymbol?: string; // Original symbol from order

  // News data
  headline?: string;
  summary?: string;
  author?: string;
  url?: string;
  symbols?: string[];
  newsSource?: string;

  // Metadata
  timeframe?: string;
  isClosed?: boolean;
}

export interface ControlMessage {
  action: "subscribe" | "unsubscribe";
  userId: string;
  sessionId?: string;
  stream: string[];
  source: MarketSource;
  timeframe?: Timeframe;
}
