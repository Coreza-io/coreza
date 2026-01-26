import WebSocket from "ws";
import { getRedisQueue } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import {
  GatewayConfig,
  GATEWAY_CONFIGS,
  SubscribeOptions,
} from "../marketGateways";
import { CorezaMarketEvent, MarketSource } from "../types/marketEvent";
import { redisPublishBreaker } from "../utils/redisCircuitBreaker";
import { RedisBuffer } from "./RedisBuffer";
import { createLogger } from "../utils/logger";
import {
  marketMessagesCounter,
  marketMessageLatencyHistogram,
  activeGatewayConnectionsGauge,
} from "../utils/metrics";
import {
  alertGatewayDisconnected,
  alertMaxReconnectAttempts,
} from "../utils/alerting";

export class MarketDataGateway {
  // Key: full source_id (e.g., 'alpaca_news', 'alpaca_stream') for unique instances
  private static instances = new Map<string, MarketDataGateway>();

  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private source: string; // Full source_id for behavior routing (e.g., 'alpaca_news')
  private credentials: any = null;
  private subscribedSymbolTypes = new Map<string, Set<string>>(); // symbol → event types
  private isAuthenticated = false;
  private reconnectAttempts = 0;
  private redis = getRedisQueue();
  private logger = createLogger("MarketDataGateway");
  private keepaliveInterval: NodeJS.Timeout | null = null;

  private constructor(config: GatewayConfig, source: string) {
    this.config = config;
    this.source = source;
  }

  /**
   * Get or create a gateway instance.
   * @param gatewaySource - The gateway config key (e.g., 'alpaca')
   * @param sourceId - The full source_id for behavior routing (e.g., 'alpaca_news', 'alpaca_stream')
   * @param instanceKey - Optional unique key for instance isolation (e.g., user+source)
   */
  static getInstance(
    gatewaySource: MarketSource,
    sourceId?: string,
    instanceKey?: string,
  ): MarketDataGateway {
    const sourceKey = sourceId || gatewaySource;
    const key = instanceKey || sourceKey;

    if (!this.instances.has(key)) {
      const config = GATEWAY_CONFIGS[gatewaySource];
      if (!config) throw new Error(`Unknown market source: ${gatewaySource}`);
      this.instances.set(key, new MarketDataGateway(config, sourceKey));
    }
    return this.instances.get(key)!;
  }

  async connect(credentials: any): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.credentials = credentials;

    // Run pre-connect setup if required (e.g., Schwab OAuth streaming URL fetch)
    if (this.config.requiresPreConnect && this.config.preConnect) {
      this.logger.info({ source: this.source }, "Running pre-connect setup");
      this.credentials = await this.config.preConnect(credentials);
    }

    // Pass source to wsUrl function for behavior routing (e.g., alpaca_news uses different URL)
    const url =
      typeof this.config.wsUrl === "function"
        ? this.config.wsUrl(this.credentials, this.source)
        : this.config.wsUrl;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: this.config.makeAuthHeaders?.(credentials),
      });

      this.ws.on("open", () => {
        this.logger.info({ source: this.source }, "Gateway connected");
        activeGatewayConnectionsGauge.set({ source: this.source }, 1);
        this.startKeepalive();
        const authMsg = this.config.makeAuthMessage?.(this.credentials);
        if (authMsg) {
          const payload = this.config.isBinary
            ? this.encodeMessage(authMsg)
            : JSON.stringify(authMsg);
          this.ws!.send(payload);
        } else {
          this.isAuthenticated = true;
          this.resubscribeAll();
          resolve();
        }
      });

      this.ws.on("message", (data: Buffer) => {
        this.handleMessage(data, resolve);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        const reasonStr = reason.toString() || "No reason provided";
        this.logger.warn(
          { source: this.source, code, reason: reasonStr },
          "Gateway disconnected",
        );
        activeGatewayConnectionsGauge.set({ source: this.source }, 0);
        alertGatewayDisconnected(
          this.source,
          `Connection closed: ${code} - ${reasonStr}`,
        );
        this.isAuthenticated = false;
        this.stopKeepalive();
        this.handleReconnect();
      });

      this.ws.on("error", (err) => {
        this.logger.error({ source: this.source, error: err }, "Gateway error");
        reject(err);
      });
    });
  }

  private async handleMessage(
    buffer: Buffer,
    resolveConnect?: () => void,
  ): Promise<void> {
    try {
      const startTime = Date.now();
      const messages = this.config.parseMessage(buffer);

      // Debug log ALL incoming messages
      this.logger.debug(
        { source: this.source, rawMessages: messages },
        "Raw messages received",
      );

      for (const msg of messages) {
        const msgType = this.config.identifyMessageType(msg);

        // Check for auth success/error messages
        if (
          !this.isAuthenticated &&
          this.config.isAuthSuccess &&
          this.config.isAuthSuccess(msg)
        ) {
          this.logger.info(
            { source: this.source },
            "Authentication successful",
          );
          this.isAuthenticated = true;
          this.resubscribeAll();
          if (resolveConnect) resolveConnect();
          continue;
        }

        if (this.config.isAuthError && this.config.isAuthError(msg)) {
          this.logger.error(
            { source: this.source, msg },
            "Authentication failed",
          );
          this.ws?.close();
          continue;
        }

        // Handle control messages (subscription confirmations, etc.) - pass source
        if (this.config.handleControlMessage) {
          this.config.handleControlMessage(msg, this.logger, this.source);
        }

        // Only publish market data messages - pass source for filtering
        if (!this.config.shouldPublish(msg, this.source)) continue;

        // Normalize message - pass source for proper event formatting
        const event = this.config.normalize(msg, this.source);
        if (!event || !event.symbol) continue;

        // Publish to Redis symbol channel with circuit breaker
        const channel = REDIS_CHANNELS.marketData(event.symbol);
        await this.publishToRedis(channel, JSON.stringify(event));
        // ADD THIS AFTER LINE 135:
        console.log(`🔴 [DEBUG-1] PUBLISHED to Redis channel: ${channel}`);
        console.log(`🔴 [DEBUG-1] Event data:`, JSON.stringify(event));

        // Metrics
        marketMessagesCounter.inc({
          source: this.source,
          symbol: event.symbol,
          type: event.type,
        });
        const latency = (Date.now() - startTime) / 1000;
        marketMessageLatencyHistogram.observe({ source: this.source }, latency);

        this.logger.debug(
          {
            source: this.source,
            symbol: event.symbol,
            type: event.type,
            price: event.p || event.c,
          },
          "Market event published",
        );
      }
    } catch (error) {
      this.logger.error({ source: this.source, error }, "Message parse error");
    }
  }

  /**
   * Publish to Redis with circuit breaker and fallback buffering
   */
  private async publishToRedis(
    channel: string,
    message: string,
  ): Promise<void> {
    try {
      await redisPublishBreaker.fire(channel, message);
    } catch (error) {
      this.logger.warn(
        { source: this.source, channel },
        "Redis unavailable, buffering message",
      );
      RedisBuffer.getInstance().bufferMessage(channel, message);
    }
  }

  subscribeSymbols(
    symbols: string[],
    types?: string[],
    options?: SubscribeOptions,
  ): void {
    const requestedTypes = types || [];
    const subscriptionUpdates: string[] = [];

    for (const symbol of symbols) {
      const upperSymbol = symbol.toUpperCase();
      const existingTypes =
        this.subscribedSymbolTypes.get(upperSymbol) || new Set();

      // Check if any requested type is new for this symbol
      const hasNewTypes = requestedTypes.some((t) => !existingTypes.has(t));

      if (!this.subscribedSymbolTypes.has(upperSymbol) || hasNewTypes) {
        subscriptionUpdates.push(upperSymbol);
        // Add all requested types to tracking
        requestedTypes.forEach((t) => existingTypes.add(t));
        this.subscribedSymbolTypes.set(upperSymbol, existingTypes);
      }
    }

    if (subscriptionUpdates.length === 0) {
      this.logger.debug(
        { source: this.source },
        "All symbols already subscribed with requested types",
      );
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      // Pass source for behavior routing (e.g., alpaca_news subscribes differently)
      const msg = this.config.makeSubscribeMessage(
        subscriptionUpdates,
        requestedTypes,
        options,
        this.source,
      );
      const payload = this.encodeMessage(msg);
      this.ws.send(payload);
      this.logger.info(
        {
          source: this.source,
          symbols: subscriptionUpdates,
          types: requestedTypes,
        },
        "Subscribed to symbols",
      );
    }
  }

  unsubscribeSymbols(
    symbols: string[],
    types?: string[],
    options?: SubscribeOptions,
  ): void {
    const toRemove = symbols.filter((s) =>
      this.subscribedSymbolTypes.has(s.toUpperCase()),
    );
    if (toRemove.length === 0) return;

    toRemove.forEach((s) => this.subscribedSymbolTypes.delete(s.toUpperCase()));

    if (this.ws?.readyState === WebSocket.OPEN) {
      // Pass source for behavior routing
      const msg = this.config.makeUnsubscribeMessage(
        toRemove,
        types,
        options,
        this.source,
      );
      const payload = this.encodeMessage(msg);
      this.ws.send(payload);
      this.logger.info(
        { source: this.source, symbols: toRemove },
        "Unsubscribed from symbols",
      );
    }
  }

  private resubscribeAll(): void {
    if (this.subscribedSymbolTypes.size > 0) {
      // Group symbols by their types for efficient subscription
      const typeGroups = new Map<string, string[]>();

      for (const [symbol, types] of this.subscribedSymbolTypes) {
        const typeKey = Array.from(types).sort().join(",");
        if (!typeGroups.has(typeKey)) typeGroups.set(typeKey, []);
        typeGroups.get(typeKey)!.push(symbol);
      }

      // Send subscription for each type group - pass source for behavior routing
      for (const [typeKey, symbols] of typeGroups) {
        const types = typeKey.split(",");
        const msg = this.config.makeSubscribeMessage(
          symbols,
          types,
          undefined,
          this.source,
        );
        const payload = this.encodeMessage(msg);
        this.ws?.send(payload);
        this.logger.info(
          { source: this.source, symbols: symbols.length, types },
          "Resubscribed to symbols",
        );
      }
    }
  }

  private encodeMessage(msg: any): Buffer | string {
    // Binary protocol (Dhan)
    if (this.config.isBinary) {
      const {
        encodeDhanSubscribeMessage,
        encodeDhanUnsubscribeMessage,
      } = require("../utils/dhanBinaryParser");
      if (msg.RequestCode === 15) {
        return encodeDhanSubscribeMessage(
          msg.InstrumentList.map((i: any) => i.SecurityId),
          msg.InstrumentList[0]?.ExchangeSegment || "NSE_EQ",
        );
      } else if (msg.RequestCode === 16) {
        return encodeDhanUnsubscribeMessage(
          msg.InstrumentList.map((i: any) => i.SecurityId),
          msg.InstrumentList[0]?.ExchangeSegment || "NSE_EQ",
        );
      }
      return Buffer.from(JSON.stringify(msg));
    }

    // JSON protocol (default)
    return JSON.stringify(msg);
  }

  private handleReconnect(): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? 5;
    if (this.reconnectAttempts >= maxAttempts) {
      console.error(`[${this.source}] Max reconnection attempts reached`);
      return;
    }

    const delay =
      (this.config.reconnectDelay ?? 1000) *
      Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(
      `[${this.source}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${maxAttempts})`,
    );

    setTimeout(() => {
      if (this.credentials) this.connect(this.credentials);
    }, delay);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.logger.debug({ source: this.source }, "Sent keepalive ping");
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  disconnect(): void {
    this.stopKeepalive();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
  }

  getStats() {
    return {
      source: this.source,
      connected: this.ws?.readyState === WebSocket.OPEN,
      authenticated: this.isAuthenticated,
      subscribedSymbols: Array.from(this.subscribedSymbolTypes.entries()).map(
        ([symbol, types]) => ({
          symbol,
          types: Array.from(types),
        }),
      ),
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
