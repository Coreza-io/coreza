import WebSocket from "ws";
import { randomUUID } from "crypto";
import { LOG } from "../utils/logging";
import { LIVE_TIMING_ENABLED, liveEventKind } from "../utils/liveTiming";
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
import {
  getBrokerStreamConfig,
  resolveTradingPublishStreamName,
} from "../config/brokerStreamConfig";
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

export interface GatewayLifecycle {
  status: "connecting" | "listening" | "reconnecting" | "failed" | "stopped";
  timestamp: string;
  code?: string;
  message?: string;
  retryCount: number;
}

export class MarketDataGateway {
  // Key: full source_id (e.g., 'alpaca_news', 'alpaca_stream') for unique instances
  private static instances = new Map<string, MarketDataGateway>();

  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private source: string; // Full source_id for behavior routing (e.g., 'alpaca_news')
  private readonly timingGeneration = LIVE_TIMING_ENABLED ? randomUUID() : "";
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
  private lastFatalControlMessage: unknown = null;
  private lastPongAt: number | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectionOpenedAt: number | null = null;
  private lastSubscribeSentAt: number | null = null;

  private startupObservationTimer: NodeJS.Timeout | null = null;

  async waitForStartup(deadlineAt: number): Promise<void> {
    while (Date.now() < deadlineAt) {
      if (this.terminalReported || this.intentionalStop) throw Object.assign(
        new Error(this.lifecycle?.message ?? "Stream gateway stopped during startup."),
        { code: this.lifecycle?.code ?? "STREAM_STARTUP_STOPPED", gatewayLifecycle: this.lifecycle });
      if (this.lifecycle?.status === "listening" && this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated &&
        (!this.config.startupObservationMs || Date.now() - Math.max(this.lastSubscribeSentAt ?? 0, this.connectionOpenedAt ?? 0) >= this.config.startupObservationMs)) return;
      await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadlineAt - Date.now()))));
    }
    throw Object.assign(new Error("Stream startup timed out before the required feed became ready."), { code: "STREAM_STARTUP_TIMEOUT" });
  }

  private observeStartup(): void {
    if (this.startupObservationTimer) clearTimeout(this.startupObservationTimer);
    const windowMs = this.config.startupObservationMs;
    if (!windowMs || !this.ws || !this.isAuthenticated || !this.subscribedStreams.size) return;
    const socket = this.ws;
    const sentAt = Math.max(this.connectionOpenedAt ?? 0, this.lastSubscribeSentAt ?? 0);
    this.startupObservationTimer = setTimeout(() => {
      this.startupObservationTimer = null;
      if (this.ws !== socket || socket.readyState !== WebSocket.OPEN || !this.isAuthenticated || this.terminalReported) return;
      this.logger.info({ source: this.source, observationMs: windowMs },
        "Stream startup observation passed; no provider authentication/subscription acknowledgment was available");
      this.reportLifecycle("listening");
    }, Math.max(0, windowMs - (Date.now() - sentAt)));
  }

  private sanitizeFailure(text: string): string {
    let value = text.replace(/wss?:\/\/\S+/gi, "[WebSocket URL redacted]");
    for (const token of [this.credentials?.api_key, this.credentials?.access_token]) {
      if (typeof token === "string" && token) value = value.split(token).join("[redacted]");
    }
    return value.replace(/[\r\n]/g, " ").slice(0, 240);
  }

  private intentionalStop = false;
  private readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  waitUntilReady(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated) return Promise.resolve();
    if (this.lifecycle?.status === "failed" || this.intentionalStop) return Promise.reject(new Error(this.lifecycle?.message ?? "Gateway stopped"));
    return new Promise((resolve, reject) => this.readyWaiters.add({ resolve, reject }));
  }
  private terminalReported = false;
  private lastCloseCode: number | undefined;
  private lifecycle: GatewayLifecycle | undefined;
  onLifecycle?: (event: GatewayLifecycle) => void;

  private reportLifecycle(status: GatewayLifecycle["status"], code?: string, message?: string): void {
    if (this.terminalReported) return;
    if (status === "failed") this.terminalReported = true;
    this.lifecycle = { status, code, message, retryCount: this.reconnectAttempts, timestamp: new Date().toISOString() };
    this.onLifecycle?.(this.lifecycle);
    if (status === "listening" || status === "failed" || status === "stopped") {
      for (const waiter of this.readyWaiters) {
        if (status === "listening") waiter.resolve();
        else waiter.reject(new Error(message ?? "Gateway stopped"));
      }
      this.readyWaiters.clear();
    }
  }

  getLifecycle(): GatewayLifecycle | undefined { return this.lifecycle; }

  private providerFailure(msg: any): void {
    const code = String(msg?.reasonCode ?? msg?.code ?? "PROVIDER_REJECTED");
    // Only decoded provider fields are exposed; never send raw auth/control payloads.
    const reason = this.source.startsWith("dhan") ? msg?.reasonText : undefined;
    const safeReason = typeof reason === "string" ? this.sanitizeFailure(reason) : "Provider rejected the stream request";
    this.reportLifecycle("failed", code, `${this.source.split("_")[0]} stream rejected (${code}). ${safeReason}`);
    this.lastFatalControlMessage = { code };
    this.ws?.close();
  }

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

  connect(
    credentials: any,
    preConnectContext?: GatewayPreConnectContext,
  ): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return Promise.reject(
        new Error(
          `Gateway ${this.source} is connecting without a tracked connect promise`,
        ),
      );
    }

    const wasStopped = this.intentionalStop;
    this.intentionalStop = false;
    if (wasStopped) this.lastCloseCode = undefined;
    if (this.terminalReported) {
      this.terminalReported = false;
      this.reconnectAttempts = 0;
      this.lastCloseCode = undefined;
      this.lastFatalControlMessage = null;
    }
    if (!this.reconnectAttempts) this.reportLifecycle("connecting");
    this.credentials = credentials;
    if (preConnectContext) {
      this.preConnectContext = preConnectContext;
    }

    this.connectPromise = this.connectSocket(
      credentials,
      preConnectContext,
    ).catch((error) => {
      // Pre-connect failures have no socket close event to schedule the next retry.
      if (!this.intentionalStop && !this.ws && !this.reconnectTimer && !this.terminalReported) this.handleReconnect();
      throw error;
    }).finally(() => {
      this.connectPromise = null;
      this.connectReject = null;
    });

    return this.connectPromise;
  }

  private async connectSocket(
    credentials: any,
    preConnectContext?: GatewayPreConnectContext,
  ): Promise<void> {
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
        preConnectContext ?? this.preConnectContext,
      );
    }

    // Pass source to wsUrl function for behavior routing (e.g., alpaca_news uses different URL)
    const url =
      typeof this.config.wsUrl === "function"
        ? this.config.wsUrl(this.credentials, this.source)
        : this.config.wsUrl;

    return new Promise((resolve, reject) => {
      this.connectReject = reject;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url, { headers: this.config.makeAuthHeaders?.(this.credentials), handshakeTimeout: 10000 });
      } catch {
        reject(Object.assign(new Error(`Gateway ${this.source} transport could not be opened.`), { code: "STREAM_TRANSPORT_FAILED" }));
        return;
      }
      this.ws = socket;
      const isCurrentSocket = () => this.ws === socket;

      socket.on("open", () => {
        if (!isCurrentSocket()) {
          if (LOG) this.logger.debug(
            { source: this.source },
            "Ignoring open from replaced gateway socket",
          );
          return;
        }

        this.logger.info({ source: this.source }, "Gateway connected");
        this.clearReconnectTimer();
        this.connectionOpenedAt = Date.now();
        this.lastPongAt = null;
        activeGatewayConnectionsGauge.set({ source: this.source }, 1);
        this.startKeepalive();
        this.awaitingPostAuth = false;
        this.lastFatalControlMessage = null;
        const authMsg = this.config.makeAuthMessage?.(
          this.credentials,
          this.source,
        );
        if (authMsg) {
          const payload = this.encodeMessage(authMsg);
          if (this.assertSocketBoundary(authMsg, "send")) {
            this.logger.info(
              {
                source: this.source,
                authMessage: this.redactAuthMessage(authMsg),
              },
              "Sending gateway authentication message",
            );
            socket.send(payload);
            if (this.authCompletesOnSend()) {
              this.markConnectionReady(resolve);
            }
          }
        } else {
          this.markConnectionReady(resolve);
        }
      });

      socket.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
        if (!isCurrentSocket()) {
          if (LOG) this.logger.debug(
            { source: this.source },
            "Ignoring message from replaced gateway socket",
          );
          return;
        }
        const buffer = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(new Uint8Array(data));
        this.handleMessage(buffer, resolve, isBinary);
      });

      socket.on("close", (code: number, reason: Buffer) => {
        if (!isCurrentSocket()) {
          if (LOG) this.logger.debug(
            { source: this.source, code },
            "Ignoring close from replaced gateway socket",
          );
          return;
        }

        const now = Date.now();
        this.lastCloseCode = code;
        const reasonStr = this.sanitizeFailure(reason.toString()) || "No reason provided";
        const uptimeMs = this.connectionOpenedAt
          ? now - this.connectionOpenedAt
          : null;
        const msSinceSubscribe = this.lastSubscribeSentAt
          ? now - this.lastSubscribeSentAt
          : null;
        this.logger.warn(
          {
            source: this.source,
            code,
            reason: reasonStr,
            uptimeMs,
            msSinceSubscribe,
            lastPongAt: this.lastPongAt,
          },
          "Gateway disconnected",
        );
        this.ws = null;
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
        this.resetReconnectAttemptsAfterStableClose(uptimeMs);
        this.handleReconnect();
        reject(
          new Error(
            `Gateway disconnected before connection completed: ${code} - ${reasonStr}`,
          ),
        );
      });

      socket.on("error", (err) => {
        if (!isCurrentSocket()) {
          if (LOG) this.logger.debug(
            { source: this.source },
            "Ignoring error from replaced gateway socket",
          );
          return;
        }
        this.logger.error({ source: this.source }, "Gateway transport error");
        reject(new Error(`Gateway ${this.source} transport connection failed.`));
      });

      socket.on("ping", (payload: Buffer) => {
        if (!isCurrentSocket()) {
          if (LOG) this.logger.debug(
            { source: this.source },
            "Ignoring ping from replaced gateway socket",
          );
          return;
        }
        if (LOG) this.logger.debug(
          { source: this.source, payloadBytes: payload.length, autoPong: true },
          "Received gateway ping",
        );
      });

      socket.on("pong", (payload: Buffer) => {
        if (!isCurrentSocket()) {
          if (LOG) this.logger.debug(
            { source: this.source },
            "Ignoring pong from replaced gateway socket",
          );
          return;
        }
        this.lastPongAt = Date.now();
        if (LOG) this.logger.debug(
          { source: this.source, payloadBytes: payload.length },
          "Received gateway pong",
        );
      });

      socket.on("unexpected-response", (_request, response) => {
        if (!isCurrentSocket()) {
          if (LOG) this.logger.debug(
            { source: this.source },
            "Ignoring unexpected response from replaced gateway socket",
          );
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          this.logger.error(
            { source: this.source, statusCode: response.statusCode, body },
            "Gateway unexpected response",
          );
          reject(
            new Error(
              `Gateway unexpected response: ${response.statusCode ?? "unknown"}`,
            ),
          );
        });
      });
    });
  }

  private async handleMessage(
    buffer: Buffer,
    resolveConnect?: () => void,
    isBinary = false,
  ): Promise<void> {
    try {
      const startTime = Date.now();
      const messages = this.config.parseMessage(buffer, this.source, isBinary);

      // Debug log ALL incoming messages
      if (LOG) this.logger.debug(
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
            { source: this.source },
            "Authentication failed",
          );
          this.providerFailure(msg);
          continue;
        }

        // Handle control messages (subscription confirmations, etc.) - pass source
        if (this.config.handleControlMessage) {
          this.config.handleControlMessage(msg, this.logger, this.source);
        }

        if (this.config.isFatalControlMessage?.(msg, this.source)) {
          this.providerFailure(msg);
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
        if (LIVE_TIMING_ENABLED) event._timing = {
          gatewayReceivedAt: startTime,
          eventKind: liveEventKind(event.type),
          gatewayGeneration: this.timingGeneration,
        };

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
            if (LOG) {
              console.log(`🔴 [DEBUG-1] PUBLISHED to Redis channel: ${channel}`);
              console.log(`🔴 [DEBUG-1] Event data:`, JSON.stringify(event));
            }

            marketMessagesCounter.inc({
              source: this.source,
              stream: subscribedStream,
            });
          }

          continue;
        }

        // Publish to Redis symbol channel with circuit breaker
        // Trading sources use fixed stream names to match subscriber expectations

        const exchangePart = event.exchange
          ? `@${event.exchange.toLowerCase()}`
          : "";
        const stream = isTradingLifecycleEvent
          ? resolveTradingPublishStreamName(event.source, event.type)
          : event.timeframe
            ? event.contractType
              ? `${event.symbol.toLowerCase()}_${event.contractType.toLowerCase()}@${event.type}_${event.timeframe}`
              : `${event.symbol.toLowerCase()}${exchangePart}@${event.type}_${event.timeframe}`
            : event.contractType
              ? `${event.symbol.toLowerCase()}_${event.contractType.toLowerCase()}@${event.type}`
              : `${event.symbol.toLowerCase()}${exchangePart}@${event.type}`;

        const channel = REDIS_CHANNELS.streamData(stream);
        await this.publishToRedis(channel, JSON.stringify(event));
        if (LOG) {
          console.log(`🔴 [DEBUG-1] PUBLISHED to Redis channel: ${channel}`);
          console.log(`🔴 [DEBUG-1] Event data:`, JSON.stringify(event));
        }

        // Metrics
        marketMessagesCounter.inc({
          source: this.source,
          stream: stream,
        });
        const latency = (Date.now() - startTime) / 1000;
        marketMessageLatencyHistogram.observe({ source: this.source }, latency);

        if (LOG) this.logger.debug(
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

  private sendGatewayMessages(msg: unknown): number {
    const messages = Array.isArray(msg) ? msg : [msg];
    let sentCount = 0;

    for (const message of messages) {
      if (message === null || message === undefined) continue;
      const payload = this.encodeMessage(message);
      if (this.assertSocketBoundary(message, "send")) {
        this.ws?.send(payload);
        sentCount += 1;
      }
    }

    return sentCount;
  }

  private makeSubscribeMessageSafely(
    streams: string[],
    streamSource: string,
  ): unknown | undefined {
    try {
      const msg = this.config.makeSubscribeMessage(
        streams,
        streamSource,
        this.credentials,
      );
      const payloadCount = this.countGatewayMessages(msg);

      if (payloadCount === 0) {
        this.logger.warn(
          { source: this.source, streamSource, streams },
          "No subscribe payload generated; skipping gateway send",
        );
        return undefined;
      }

      if (LOG) this.logger.debug(
        {
          source: this.source,
          streamSource,
          streamCount: streams.length,
          payloadCount,
        },
        "Generated subscribe payloads",
      );
      return msg;
    } catch (error) {
      this.logger.error(
        { source: this.source, streamSource, streams, err: error },
        "Failed to generate subscribe payload",
      );
      return undefined;
    }
  }

  private countGatewayMessages(msg: unknown): number {
    const messages = Array.isArray(msg) ? msg : [msg];
    return messages.filter(
      (message) => message !== null && message !== undefined,
    ).length;
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
      if (LOG) this.logger.debug(
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
      const msg = this.makeSubscribeMessageSafely(newStreams, this.source);
      if (!msg) {
        if (this.config.startupObservationMs && !this.source.endsWith("_trading")) throw Object.assign(new Error("Dhan did not generate a subscription payload for the requested stream."), { code: "DHAN_SUBSCRIPTION_NOT_SENT" });
        this.observeStartup(); // Account-wide Dhan order updates use the login message.
        return;
      }
      const payloadCount = this.sendGatewayMessages(msg);
      this.lastSubscribeSentAt = Date.now();
      this.logger.info(
        { source: this.source, streams: newStreams, payloadCount },
        "Subscription payload sent",
      );
      this.observeStartup();
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
      this.subscribedStreamSources.delete(name);
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.config.makeUnsubscribeMessage(
        existingStreams,
        this.source,
        this.credentials,
      );
      this.sendGatewayMessages(msg);
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
      const msg = this.makeSubscribeMessageSafely(streams, streamSource);
      if (!msg) continue;

      const payloadCount = this.sendGatewayMessages(msg);
      this.lastSubscribeSentAt = Date.now();
      this.logger.info(
        { source: this.source, streamSource, streams, payloadCount },
        "Resubscription payload sent",
      );
      this.observeStartup();
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

  private redactAuthMessage(msg: unknown): unknown {
    if (!msg || typeof msg !== "object") return msg;

    const streamConfig = getBrokerStreamConfig(this.source);
    if (streamConfig.redactAuthMessage) {
      return streamConfig.redactAuthMessage(msg);
    }

    const clone = JSON.parse(JSON.stringify(msg));
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
    if (this.intentionalStop || this.terminalReported) return;
    if (this.reconnectTimer) {
      if (LOG) this.logger.debug(
        { source: this.source },
        "Reconnect already scheduled; skipping duplicate request",
      );
      return;
    }

    if (this.lastFatalControlMessage) {
      this.logger.error(
        { source: this.source, controlMessage: this.lastFatalControlMessage },
        "Suppressing reconnect after fatal gateway control message",
      );
      this.lastFatalControlMessage = null;
      return;
    }

    const maxAttempts = this.config.maxReconnectAttempts ?? 5;
    if (this.reconnectAttempts >= maxAttempts) {
      console.error(`[${this.source}] Max reconnection attempts reached`);
      alertMaxReconnectAttempts(this.source, maxAttempts);
      const broker = this.source.startsWith("dhan") ? "Dhan" : this.source.split("_")[0];
      this.reportLifecycle("failed", String(this.lastCloseCode ?? "CONNECT_FAILED"),
        `${broker} stream disconnected${this.lastCloseCode ? ` (${this.lastCloseCode})` : ""}. Reconnection failed after ${maxAttempts} attempts.`);
      return;
    }

    const baseDelay = this.config.reconnectDelay ?? 1000;
    const exponential = baseDelay * Math.pow(2, this.reconnectAttempts);
    const capped = this.config.maxReconnectDelay
      ? Math.min(exponential, this.config.maxReconnectDelay)
      : exponential;
    const jitter =
      this.config.reconnectJitter && this.config.reconnectJitter > 0
        ? Math.floor(Math.random() * (this.config.reconnectJitter + 1))
        : 0;
    const delay = capped + jitter;
    this.reconnectAttempts++;
    this.reportLifecycle("reconnecting", this.lastCloseCode ? String(this.lastCloseCode) : undefined);

    console.log(
      `[${this.source}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${maxAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.credentials) return;
      this.connect(this.credentials, this.preConnectContext ?? undefined).catch(
        (error) => {
          this.logger.error(
            { source: this.source, error },
            "Gateway reconnect failed",
          );
        },
      );
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
        if (LOG) this.logger.debug({ source: this.source }, "Sent keepalive ping");
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
          if (LOG) this.logger.debug(
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
    this.logger.info({ source: this.source },
      this.config.startupObservationMs || this.authCompletesOnSend() || !this.config.makeAuthMessage
        ? "WebSocket ready; provider authentication acknowledgment unavailable"
        : "Provider authentication confirmed");
    this.clearReconnectTimer();
    if (this.config.reconnectResetAfterMs === undefined) {
      this.reconnectAttempts = 0;
    }
    this.isAuthenticated = true;
    this.awaitingPostAuth = false;
    this.resubscribeAll();
    this.startTradingKeepalive();
    this.reportLifecycle(this.config.startupObservationMs ? (this.reconnectAttempts ? "reconnecting" : "connecting") : "listening");
    // Transport setup can complete before a feed passes its startup check.
    for (const waiter of this.readyWaiters) waiter.resolve();
    this.readyWaiters.clear();
    this.observeStartup();
    if (resolveConnect) resolveConnect();
  }

  private resetReconnectAttemptsAfterStableClose(uptimeMs: number | null): void {
    const resetAfterMs = this.config.reconnectResetAfterMs;
    if (resetAfterMs === undefined || uptimeMs === null || uptimeMs < resetAfterMs) {
      return;
    }

    this.logger.info(
      { source: this.source, uptimeMs, reconnectResetAfterMs: resetAfterMs },
      "Resetting reconnect attempts after stable gateway connection",
    );
    this.reconnectAttempts = 0;
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
    this.intentionalStop = true;
    if (this.startupObservationTimer) clearTimeout(this.startupObservationTimer);
    this.startupObservationTimer = null;
    this.reportLifecycle("stopped");
    this.clearReconnectTimer();
    this.connectReject?.(
      new Error(`Gateway ${this.source} disconnected intentionally`),
    );
    this.connectPromise = null;
    this.connectReject = null;
    this.stopKeepalive();
    this.stopTradingKeepalive();
    this.clearCredentialIntervals();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.awaitingPostAuth = false;
    this.lastFatalControlMessage = null;
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
