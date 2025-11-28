export interface WebSocketSourceConfig {
  id: string;
  credentialServiceType?: string; // Maps to user_credentials.service_type
  gatewaySource?: string; // Maps to GATEWAY_CONFIGS key (e.g., 'alpaca')
  url: string | ((creds: any) => string);
  makeAuthHeaders?: (creds: any) => Record<string, string>;
  makeAuthMessage?: (creds: any) => any;
  parseMessage?: (data: Buffer) => any[];
  identifyMessageType: (msg: any) => string;
  makeSubscribeMessage: (symbols: string[], streamTypes?: any) => any;
  makeUnsubscribeMessage: (symbols: string[], streamTypes?: any) => any;
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
    credentialServiceType: "alpaca",
    gatewaySource: "alpaca_news",
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
  alpaca_stream: {
    id: "alpaca_stream",
    credentialServiceType: "alpaca",
    gatewaySource: "alpaca",
    url: "wss://stream.data.alpaca.markets/v2/iex",
    makeAuthMessage: (creds) => ({
      action: "auth",
      key: creds.api_key,
      secret: creds.secret_key,
    }),
    parseMessage: defaultParser,
    identifyMessageType: (msg) => {
      if (msg.T === "success") return "authenticated";
      if (msg.T === "subscription") return "subscription";
      if (msg.T === "error") return "error";
      return msg.T;
    },
    makeSubscribeMessage: (symbols, streamTypes) => {
      const message: any = { action: "subscribe" };
      if (streamTypes && streamTypes.length > 0) {
        streamTypes.forEach((type: string) => {
          message[type] = symbols;
        });
      } else {
        message.trades = symbols;
      }
      return message;
    },
    makeUnsubscribeMessage: (symbols, streamTypes) => {
      const message: any = { action: "unsubscribe" };
      if (streamTypes && streamTypes.length > 0) {
        streamTypes.forEach((type: string) => {
          message[type] = symbols;
        });
      } else {
        message.trades = symbols;
      }
      return message;
    },
    extractData: (msg) => {
      switch (msg.T) {
        case "t":
          return {
            type: "trade",
            symbol: msg.S,
            id: msg.i,
            exchange: msg.x,
            price: msg.p,
            size: msg.s,
            conditions: msg.c,
            tape: msg.z,
            timestamp: msg.t,
          };
        case "q":
          return {
            type: "quote",
            symbol: msg.S,
            bid_exchange: msg.bx,
            bid_price: msg.bp,
            bid_size: msg.bs,
            ask_exchange: msg.ax,
            ask_price: msg.ap,
            ask_size: msg.as,
            conditions: msg.c,
            tape: msg.z,
            timestamp: msg.t,
          };
        case "b":
          return {
            type: "bar",
            symbol: msg.S,
            open: msg.o,
            high: msg.h,
            low: msg.l,
            close: msg.c,
            volume: msg.v,
            timestamp: msg.t,
            trade_count: msg.n,
            vwap: msg.vw,
          };
        case "d":
          return {
            type: "daily_bar",
            symbol: msg.S,
            open: msg.o,
            high: msg.h,
            low: msg.l,
            close: msg.c,
            volume: msg.v,
            timestamp: msg.t,
          };
        default:
          return msg;
      }
    },
    extractSymbols: (msg) => [msg.S],
    shouldTriggerWorkflow: (msg) => ["t", "q", "b", "d"].includes(msg.T),
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
