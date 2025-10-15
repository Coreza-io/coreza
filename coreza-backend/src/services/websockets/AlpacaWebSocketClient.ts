import { BaseWebSocketClient, WebSocketClientConfig } from "./BaseWebSocketClient";

/**
 * Alpaca-specific stream message types
 */
interface AlpacaStreamMessage {
  T: string; // Message type
  S?: string; // Symbol
  [key: string]: any;
}

/**
 * Alpaca subscription message format
 */
interface AlpacaSubscription {
  action: "subscribe" | "unsubscribe";
  trades?: string[];
  quotes?: string[];
  bars?: string[];
  news?: string[];
}

/**
 * Alpaca WebSocket client for market data streaming
 * 
 * Connects to Alpaca's market data WebSocket API and provides real-time:
 * - Trades
 * - Quotes
 * - Bars (OHLCV data)
 * - News
 * 
 * @example
 * ```typescript
 * const client = AlpacaWebSocketClient.getInstance();
 * await client.connect({ api_key: 'xxx', secret_key: 'yyy' });
 * await client.subscribe('user123', ['AAPL', 'MSFT']);
 * ```
 */
export class AlpacaWebSocketClient extends BaseWebSocketClient<string> {
  private static instance: AlpacaWebSocketClient;

  private constructor() {
    super({
      url: "wss://stream.data.alpaca.markets/v2/iex",
      maxReconnectAttempts: 5,
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 15000,
      debug: true,
    });
  }

  /**
   * Get singleton instance of AlpacaWebSocketClient
   */
  static getInstance(): AlpacaWebSocketClient {
    if (!AlpacaWebSocketClient.instance) {
      AlpacaWebSocketClient.instance = new AlpacaWebSocketClient();
    }
    return AlpacaWebSocketClient.instance;
  }

  protected getServiceName(): string {
    return "Alpaca";
  }

  /**
   * Authenticate with Alpaca using API key and secret
   */
  protected authenticate(): void {
    const authMessage = {
      action: "auth",
      key: this.credentials.api_key,
      secret: this.credentials.secret_key,
    };
    this.send(authMessage);
    this.log("🔐 Sent authentication message");
  }

  /**
   * Handle successful authentication
   */
  protected handleAuthSuccess(): void {
    this.log("🟢 Alpaca authentication successful");
  }

  /**
   * Parse incoming messages from Alpaca
   */
  protected parseMessage(message: any): void {
    // Alpaca sends arrays of messages or single messages
    const messages = Array.isArray(message) ? message : [message];

    for (const msg of messages) {
      this.processAlpacaMessage(msg);
    }
  }

  /**
   * Process individual Alpaca message
   */
  private processAlpacaMessage(message: AlpacaStreamMessage): void {
    switch (message.T) {
      case "success":
        this.handleSuccessMessage(message);
        break;

      case "subscription":
        this.log("📡 Subscription confirmed:", message);
        break;

      case "t": // Trade
        this.broadcastToSubscribers(
          "alpaca_trade",
          {
            symbol: message.S,
            price: message.p,
            size: message.s,
            timestamp: message.t,
            conditions: message.c,
            exchange: message.x,
          },
          "symbol"
        );
        break;

      case "q": // Quote
        this.broadcastToSubscribers(
          "alpaca_quote",
          {
            symbol: message.S,
            bid_price: message.bp,
            bid_size: message.bs,
            bid_exchange: message.bx,
            ask_price: message.ap,
            ask_size: message.as,
            ask_exchange: message.ax,
            timestamp: message.t,
            conditions: message.c,
          },
          "symbol"
        );
        break;

      case "b": // Bar (OHLCV)
        this.broadcastToSubscribers(
          "alpaca_bar",
          {
            symbol: message.S,
            open: message.o,
            high: message.h,
            low: message.l,
            close: message.c,
            volume: message.v,
            timestamp: message.t,
            trade_count: message.n,
            vwap: message.vw,
          },
          "symbol"
        );
        break;

      case "n": // News
        this.broadcastToSubscribers(
          "alpaca_news",
          {
            id: message.id,
            headline: message.headline,
            summary: message.summary,
            author: message.author,
            created_at: message.created_at,
            updated_at: message.updated_at,
            url: message.url,
            symbols: message.symbols,
            source: message.source,
          },
          "symbols"
        );
        break;

      case "error":
        console.error("❌ Alpaca error:", message);
        this.broadcastToSubscribers(
          "alpaca_error",
          {
            code: message.code,
            message: message.msg,
          },
          "symbol"
        );
        break;

      default:
        // Ignore other message types (updatedBars, dailyBars, statuses, etc.)
        break;
    }
  }

  /**
   * Handle success messages from Alpaca
   */
  private handleSuccessMessage(message: any): void {
    if (message.msg === "connected") {
      this.log("🟢 Server connected");
    } else if (message.msg === "authenticated") {
      this.markAuthenticated();
    }
  }

  /**
   * Build subscription message for Alpaca
   */
  protected buildSubscribeMessage(symbols: string[]): AlpacaSubscription {
    return {
      action: "subscribe",
      trades: symbols,
      quotes: symbols,
      bars: symbols,
      news: symbols,
    };
  }

  /**
   * Build unsubscription message for Alpaca
   */
  protected buildUnsubscribeMessage(symbols: string[]): AlpacaSubscription {
    return {
      action: "unsubscribe",
      trades: symbols,
      quotes: symbols,
      bars: symbols,
      news: symbols,
    };
  }

  /**
   * Normalize symbols to uppercase
   */
  protected normalizeItems(symbols: string[]): string[] {
    return symbols.map((s) => s.toUpperCase()).filter(Boolean);
  }
}

// Export singleton instance for backward compatibility
export default AlpacaWebSocketClient.getInstance();
