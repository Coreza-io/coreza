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

// Unified market event format - all sources normalize to this
// Uses short field names to match REST API format (t, o, h, l, c, v)
export type MarketEventType =
  | 'trade'
  | 'aggTrade'
  | 'quote'
  | 'bar'
  | 'daily_bar'
  | 'news'
  | 'ticker'
  | 'miniTicker'
  | 'depth'
  | 'order_update'
  | 'bookTicker'
  | '24hrTicker'
  | 'depthUpdate'
  | 'markPriceUpdate'
  | 'forceOrder'
  | 'continuousKline'
  | 'indexPriceUpdate'
  | 'compositeIndex'
  | 'account_update'
  | 'account_config_update'
  | 'margin_call'
  | 'algo_update'
  | 'listen_key_expired';

export type MarketSource =
  keyof typeof import('../brokers').GATEWAY_CONFIGS;
export type Timeframe = 'tick' | '1m' | '5m' | '15m' | '1h' | '1d';

export interface MarketEvent {
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
  orderEvent?: string;
  orderId?: string;
  clientOrderId?: string;
  brokerOrderId?: string;
  clientAlgoId?: string;
  algoId?: string;
  side?: string;
  filledQty?: number;
  filledAvgPrice?: number;
  orderStatus?: string;
  orderSymbol?: string;
  requestedQty?: number;
  positionQty?: number;
  executionId?: string;
  orderType?: string;
  assetClass?: string;
  rawOrderData?: Record<string, any>;

  // Metadata
  timeframe?: string;
  contractType?: string;
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
