import type { CorezaMarketEvent, MarketSource } from '../types/marketEvent';

export interface SubscribeOptions {
  klineInterval?: string;
  depthLevels?: string;
}

export interface GatewayConfig {
  id: MarketSource;
  wsUrl: string | ((creds: any, source?: string) => string);

  // Authentication
  makeAuthMessage?: (creds: any) => any;
  makeAuthHeaders?: (creds: any) => Record<string, string>;
  isAuthSuccess?: (msg: any) => boolean;
  isAuthError?: (msg: any) => boolean;

  // Subscription management - streamNames are native broker format (btcusdt@kline_1m, bars.AAPL)
  makeSubscribeMessage: (streamNames: string[], source?: string) => any;
  makeUnsubscribeMessage: (streamNames: string[], source?: string) => any;

  // Message processing - source param for routing behavior
  parseMessage: (buffer: Buffer) => any[];
  identifyMessageType: (msg: any) => string;
  shouldPublish: (msg: any, source?: string) => boolean;
  handleControlMessage?: (msg: any, logger: any, source?: string) => void;

  // CRITICAL: Normalizer to CorezaMarketEvent - source param for routing behavior
  normalize: (msg: any, source?: string) => CorezaMarketEvent | null;

  // Connection settings
  reconnectDelay?: number;
  maxReconnectAttempts?: number;

  // Protocol flags
  isBinary?: boolean;
  requiresPreConnect?: boolean;
  preConnect?: (creds: any) => Promise<any>;
}
