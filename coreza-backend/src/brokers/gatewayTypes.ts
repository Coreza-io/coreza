import type { MarketEvent } from '../types/marketEvent';

export interface GatewayPreConnectContext {
  userId: string;
  credentialId: string;
  source: string;
}

export interface GatewayConfig<TSource extends string = string> {
  id: TSource;
  wsUrl: string | ((creds: any, source?: string) => string);

  // Authentication
  makeAuthMessage?: (creds: any, source?: string) => any;
  makeAuthHeaders?: (creds: any) => Record<string, string>;

  // Subscription management
  makeSubscribeMessage: (symbols: string[], types?: string[], source?: string) => any;
  makeUnsubscribeMessage: (symbols: string[], types?: string[], source?: string) => any;

  // Message processing
  parseMessage: (buffer: Buffer, source?: string) => unknown[];
  identifyMessageType: (msg: any) => string;
  shouldPublish: (msg: any, source?: string) => boolean;

  // CRITICAL: Normalizer to MarketEvent
  normalize: (msg: any, source?: string) => MarketEvent | null;

  // Connection settings
  reconnectDelay?: number;
  maxReconnectAttempts?: number;

  // Protocol flags
  isBinary?: boolean | ((source?: string) => boolean); // Uses binary WebSocket protocol (Dhan market)
  requiresPreConnect?: boolean; // Needs setup before connect (Schwab OAuth)
  preConnect?: (creds: any, context?: GatewayPreConnectContext) => Promise<any>; // Pre-connection setup hook
}
