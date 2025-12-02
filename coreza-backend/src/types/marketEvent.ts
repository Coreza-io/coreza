// Unified market event format - all sources normalize to this
export type MarketEventType = 'trade' | 'quote' | 'bar' | 'daily_bar' | 'news';
export type MarketSource = 'alpaca' | 'alpaca_news' | 'binance' | 'dhan' | 'schwab';
export type Timeframe = 'tick' | '1m' | '5m' | '15m' | '1h' | '1d';

export interface CorezaMarketEvent {
  // Identification
  source: MarketSource;
  symbol: string;           // Normalized: "AAPL", "BTCUSD", "RELIANCE"
  type: MarketEventType;
  
  // Timing (always UTC ISO)
  date: string;             // ISO 8601 timestamp
  
  // Trade data
  price?: number;
  quantity?: number;
  exchange?: string;
  
  // Quote data
  bidPrice?: number;
  bidQuantity?: number;
  askPrice?: number;
  askQuantity?: number;
  
  // Bar/OHLCV data
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  vwap?: number;
  
  // Ticker data
  priceChange?: number;
  priceChangePercent?: number;
  
  // Metadata
  timeframe?: string;
  isClosed?: boolean;
}

export interface ControlMessage {
  action: 'subscribe' | 'unsubscribe';
  userId: string;
  sessionId?: string;
  symbols: string[];
  source?: MarketSource;
  timeframe?: Timeframe;
}
