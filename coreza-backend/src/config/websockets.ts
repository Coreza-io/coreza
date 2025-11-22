export interface WebSocketSourceConfig {
  id: string;
  url: string | ((creds: any) => string);
  makeAuthHeaders?: (creds: any) => Record<string, string>;
  makeAuthMessage?: (creds: any) => any;
  parseMessage?: (data: Buffer) => any[];
  identifyMessageType: (msg: any) => string;
  makeSubscribeMessage: (symbols: string[]) => any;
  makeUnsubscribeMessage: (symbols: string[]) => any;
  extractData: (msg: any) => any;
  extractSymbols?: (msg: any) => string[];
  shouldTriggerWorkflow?: (msg: any) => boolean;
  maxReconnectAttempts?: number;
  reconnectDelay?: number;
}

const defaultParser = (buffer: Buffer): any[] => {
  const parsed = JSON.parse(buffer.toString());
  return Array.isArray(parsed) ? parsed : [parsed];
};

const WEBSOCKET_SOURCES: Record<string, WebSocketSourceConfig> = {
  alpaca_news: {
    id: "alpaca_news",
    url: "wss://stream.data.alpaca.markets/v1beta1/news",
    makeAuthHeaders: (creds) => ({
      "APCA-API-KEY-ID": creds.api_key,
      "APCA-API-SECRET-KEY": creds.secret_key,
    }),
    parseMessage: defaultParser,
    identifyMessageType: (msg) => msg.T,
    makeSubscribeMessage: (symbols) => ({
      action: "subscribe",
      news: symbols,
    }),
    makeUnsubscribeMessage: (symbols) => ({
      action: "unsubscribe",
      news: symbols,
    }),
    extractData: (msg) => ({
      id: msg.id,
      headline: msg.headline,
      summary: msg.summary,
      author: msg.author,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
      url: msg.url,
      content: msg.content,
      symbols: msg.symbols,
      source: msg.source,
    }),
    extractSymbols: (msg) => msg.symbols || [],
    shouldTriggerWorkflow: (msg) => msg.T === "n",
    maxReconnectAttempts: 5,
    reconnectDelay: 1000,
  },
};

export function getWebSocketConfig(
  sourceId: string
): WebSocketSourceConfig | null {
  return WEBSOCKET_SOURCES[sourceId] || null;
}

export function getAllWebSocketSources(): string[] {
  return Object.keys(WEBSOCKET_SOURCES);
}
