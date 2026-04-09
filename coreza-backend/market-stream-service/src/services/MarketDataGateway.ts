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
import { parseStreamName, extractSymbol } from "../utils/streamName";

export class MarketDataGateway {
  // Key: full source_id (e.g., 'alpaca_news', 'alpaca_stream') for unique instances
  private static instances = new Map<string, MarketDataGateway>();

  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private source: string; // Full source_id for behavior routing (e.g., 'alpaca_news')
  private credentials: any = null;
  // Single source of truth: native stream names (btcusdt@kline_1m, bars.AAPL)
  private subscribedStreams = new Set<string>();
  private isAuthenticated = false;
  private reconnectAttempts = 0;
  private redis = getRedisQueue();
  private logger = createLogger("MarketDataGateway");
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private messageSequence = 0;

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

    // Run pre-connect setup if required (e.g., Schwab OAuth streaming URL fetch, Binance listenKey)
    const needsPreConnect =
      typeof this.config.requiresPreConnect === "function"
        ? this.config.requiresPreConnect(this.source, credentials)
        : this.config.requiresPreConnect;
    if (needsPreConnect && this.config.preConnect) {
      this.logger.info({ source: this.source }, "Running pre-connect setup");
      this.credentials = await this.config.preConnect(credentials, this.source);
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
        const authMsg = this.config.makeAuthMessage?.(
          this.credentials,
          this.source,
        );
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
        this.clearCredentialIntervals();
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
          this.config.isAuthSuccess(msg, this.source)
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

        if (
          this.config.isAuthError &&
          this.config.isAuthError(msg, this.source)
        ) {
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
        event._seq = ++this.messageSequence;
        // Keep ordering domain bound to gateway source identifier (this.source),
        // not normalized event.source. Example: alpaca_trading -> *_trading domain.
        event._orderingDomain = `${this.source}:${event.type}`;

        // Publish to Redis symbol channel with circuit breaker
        // Trading sources use fixed stream names to match subscriber expectations
        let stream: string;
        if (this.source === "alpaca_trading") {
          stream = "trade_updates";
        } else if (this.source === "binance_trading") {
          stream = "user_data_stream";
        } else {
          stream = event.timeframe
            ? `${event.symbol.toLowerCase()}@${event.type}_${event.timeframe}`
            : `${event.symbol.toLowerCase()}@${event.type}`;
        }
        const channel = REDIS_CHANNELS.marketData(stream);
        await this.publishToRedis(channel, JSON.stringify(event));
        console.log(`🔴 [DEBUG-1] PUBLISHED to Redis channel: ${channel}`);
        console.log(`🔴 [DEBUG-1] Event data:`, JSON.stringify(event));

        // Metrics
        marketMessagesCounter.inc({
          source: this.source,
          stream: stream,
        });
        const latency = (Date.now() - startTime) / 1000;
        marketMessageLatencyHistogram.observe({ source: this.source }, latency);

        this.logger.debug(
          {
            source: this.source,
            stream: stream,
            price: event.c,
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

  /**
   * Subscribe to streams using native stream names directly
   * This is the primary subscription method
   */
  subscribeStreams(streamNames: string[]): void {
    const newStreams = streamNames.filter(
      (name) => !this.subscribedStreams.has(name),
    );

    if (newStreams.length === 0) {
      this.logger.debug(
        { source: this.source },
        "All streams already subscribed",
      );
      return;
    }

    // Add to tracking
    newStreams.forEach((name) => this.subscribedStreams.add(name));

    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      const msg = this.config.makeSubscribeMessage(newStreams, this.source);
      const payload = this.encodeMessage(msg);
      this.ws.send(payload);
      this.logger.info(
        { source: this.source, streams: newStreams },
        "Subscribed to streams",
      );
    }
  }

  /**
   * Unsubscribe from streams using native stream names
   */
  unsubscribeStreams(streamNames: string[]): void {
    const existingStreams = streamNames.filter((name) =>
      this.subscribedStreams.has(name),
    );

    if (existingStreams.length === 0) return;

    existingStreams.forEach((name) => this.subscribedStreams.delete(name));

    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.config.makeUnsubscribeMessage(streamNames, this.source);
      const payload = this.encodeMessage(msg);
      this.ws.send(payload);
      this.logger.info(
        { source: this.source, streams: existingStreams },
        "Unsubscribed from streams",
      );
    }
  }

  private resubscribeAll(): void {
    if (this.subscribedStreams.size > 0) {
      const streams = Array.from(this.subscribedStreams);

      const msg = this.config.makeSubscribeMessage(streams, this.source);
      const payload = this.encodeMessage(msg);
      this.ws?.send(payload);
      this.logger.info(
        { source: this.source, streams: streams },
        "Resubscribed to all streams",
      );
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
      alertMaxReconnectAttempts(this.source, maxAttempts);
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

  /**
   * Clear any intervals stored on credentials (e.g., Binance listenKey refresh)
   */
  private clearCredentialIntervals(): void {
    if (this.credentials?._listenKeyRefreshInterval) {
      clearInterval(this.credentials._listenKeyRefreshInterval);
      this.credentials._listenKeyRefreshInterval = null;
    }
  }

  disconnect(): void {
    this.stopKeepalive();
    this.clearCredentialIntervals();
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
      subscribedStreams: Array.from(this.subscribedStreams),
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
