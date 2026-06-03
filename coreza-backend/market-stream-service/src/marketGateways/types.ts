import type { CorezaMarketEvent, MarketSource } from '../types/marketEvent';
import type WebSocket from "ws";

export interface GatewayPreConnectContext {
  userId: string;
  credentialId: string;
  source: string;
}

export interface SubscribeOptions {
  klineInterval?: string;
  depthLevels?: string;
}

export interface GatewayConfig {
  id: MarketSource;
  wsUrl: string | ((creds: any, source?: string) => string);

  // Authentication
  makeAuthMessage?: (creds: any, source?: string) => any;
  makeAuthHeaders?: (creds: any) => Record<string, string>;
  isAuthSuccess?: (msg: any, source?: string) => boolean;
  isAuthError?: (msg: any, source?: string) => boolean;
  postAuthHook?: (
    ws: WebSocket,
    creds: any,
    source: string,
    logger: any,
  ) => boolean;
  isPostAuthSuccess?: (msg: any, source?: string) => boolean;
  makeTradingKeepaliveMessage?: (creds: any, source?: string) => any;

  // Subscription management - streamNames are native broker format (btcusdt@kline_1m, bars.AAPL)
  makeSubscribeMessage: (streamNames: string[], source?: string) => any;
  makeUnsubscribeMessage: (streamNames: string[], source?: string) => any;

  // Message processing - source param for routing behavior
  parseMessage: (buffer: Buffer, source?: string) => unknown[];
  identifyMessageType: (msg: any) => string;
  shouldPublish: (msg: any, source?: string) => boolean;
  handleControlMessage?: (msg: any, logger: any, source?: string) => void;

  // CRITICAL: Normalizer to CorezaMarketEvent - source param for routing behavior
  normalize: (msg: any, source?: string) => CorezaMarketEvent | null;

  // Connection settings
  reconnectDelay?: number;
  maxReconnectAttempts?: number;

  // Protocol flags
  isBinary?: boolean | ((source?: string) => boolean);
  authCompletesOnSend?: boolean | ((source?: string) => boolean);
  requiresPreConnect?: boolean | ((source?: string, creds?: any) => boolean);
  preConnect?: (creds: any, context: GatewayPreConnectContext) => Promise<any>;
  validateOutbound?: (msg: any, source?: string) => boolean;
  encodeOutboundBinary?: (msg: any) => Buffer | string;
  onServiceStart?: () => Promise<void>;

}
