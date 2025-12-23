import type { CorezaMarketEvent, MarketSource } from '../types/marketEvent';

export interface GatewayConfig {
  id: MarketSource;
  wsUrl: string | ((creds: any) => string);

  // Authentication
  makeAuthMessage?: (creds: any) => any;
  makeAuthHeaders?: (creds: any) => Record<string, string>;
  isAuthSuccess?: (msg: any) => boolean;
  isAuthError?: (msg: any) => boolean;

  // Subscription management
  makeSubscribeMessage: (symbols: string[], types?: string[]) => any;
  makeUnsubscribeMessage: (symbols: string[], types?: string[]) => any;

  // Message processing
  parseMessage: (buffer: Buffer) => any[];
  identifyMessageType: (msg: any) => string;
  shouldPublish: (msg: any) => boolean;
  handleControlMessage?: (msg: any, logger: any) => void;

  // CRITICAL: Normalizer to CorezaMarketEvent
  normalize: (msg: any) => CorezaMarketEvent | null;

  // Connection settings
  reconnectDelay?: number;
  maxReconnectAttempts?: number;

  // Protocol flags
  isBinary?: boolean;
  requiresPreConnect?: boolean;
  preConnect?: (creds: any) => Promise<any>;
}
