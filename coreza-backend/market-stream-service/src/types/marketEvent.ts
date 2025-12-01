// Unified market event format - all sources normalize to this
//
// "ticker" covers summary-style updates (e.g., Binance 24h ticker) that provide
// snapshot statistics instead of tick-level trades or quotes.
export type MarketEventType = 'trade' | 'quote' | 'bar' | 'daily_bar' | 'news' | 'ticker';
export type MarketSource = 'alpaca' | 'alpaca_news' | 'binance' | 'dhan' | 'schwab';
export type Timeframe = 'tick' | '1m' | '5m' | '15m' | '1h' | '1d';

export interface CorezaMarketEvent {
  // Identification
  source: MarketSource;
  symbol: string;           // Normalized: "AAPL", "BTCUSD", "RELIANCE"
  type: MarketEventType;
  
  // Timing (always UTC ISO)
  ts: string;               // ISO 8601 timestamp
  
  // Trade data
  lastPrice?: number;
  size?: number;
  exchange?: string;
  
  // Quote data
  bid?: number;
  bidSize?: number;
  ask?: number;
  askSize?: number;
  
  // Bar/OHLCV data
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
  vwap?: number;
  
  // Metadata
  timeframe?: Timeframe;
  raw?: any;                // Original message for debugging
}

export interface ControlMessage {
  action: 'subscribe' | 'unsubscribe';
  userId: string;
  sessionId?: string;
  symbols: string[];
  source?: MarketSource;
  timeframe?: Timeframe;
}
