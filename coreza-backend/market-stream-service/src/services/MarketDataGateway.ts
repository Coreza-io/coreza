import WebSocket from "ws";
import { getRedisQueue } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import {
  GatewayConfig,
  GATEWAY_CONFIGS,
  GatewayPreConnectContext,
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
import {
  parseStreamName,
  extractSymbol,
  tradingRoutingKey,
} from "../utils/streamName";

const TRADING_LIFECYCLE_EVENTS = new Set([
  "algo_update",
  "trade_updates",
  "ORDER_TRADE_UPDATE",
  "executionReport",
  "account_activity",
  "account_activity ",
  "order_update",
  "order_alert",
  "listen_key_expired",
]);

export class MarketDataGateway {
  // Key: full source_id (e.g., 'alpaca_news', 'alpaca_stream') for unique instances
  private static instances = new Map<string, MarketDataGateway>();

  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private source: string; // Full source_id for behavior routing (e.g., 'alpaca_news')
  private credentials: any = null;
  private preConnectContext: GatewayPreConnectContext | null = null;
  // Single source of truth: native stream names (btcusdt@kline_1m, bars.AAPL)
  private subscribedStreams = new Set<string>();
  private subscribedStreamSources = new Map<string, string>();
  private isAuthenticated = false;
  private reconnectAttempts = 0;
  private redis = getRedisQueue();
  private logger = createLogger("MarketDataGateway");
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private tradingKeepaliveInterval: NodeJS.Timeout | null = null;
  private messageSequence = 0;
  private awaitingPostAuth = false;

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

  async connect(
    credentials: any,
    preConnectContext?: GatewayPreConnectContext,
  ): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.credentials = credentials;
    if (preConnectContext) {
      this.preConnectContext = preConnectContext;
    }

    // Run pre-connect setup if required (e.g., Schwab OAuth streaming URL fetch, Binance listenKey)
    const needsPreConnect =
      typeof this.config.requiresPreConnect === "function"
        ? this.config.requiresPreConnect(this.source, credentials)
        : this.config.requiresPreConnect;
    if (needsPreConnect && this.config.preConnect) {
      if (!this.preConnectContext) {
        throw new Error(
          `Missing pre-connect context for ${this.source} gateway`,
        );
      }

      this.logger.info({ source: this.source }, "Running pre-connect setup");
      this.credentials = await this.config.preConnect(
        credentials,
        this.preConnectContext,
      );
    }

    // Pass source to wsUrl function for behavior routing (e.g., alpaca_news uses different URL)
    const url =
      typeof this.config.wsUrl === "function"
        ? this.config.wsUrl(this.credentials, this.source)
        : this.config.wsUrl;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: this.config.makeAuthHeaders?.(this.credentials),
      });

      this.ws.on("open", () => {
        this.logger.info({ source: this.source }, "Gateway connected");
        activeGatewayConnectionsGauge.set({ source: this.source }, 1);
        this.startKeepalive();
        this.awaitingPostAuth = false;
        const authMsg = this.config.makeAuthMessage?.(
          this.credentials,
          this.source,
        );
        if (authMsg) {
          const payload = this.encodeMessage(authMsg);
          if (this.assertSocketBoundary(authMsg, "send")) {
            this.logger.info(
              { source: this.source, authMessage: this.redactAuthMessage(authMsg) },
              "Sending gateway authentication message",
            );
            this.ws!.send(payload);
            if (this.authCompletesOnSend()) {
              this.markConnectionReady(resolve);
            }
          }
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
        this.awaitingPostAuth = false;
        this.stopKeepalive();
        this.stopTradingKeepalive();
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
      const messages = this.config.parseMessage(buffer, this.source);

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
          !this.awaitingPostAuth &&
          this.config.isAuthSuccess &&
          this.config.isAuthSuccess(msg, this.source)
        ) {
          if (this.config.postAuthHook && this.ws) {
            this.logger.info(
              { source: this.source },
              "Authentication successful, running post-auth hook",
            );
            const postAuthStarted = this.config.postAuthHook(
              this.ws,
              this.credentials,
              this.source,
              this.logger,
            );
            if (postAuthStarted) {
              this.awaitingPostAuth = true;
            } else {
              this.markConnectionReady(resolveConnect);
            }
          } else {
            this.markConnectionReady(resolveConnect);
          }
          continue;
        }

        if (
          this.awaitingPostAuth &&
          this.config.isPostAuthSuccess &&
          this.config.isPostAuthSuccess(msg, this.source)
        ) {
          this.markConnectionReady(resolveConnect);
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
        if (!event) continue;
        const isTradingLifecycleEvent =
          typeof event.type === "string" &&
          TRADING_LIFECYCLE_EVENTS.has(event.type);
        if (!event.symbol && !isTradingLifecycleEvent) continue;
        event._seq = ++this.messageSequence;
        // Keep ordering domain bound to gateway source identifier (this.source),
        // not normalized event.source. Example: alpaca_trading -> *_trading domain.
        event._orderingDomain = `${this.source}:${event.type}`;

        if (event.type === "news") {
          const eventSymbols = Array.isArray(event.symbols)
            ? event.symbols.map((s: string) => String(s).toUpperCase())
            : [];

          for (const subscribedStream of this.subscribedStreams) {
            if (!subscribedStream.endsWith("@news")) continue;

            const subscribedSymbol = subscribedStream
              .split("@")[0]
              .toUpperCase();
            const subscribedNormalized = subscribedSymbol.replace(/\//g, "");
            if (
              subscribedNormalized !== "*" &&
              !eventSymbols.includes(subscribedNormalized)
            ) {
              continue;
            }

            const channel = REDIS_CHANNELS.streamData(subscribedStream);
            const publishEvent = {
              ...event,
              symbol: subscribedSymbol,
            };
            await this.publishToRedis(channel, JSON.stringify(publishEvent));
            console.log(`🔴 [DEBUG-1] PUBLISHED to Redis channel: ${channel}`);
            console.log(`🔴 [DEBUG-1] Event data:`, JSON.stringify(event));

            marketMessagesCounter.inc({
              source: this.source,
              stream: subscribedStream,
            });
          }

          continue;
        }

        // Publish to Redis symbol channel with circuit breaker
        // Trading sources use fixed stream names to match subscriber expectations

        const stream = isTradingLifecycleEvent
          ? event.type
          : event.timeframe
            ? event.contractType
              ? `${event.symbol.toLowerCase()}_${event.contractType.toLowerCase()}@${event.type}_${event.timeframe}`
              : `${event.symbol.toLowerCase()}@${event.type}_${event.timeframe}`
            : event.contractType
              ? `${event.symbol.toLowerCase()}_${event.contractType.toLowerCase()}@${event.type}`
              : `${event.symbol.toLowerCase()}@${event.type}`;

        const channel = REDIS_CHANNELS.streamData(stream);
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

  // private resolveTradingRoutingKey(event: CorezaMarketEvent): string {
  //   const nativeEventType =
  //     event.rawOrderData?.e ||
  //     (event.type === "algo_update"
  //       ? "ALGO_UPDATE"
  //       : event.type === "listen_key_expired"
  //         ? "listenKeyExpired"
  //         : "ORDER_TRADE_UPDATE");
  //   return tradingRoutingKey(this.source, nativeEventType);
  // }

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
    newStreams.forEach((name) => {
      this.subscribedStreams.add(name);
      this.subscribedStreamSources.set(name, this.source);
    });

    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) {
      const msg = this.config.makeSubscribeMessage(newStreams, this.source);
      if (msg !== null && msg !== undefined) {
        const payload = this.encodeMessage(msg);
        if (this.assertSocketBoundary(msg, "send")) {
          this.ws.send(payload);
        }
      }
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

    existingStreams.forEach((name) => {
      this.subscribedStreams.delete(name);
      this.subscribedStreamSources.delete(this.source);
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.config.makeUnsubscribeMessage(streamNames, this.source);
      if (msg !== null && msg !== undefined) {
        const payload = this.encodeMessage(msg);
        if (this.assertSocketBoundary(msg, "send")) {
          this.ws.send(payload);
        }
      }
      this.logger.info(
        { source: this.source, streams: existingStreams },
        "Unsubscribed from streams",
      );
    }
  }

  private resubscribeAll(): void {
    if (this.subscribedStreams.size === 0) return;

    const streamsBySource = new Map<string, string[]>();
    for (const stream of this.subscribedStreams) {
      const streamSource =
        this.subscribedStreamSources.get(stream) || this.source;
      const streams = streamsBySource.get(streamSource) || [];
      streams.push(stream);
      streamsBySource.set(streamSource, streams);
    }

    for (const [streamSource, streams] of streamsBySource.entries()) {
      const msg = this.config.makeSubscribeMessage(streams, streamSource);
      if (msg !== null && msg !== undefined) {
        const payload = this.encodeMessage(msg);
        if (this.assertSocketBoundary(msg, "send")) {
          this.ws?.send(payload);
        }
      }
      this.logger.info(
        { source: this.source, streamSource, streams },
        "Resubscribed to streams",
      );
    }
  }

  private isTradingPayload(msg: any): boolean {
    if (!msg || typeof msg !== "object") return false;
    const method = typeof msg.method === "string" ? msg.method : "";
    return (
      method.startsWith("session.") ||
      method.startsWith("userDataStream.") ||
      method.startsWith("order.")
    );
  }

  private assertSocketBoundary(
    msg: any,
    direction: "send" | "receive",
  ): boolean {
    if (!msg || typeof msg !== "object") return true;

    if (this.config.validateOutbound)
      return this.config.validateOutbound(msg, this.source);
    const method = typeof msg.method === "string" ? msg.method : "";
    const isSubscribePayload =
      method === "SUBSCRIBE" || method === "UNSUBSCRIBE";
    const isTradingPayload = this.isTradingPayload(msg);

    if (isSubscribePayload && this.source === "binance_trading") {
      this.logger.error(
        { source: this.source, method, direction },
        "Dropped market subscribe payload on Binance trading socket",
      );
      return false;
    }

    if (isTradingPayload && this.source !== "binance_trading") {
      this.logger.error(
        { source: this.source, method, direction },
        "Dropped trading payload on Binance market socket",
      );
      return false;
    }

    return true;
  }

  private redactAuthMessage(msg: any): any {
    if (!msg || typeof msg !== "object") return msg;
    const clone = JSON.parse(JSON.stringify(msg));
    if (clone.LoginReq?.Token) clone.LoginReq.Token = "[REDACTED]";
    if (clone.action === "auth" && clone.key) clone.key = "[REDACTED]";
    if (clone.action === "auth" && clone.secret) clone.secret = "[REDACTED]";
    return clone;
  }

  private isBinaryProtocol(source = this.source): boolean {
    return typeof this.config.isBinary === "function"
      ? this.config.isBinary(source)
      : Boolean(this.config.isBinary);
  }

  private authCompletesOnSend(source = this.source): boolean {
    return typeof this.config.authCompletesOnSend === "function"
      ? this.config.authCompletesOnSend(source)
      : Boolean(this.config.authCompletesOnSend);
  }

  private encodeMessage(msg: any): Buffer | string {
    if (this.isBinaryProtocol()) {
      return this.config.encodeOutboundBinary
        ? this.config.encodeOutboundBinary(msg)
        : Buffer.from(JSON.stringify(msg));
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
      if (this.credentials) {
        this.connect(this.credentials, this.preConnectContext ?? undefined);
      }
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

  private startTradingKeepalive(): void {
    this.stopTradingKeepalive();

    const hasKeepalive = this.config.makeTradingKeepaliveMessage?.(
      this.credentials,
      this.source,
    );
    if (!hasKeepalive) return;

    this.tradingKeepaliveInterval = setInterval(
      () => {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        const keepaliveMsg = this.config.makeTradingKeepaliveMessage?.(
          this.credentials,
          this.source,
        );
        if (!keepaliveMsg) return;

        const payload = this.encodeMessage(keepaliveMsg);
        if (this.assertSocketBoundary(keepaliveMsg, "send")) {
          this.ws.send(payload);
          this.logger.debug(
            { source: this.source },
            "Sent trading keepalive ping",
          );
        }
      },
      30 * 60 * 1000,
    );
  }

  private stopTradingKeepalive(): void {
    if (this.tradingKeepaliveInterval) {
      clearInterval(this.tradingKeepaliveInterval);
      this.tradingKeepaliveInterval = null;
    }
  }

  private markConnectionReady(resolveConnect?: () => void): void {
    this.logger.info({ source: this.source }, "Authentication successful");
    this.isAuthenticated = true;
    this.awaitingPostAuth = false;
    this.resubscribeAll();
    this.startTradingKeepalive();
    if (resolveConnect) resolveConnect();
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

    if (typeof this.credentials?._closeListenKey === "function") {
      Promise.resolve(this.credentials._closeListenKey()).catch((error) => {
        this.logger.warn(
          { source: this.source, error },
          "Failed to close listenKey during teardown",
        );
      });
      this.credentials._closeListenKey = null;
    }
  }

  disconnect(): void {
    this.stopKeepalive();
    this.stopTradingKeepalive();
    this.clearCredentialIntervals();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.awaitingPostAuth = false;
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
