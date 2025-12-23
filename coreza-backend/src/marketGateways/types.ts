import type { MarketEvent } from '../types/marketEvent';

export interface GatewayConfig<TSource extends string = string> {
  id: TSource;
  wsUrl: string | ((creds: any) => string);

  // Authentication
  makeAuthMessage?: (creds: any) => any;
  makeAuthHeaders?: (creds: any) => Record<string, string>;

  // Subscription management
  makeSubscribeMessage: (symbols: string[], types?: string[]) => any;
  makeUnsubscribeMessage: (symbols: string[], types?: string[]) => any;

  // Message processing
  parseMessage: (buffer: Buffer) => any[];
  identifyMessageType: (msg: any) => string;
  shouldPublish: (msg: any) => boolean;

  // CRITICAL: Normalizer to MarketEvent
  normalize: (msg: any) => MarketEvent | null;

  // Connection settings
  reconnectDelay?: number;
  maxReconnectAttempts?: number;

  // Protocol flags
  isBinary?: boolean; // Uses binary WebSocket protocol (Dhan)
  requiresPreConnect?: boolean; // Needs setup before connect (Schwab OAuth)
  preConnect?: (creds: any) => Promise<any>; // Pre-connection setup hook
}
