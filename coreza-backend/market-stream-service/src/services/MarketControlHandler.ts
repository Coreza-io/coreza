/**
 * Phase 5: Market Control Handler
 * Centralized subscription orchestration that listens to Redis control channels
 * and instructs MarketDataGateway instances to connect/subscribe/unsubscribe
 */

import Redis from "ioredis";
import { getDhanCredentialRevision, resolveDhanEnvironment, getDhanMarketWsUrl, getDhanOrderUpdateWsUrl } from "../marketGateways/dhan/environment";
import { Mutex } from "async-mutex";
import { createRedisPubSub } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import { getRedisCache, getRedisQueue } from "../config/redis";
import { MarketDataGateway } from "./MarketDataGateway";
import { MarketDataSubscriber } from "./MarketDataSubscriber";
import CredentialManager from "../utils/credentialManager";
import { redisSetBreaker } from "../utils/redisCircuitBreaker";
import {
  buildStreamNames,
  extractSymbol,
  parseStreamName,
  tradingRoutingKey,
} from "../utils/streamName";
import {
  computeTradingNativeStreamsFromConfig,
  getBrokerStreamConfig,
  getCompanionSources as getCompanionSourcesFromConfig,
} from "../config/brokerStreamConfig";
import type { MarketSource } from "../types/marketEvent";

interface ControlMessage {
  action: "subscribe" | "unsubscribe";
  requestId?: string;
  userId: string;
  workflowId: string;
  nodeId?: string;
  symbols: string[];
  source: MarketSource;
  credentialId?: string;
  credentialRevision?: string;
  startupDeadlineAt?: number;
  streamType?: string[];
  exchange?: string;
  feed?: string;
  environment?: string; // For Binance: testnet/live
  assetType?: string; // For Binance: spot/futures
  marketType?: string;
  scope: string;
  targetWorkflowId?: string;
  //tradingNativeStreams?: string[];
  // Raw interval/depth for stream name building (centralized in market-stream-service)
  interval?: string;
  depthLevels?: string;
  contractType?: "perpetual" | "current_quarter" | "next_quarter";
}

interface ManualListenerRegistration {
  userId: string;
  workflowId: string;
  nodeId: string;
  attemptId: string;
  routingWorkflowId: string;
  mode: string;
  source: string;
  scope: string;
  environment?: string;
  credentialId?: string;
  credentialRevision?: string;
  startupDeadlineAt?: number;
  requiredSources?: string[];
  gatewayIdentities?: string[];
  dependencies?: { source: string; environment: string; credentialId: string; credentialRevision?: string }[];
}

interface SourceState {
  key: string;
  credentialRevision?: string;
  source: MarketSource;
  gateway: MarketDataGateway;
  connectedUserId: string;
  credentialId: string;
  environment?: string;
  // Single source of truth: native stream names (btcusdt@kline_1m, bars.AAPL)
  streams: Set<string>;
  workflowStreams: Map<string, Set<string>>; // workflowId → streams (for reference counting)
}

function isTradingSource(source: string): boolean {
  return source.endsWith("_trading");
}

function computeTradingNativeStreams(
  source: MarketSource,
  marketType?: string,
): string[] {
  return computeTradingNativeStreamsFromConfig(source, marketType);
}

function getUnifiedSocketStateSource(source: string): string {
  const cfg = getBrokerStreamConfig(source);
  const baseSource = source.split("_")[0];
  const baseCfg = getBrokerStreamConfig(baseSource);
  return cfg.unifiedSocket || baseCfg.unifiedSocket ? baseSource : source;
}

/**
 * Build native market stream names for a control message using the generic
 * builder. Brokers may optionally preprocess the requested symbols (e.g. Dhan
 * splits `SYMBOL:securityId` tokens and seeds its in-memory resolution map).
 * Routing keys are identical to these native names for every broker.
 */
function buildNativeStreamNames(
  source: MarketSource,
  symbols: string[],
  streamType: string[] | undefined,
  interval: string | undefined,
  contractType: string | undefined,
  exchange?: string,
): string[] {
  const cfg = getBrokerStreamConfig(source);
  const resolvedSymbols = cfg.preprocessSubscriptionSymbols
    ? cfg.preprocessSubscriptionSymbols(symbols, exchange)
    : symbols;

  return buildStreamNames(
    source,
    resolvedSymbols,
    streamType || [],
    interval || "",
    contractType,
    exchange,
  );
}

export class MarketControlHandler {
  private static instance: MarketControlHandler;
  private redisSub: Redis;
  private redisPub: Redis;
  private sourceStates = new Map<string, SourceState>();
  private initialized = false;
  private workflowControlQueues = new Map<string, Promise<void>>();
  private pendingManualCleanups = new Set<string>();
  private manualRoutingMutexes = new Map<string, Mutex>();
  private getManualRoutingMutex(workflowId: string): Mutex {
    let mutex = this.manualRoutingMutexes.get(workflowId);
    if (!mutex) { mutex = new Mutex(); this.manualRoutingMutexes.set(workflowId, mutex); }
    return mutex;
  }
  private releaseManualRouting(workflowId: string, release?: () => void): void {
    release?.();
    const mutex = this.manualRoutingMutexes.get(workflowId);
    if (mutex && !mutex.isLocked()) this.manualRoutingMutexes.delete(workflowId);
  }
  private gatewayMutexes = new Map<string, Mutex>();

  private getGatewayMutex(userId: string, source: string, connectionKey?: string): Mutex {
    const key = connectionKey ?? this.getStateKey(userId, source);
    let mutex = this.gatewayMutexes.get(key);
    if (!mutex) { mutex = new Mutex(); this.gatewayMutexes.set(key, mutex); }
    return mutex;
  }

  private constructor() {
    // Create isolated Redis connections for this service
    const { pub, sub } = createRedisPubSub();
    this.redisPub = pub;
    this.redisSub = sub;
  }

  static getInstance(): MarketControlHandler {
    if (!MarketControlHandler.instance) {
      MarketControlHandler.instance = new MarketControlHandler();
    }
    return MarketControlHandler.instance;
  }

  private getStateKey(userId: string, source: MarketSource | string, credentialId?: string, environment?: string, revision?: string): string {
    const base = `${userId}:${getUnifiedSocketStateSource(source)}`;
    return source.startsWith("dhan") && revision ? `${base}:${environment}:${credentialId}:${revision}` : base;
  }

  private async resolveDhanConnection(userId: string, source: string, credentialId?: string, environment?: string, expectedRevision?: string) {
    if (!credentialId) throw Object.assign(new Error("Select a saved Dhan credential."), { code: "DHAN_CREDENTIAL_REQUIRED" });
    // Bypass both caches at startup so a replacement cannot reuse another process's stale L1 entry.
    const saved = await CredentialManager.getCredentials(userId, "dhan", credentialId, { useCache: false });
    const creds = saved.credentials?.client_json;
    if (!creds) throw Object.assign(new Error("The selected Dhan credential is unavailable."), { code: "DHAN_CREDENTIAL_UNAVAILABLE" });
    if (resolveDhanEnvironment(creds) !== environment) throw Object.assign(new Error("The selected environment does not match the saved Dhan credential."), { code: "DHAN_ENVIRONMENT_MISMATCH" });
    if (!/^\d+$/.test(String(creds.client_id ?? "")) || !(creds.api_key ?? creds.access_token)) throw Object.assign(new Error("Reconnect Dhan with a numeric Client ID and Access Token."), { code: "DHAN_CREDENTIAL_INVALID" });
    const revision = getDhanCredentialRevision(creds);
    if (expectedRevision && expectedRevision !== revision) throw Object.assign(new Error("The Dhan credential changed during startup. Start the listener again."), { code: "DHAN_CREDENTIAL_CHANGED" });
    if (source.endsWith("_trading")) getDhanOrderUpdateWsUrl(environment as "sandbox" | "live");
    else getDhanMarketWsUrl(environment as "sandbox" | "live");
    return { creds, revision, key: this.getStateKey(userId, source, credentialId, environment, revision) };
  }

  private async withinStartupBudget<T>(work: Promise<T>, deadlineAt?: number): Promise<T> {
    if (!deadlineAt) return work;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Stream startup timed out before the required feed became ready."), { code: "STREAM_STARTUP_TIMEOUT" })), Math.max(0, deadlineAt - Date.now()));
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private async reportStartupFailure(userId: string, owner: string, error: any): Promise<void> {
    const failure = error?.gatewayLifecycle?.status === "failed" ? error.gatewayLifecycle : undefined;
    const code = failure?.code ?? error?.code ?? "STREAM_STARTUP_FAILED";
    const message = failure?.message ?? (error?.code ? error.message : "Stream startup failed. Check the selected credential, environment and feed.");
    const event = { status: "failed", code, message: String(message).replace(/(?:wss?|https?):\/\/\S+/gi, "[endpoint redacted]").slice(0, 320), retryCount: failure?.retryCount, timestamp: new Date().toISOString() };
    await getRedisQueue().setex(`market:listener-startup-error:${owner}`, 3600, JSON.stringify(event));
    await getRedisQueue().publish("market:gateway-lifecycle", JSON.stringify({ userId }));
  }

  /**
   * Initialize handler: connect to Redis and start listening to control channels
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log("⚠️ [MarketControl] Already initialized");
      return;
    }

    try {
      // Redis connections are already established by factory
      console.log("✅ [MarketControl] Using shared Redis connections");

      // Subscribe to control channels including workflow registration and unregistration
      await this.redisSub.subscribe(
        REDIS_CHANNELS.controlSubscribe,
        REDIS_CHANNELS.controlUnsubscribe,
        REDIS_CHANNELS.controlRegister,
        REDIS_CHANNELS.controlUnregister,
      );
      console.log(
        "✅ [MarketControl] Subscribed to control channels (including workflow registration/unregistration)",
      );

      // Set up message handler
      this.setupControlListeners();

      // Restore active subscriptions from Redis
      await this.restoreFromRedis();

      this.initialized = true;
      console.log("✅ [MarketControl] Market Control Handler initialized");
    } catch (error) {
      console.error("❌ [MarketControl] Failed to initialize:", error);
      throw error;
    }
  }

  /**
   * Set up Redis message listeners for control channels
   */
  private setupControlListeners(): void {
    this.redisSub.on("message", async (channel, message) => {
      let cleanupId: string | undefined;
      try {
        const msg = JSON.parse(message);
        const incomingCleanup = msg.manualCleanup?.id;
        if (typeof incomingCleanup === "string") {
          if (this.pendingManualCleanups.has(incomingCleanup)) return;
          this.pendingManualCleanups.add(incomingCleanup);
          cleanupId = incomingCleanup;
        }
        console.log(`📨 [MarketControl] Received message on ${channel}:`, {
          action: msg.action,
          source: msg.source,
          subscriptionMode: msg.subscriptionMode,
          isTestListener: msg.isTestListener,
          workflowId: msg.workflowId,
          nodeId: msg.nodeId,
          userId: msg.userId,
        });

        const dispatch = async () => {
          if (channel === REDIS_CHANNELS.controlSubscribe) {
            await this.handleSubscribe(msg as ControlMessage);
          } else if (channel === REDIS_CHANNELS.controlUnsubscribe) {
            await this.handleUnsubscribe(msg as ControlMessage);
          } else if (channel === REDIS_CHANNELS.controlRegister) {
            await this.handleRegister(msg);
          } else if (channel === REDIS_CHANNELS.controlUnregister) {
            await this.handleUnregister(msg);
          }
        };
        // Preserve arrival order across registration's DB lookup and the earlier
        // stream lookup in handleRegister. Different workflows remain independent.
        const workflowId = msg.workflowId;
        if (typeof workflowId !== "string" || !workflowId) {
          await dispatch();
        } else {
          const previous = this.workflowControlQueues.get(workflowId) ?? Promise.resolve();
          const next = previous.then(dispatch);
          const settled = next.catch(() => {});
          this.workflowControlQueues.set(workflowId, settled);
          try {
            await next;
          } finally {
            if (this.workflowControlQueues.get(workflowId) === settled) {
              this.workflowControlQueues.delete(workflowId);
            }
          }
        }
      } catch (error) {
        console.error(
          `❌ [MarketControl] Error processing message on ${channel}:`,
          error,
        );
      } finally {
        if (cleanupId) this.pendingManualCleanups.delete(cleanupId);
      }
    });

    this.redisSub.on("error", (error) => {
      console.error("❌ [MarketControl] Redis subscription error:", error);
    });
  }

  /**
   * Handle registration of streaming workflows (from workflow activation)
   *
   * Subscription mode controls which symbols the workflow receives:
   * - 'workflow' (default): ONLY symbols specifically scoped to this workflow
   * - 'global': ALL symbols subscribed globally by the user + workflow-specific symbols
   */
  private async handleRegister(msg: {
    manualListener?: { workflowId: string; nodeId: string; attemptId: string };
    lookupWorkflowId?: string;
    action: string;
    userId: string;
    workflowId: string;
    nodeId: string;
    source: string;
    scope: string;
    environment: string;
    onlyClosedBars?: boolean;
    interval?: string;
    isLive?: boolean;
    // symbols?: string[];
    // streamTypes?: string[];
    // filterSymbols?: string[];
    // symbolMatchMode?: "exact" | "wildcard";
    //tradingNativeStreams?: string[];
  }): Promise<void> {
    const {
      userId,
      workflowId,
      nodeId,
      source,
      scope,
      environment,
      onlyClosedBars,
      interval,
      isLive,
      // symbols,
      // streamTypes,
      // filterSymbols = [],
      //symbolMatchMode = "exact",
      //tradingNativeStreams = [],
    } = msg;
    const releaseManual = msg.manualListener ? await this.getManualRoutingMutex(workflowId).acquire() : undefined;
    try {
      console.log(
        `📡 [MarketControl] Registering streaming workflow ${workflowId} for user ${userId} (source: ${
          source || "all"
        }, mode: ${scope}, onlyClosedBars: ${onlyClosedBars ?? true}, isLive: ${isLive ?? false}
        )})`,
      );

      let manualListener: ManualListenerRegistration | undefined;
      if (msg.manualListener) {
        const manual = msg.manualListener;
        const raw = await getRedisCache().get(REDIS_CHANNELS.Listener(userId, manual.workflowId, manual.nodeId));
        if (!raw || JSON.parse(raw).attemptId !== manual.attemptId || await getRedisQueue().exists(`market:listener-stopped:${userId}:${workflowId}`)) return;
        manualListener = JSON.parse(raw);
      }
      const subscriber = MarketDataSubscriber.getInstance();
      // NORMAL WORKFLOW MODE: Get symbols from Redis subscriptions
      const streamToRegister = manualListener ? await this.readManualRouting(manualListener) :
        scope === "global"
          ? await this.getUserSubscribedStreams(userId, source, environment)
          : await this.getWorkflowScopedStreams(
              userId,
              msg.lookupWorkflowId ?? workflowId,
              source,
              environment,
            );

      if (!streamToRegister) return;
      if (manualListener?.source.startsWith("dhan")) {
        for (const dep of manualListener.dependencies ?? []) {
          const resolved = await this.withinStartupBudget(this.resolveDhanConnection(userId, dep.source, manualListener.credentialId, environment, manualListener.credentialRevision), manualListener.startupDeadlineAt);
          const state = this.sourceStates.get(resolved.key);
          if (!state) throw Object.assign(new Error("The required Dhan feed has no active gateway. Subscribe before using Listen."), { code: "DHAN_FEED_UNAVAILABLE" });
          await state.gateway.waitForStartup(manualListener.startupDeadlineAt ?? Date.now() + 120000);
        }
      }
      if (streamToRegister.length === 0) {
        console.log(
          `ℹ️ [MarketControl] No active subscriptions for user ${userId}, workflow ${workflowId} will receive data when symbols are subscribed`,
        );
      }

      if (manualListener) {
        const raw = await getRedisCache().get(REDIS_CHANNELS.Listener(userId, manualListener.workflowId, manualListener.nodeId));
        if (!raw || JSON.parse(raw).attemptId !== manualListener.attemptId) return;
        if (manualListener.startupDeadlineAt && Date.now() >= manualListener.startupDeadlineAt) throw Object.assign(new Error("Stream startup timed out before routing registration."), { code: "STREAM_STARTUP_TIMEOUT" });
      }
      // Still register the workflow with empty symbols - it will receive data when symbols are subscribed later
      await subscriber.registerWorkflow(
        workflowId,
        nodeId,
        userId,
        streamToRegister,
        source as MarketSource,
        environment,
        onlyClosedBars,
        isLive,
        [],
        "exact",
        [],
        interval, false, manualListener?.credentialRevision ? manualListener.gatewayIdentities : undefined,
      );

      if (manualListener) {
        const raw = await getRedisCache().get(REDIS_CHANNELS.Listener(userId, manualListener.workflowId, manualListener.nodeId));
        if (!raw || JSON.parse(raw).attemptId !== manualListener.attemptId) {
          await subscriber.unregisterWorkflow(userId, workflowId);
          return;
        }
        if (manualListener.startupDeadlineAt && Date.now() >= manualListener.startupDeadlineAt) {
          await subscriber.unregisterWorkflow(userId, workflowId);
          throw Object.assign(new Error("Stream startup timed out during routing registration."), { code: "STREAM_STARTUP_TIMEOUT" });
        }
      }
      if (msg.manualListener) {
        for (const required of [source, ...this.getCompanionSources(source)]) {
          const state = Array.from(this.sourceStates.values()).find(state => state.connectedUserId === userId &&
            state.source === getUnifiedSocketStateSource(required) && state.environment === environment &&
            (!manualListener?.credentialRevision || state.credentialRevision === manualListener.credentialRevision));
          if (!state || state.environment !== environment) continue;
          await getRedisQueue().set(`market:gateway-binding:${userId}:${required}:${environment}${state.credentialRevision ? `:${state.credentialId}:${state.credentialRevision}` : ""}`,
            JSON.stringify({ source: state.source, credentialId: state.credentialId, credentialRevision: state.credentialRevision, environment }));
          const lifecycle = state.gateway.getLifecycle();
          if (lifecycle) state.gateway.onLifecycle?.(lifecycle);
        }
        const raw = manualListener ? await getRedisCache().get(REDIS_CHANNELS.Listener(userId, manualListener.workflowId, manualListener.nodeId)) : null;
        if (!raw || JSON.parse(raw).attemptId !== manualListener?.attemptId) {
          await subscriber.unregisterWorkflow(userId, workflowId);
          return;
        }
        if (manualListener?.startupDeadlineAt && Date.now() >= manualListener.startupDeadlineAt) {
          await subscriber.unregisterWorkflow(userId, workflowId);
          throw Object.assign(new Error("Stream startup timed out before readiness publication."), { code: "STREAM_STARTUP_TIMEOUT" });
        }
        await getRedisQueue().set(`market:listener-ready:${workflowId}`, "1");
        await getRedisQueue().publish("market:gateway-lifecycle", JSON.stringify({ userId }));
      }
      console.log(
        `✅ [MarketControl] Registered streaming workflow ${workflowId} to receive data for ${
          streamToRegister.length
        } stream: ${streamToRegister.join(", ")}`,
      );
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to register streaming workflow ${workflowId}:`,
        error,
      );
      if (msg.manualListener) await this.reportStartupFailure(userId, workflowId, error);
    } finally { if (releaseManual) this.releaseManualRouting(workflowId, releaseManual); }
  }

  /**
   * Handle unregistration of streaming workflows (from workflow deactivation or test listener cleanup)
   */
  private async handleUnregister(msg: {
    action: string;
    userId: string;
    workflowId: string;
    manualCleanup?: { id: string; listener: ManualListenerRegistration };
  }): Promise<void> {
    const { userId, workflowId } = msg;
    const releaseManual = msg.manualCleanup ? await this.getManualRoutingMutex(workflowId).acquire() : undefined;
    try {
      console.log(
        `📡 [MarketControl] Unregistering streaming workflow ${workflowId} for user ${userId} (isTestListener: 
        )`,
      );

      if (msg.manualCleanup) {
        const { listener } = msg.manualCleanup;
        if (listener.userId !== userId || listener.routingWorkflowId !== workflowId || !workflowId.startsWith("manual-stream-")) {
          throw new Error("Invalid manual listener cleanup owner");
        }
        await this.releaseManualSubscriptions(listener);
      }
      const subscriber = MarketDataSubscriber.getInstance();
      await subscriber.unregisterWorkflow(userId, workflowId);
      if (msg.manualCleanup) {
        await getRedisQueue().del(`market:listener-ready:${workflowId}`);
        await getRedisQueue().setex(`market:listener-cleanup-done:${msg.manualCleanup.id}`, 3600, "1");
      }

      console.log(
        `✅ [MarketControl] Unregistered streaming workflow ${workflowId}`,
      );
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to unregister streaming workflow ${workflowId}:`,
        error,
      );
    } finally { if (releaseManual) this.releaseManualRouting(workflowId, releaseManual); }
  }

  private async releaseManualSubscriptions(listener: ManualListenerRegistration): Promise<void> {
    if (listener.mode !== "subscribe") return;
    for (const previous of Array.from(this.sourceStates.values())) {
      if (previous.connectedUserId !== listener.userId) continue;
      if (!previous.workflowStreams.has(listener.routingWorkflowId) && previous.streams.size > 0) continue;
      await this.getGatewayMutex(listener.userId, previous.source, previous.key).runExclusive(async () => {
        const state = this.sourceStates.get(previous.key);
        if (!state) return;
        const owned = Array.from(state.workflowStreams.get(listener.routingWorkflowId) ?? []);
        const unowned = owned.filter(stream => !Array.from(state.workflowStreams.entries())
          .some(([owner, streams]) => owner !== listener.routingWorkflowId && streams.has(stream)));
        // Remove this attempt's routing claims even while another owner keeps the socket stream.
        for (const source of new Set([listener.source, ...this.getCompanionSources(listener.source)])) {
          if (this.getStateKey(listener.userId, source) !== this.getStateKey(listener.userId, state.source)) continue;
          const key = listener.scope === "global"
            ? REDIS_CHANNELS.globalSubscriptionStreams(listener.userId, source, listener.environment ?? "")
            : REDIS_CHANNELS.workflowSubscriptionStreams(listener.userId, listener.routingWorkflowId, source, listener.environment ?? "");
          const remove = listener.scope === "global" ? unowned.filter(stream => !Array.from(this.sourceStates.values()).some(other =>
            other !== state && other.connectedUserId === listener.userId && other.environment === listener.environment &&
            other.source === state.source && Array.from(other.workflowStreams.values()).some(streams => streams.has(stream)))) : owned;
          if (remove.length) await this.redisPub.srem(key, ...remove);
        }
        if (unowned.length) state.gateway.unsubscribeStreams(unowned);
        state.workflowStreams.delete(listener.routingWorkflowId);
        unowned.forEach(stream => state.streams.delete(stream));
        try { await this.persistState(listener.userId, state.source, true, state); }
        catch (error) {
          if (owned.length) state.workflowStreams.set(listener.routingWorkflowId, new Set(owned));
          unowned.forEach(stream => state.streams.add(stream));
          if (unowned.length) state.gateway.subscribeStreams(unowned);
          throw error;
        }
        if (state.streams.size === 0) {
          state.gateway.disconnect();
          await this.redisPub.del(this.persistedStateKey(state));
          this.sourceStates.delete(state.key);
        }
      });
    }
  }

  /**
   * Read the exact feed sets used by manual routing. Dependency tracking and
   * subscription discovery share this read so companion feeds cannot diverge.
   */
  private async readManualRouting(listener: ManualListenerRegistration): Promise<string[] | undefined> {
    const streams = new Set<string>();
    const dependencies: NonNullable<ManualListenerRegistration["dependencies"]> = [];
    const gatewayIdentities = new Set<string>();
    const lookup = listener.mode === "listen" ? listener.workflowId : listener.routingWorkflowId;
    for (const source of new Set([listener.source, ...this.getCompanionSources(listener.source)])) {
      const key = listener.scope === "global"
        ? REDIS_CHANNELS.globalSubscriptionStreams(listener.userId, source, listener.environment ?? "")
        : REDIS_CHANNELS.workflowSubscriptionStreams(listener.userId, lookup, source, listener.environment ?? "");
      const feedStreams = await this.redisPub.smembers(key);
      if (!feedStreams.length) {
        if (listener.source.startsWith("dhan") && listener.mode === "listen" && listener.requiredSources?.includes(source)) {
          throw Object.assign(new Error(`The requested ${source.endsWith("_trading") ? "Dhan order-update" : "Dhan market"} feed has no existing subscription. Subscribe before using Listen.`), { code: "DHAN_FEED_NOT_SUBSCRIBED" });
        }
        continue;
      }
      const connection = listener.credentialRevision ? this.sourceStates.get(this.getStateKey(listener.userId, source,
        listener.credentialId, listener.environment, listener.credentialRevision)) : undefined;
      const routedStreams = listener.credentialRevision ? feedStreams.filter(stream => connection?.streams.has(stream)) : feedStreams;
      if (!routedStreams.length && listener.source.startsWith("dhan")) {
        if (Array.isArray(listener.requiredSources) && listener.requiredSources.includes(source)) {
          throw Object.assign(new Error("The requested Dhan subscription has no matching gateway for this credential revision and environment."), { code: "DHAN_FEED_UNAVAILABLE" });
        }
        continue;
      }
      routedStreams.forEach(stream => streams.add(stream));
      if (connection) gatewayIdentities.add(connection.key);
      dependencies.push({ source, environment: listener.environment ?? "", credentialId: listener.credentialId ?? "default", credentialRevision: listener.credentialRevision });
    }
    const key = REDIS_CHANNELS.Listener(listener.userId, listener.workflowId, listener.nodeId);
    const active = await getRedisCache().eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local listener = cjson.decode(raw)
      if listener.attemptId ~= ARGV[1] or listener.status == 'failed' or listener.status == 'stopped' then return 0 end
      listener.dependencies = cjson.decode(ARGV[2])
      redis.call('SET', KEYS[1], cjson.encode(listener))
      return 1
    `, 1, key, listener.attemptId, JSON.stringify(dependencies));
    if (active) { listener.dependencies = dependencies; listener.gatewayIdentities = Array.from(gatewayIdentities); }
    return active ? Array.from(streams) : undefined;
  }

  private async refreshManualListeners(userId: string, scope: string, targetWorkflowId?: string): Promise<void> {
    const cache = getRedisCache();
    const subscriber = MarketDataSubscriber.getInstance();
    for (const key of await cache.smembers(REDIS_CHANNELS.userActiveListeners(userId))) {
      const raw = await cache.get(key);
      if (!raw) continue;
      const candidate: ManualListenerRegistration = JSON.parse(raw);
      if (!candidate.attemptId || !candidate.routingWorkflowId) continue;
      const mutex = this.getManualRoutingMutex(candidate.routingWorkflowId);
      try { await mutex.runExclusive(async () => {
        const current = await cache.get(key);
        if (!current) return;
        const listener: ManualListenerRegistration = JSON.parse(current);
        if (listener.attemptId !== candidate.attemptId) return;
        const lookup = listener.mode === "listen" ? listener.workflowId : listener.routingWorkflowId;
        if (scope === "workflow" ? listener.scope !== "workflow" || lookup !== targetWorkflowId : listener.scope !== "global") return;
        const streams = await this.readManualRouting(listener);
        if (streams && subscriber.getRegisteredWorkflowIdsForUser(userId).includes(listener.routingWorkflowId)) {
          await subscriber.addStreamsToRegistration(listener.routingWorkflowId, streams, [], listener.credentialRevision ? listener.gatewayIdentities : undefined);
        }
      }); } finally {
        if (!mutex.isLocked() && this.manualRoutingMutexes.get(candidate.routingWorkflowId) === mutex) this.manualRoutingMutexes.delete(candidate.routingWorkflowId);
      }
    }
    await getRedisQueue().publish("market:gateway-lifecycle", JSON.stringify({ userId }));
  }

  /**
   * Get companion sources for a market source.
   * Account-wide streams (trading/news) are discovered alongside market subscriptions.
   */
  private getCompanionSources(source: string): string[] {
    return getCompanionSourcesFromConfig(source);
  }

  /**
   * Get symbols specifically scoped to a workflow
   */
  private async getWorkflowScopedStreams(
    userId: string,
    workflowId: string,
    source?: string,
    environment?: string,
  ): Promise<string[]> {
    const allStreams = new Set<string>();

    try {
      // If source specified, only check that source
      if (source) {
        const key = REDIS_CHANNELS.workflowSubscriptionStreams(
          userId,
          workflowId,
          source,
          String(environment || ""),
        );
        console.log(
          `🔍 [MarketControl] Checking workflow-scoped symbols at key: ${key}`,
        );
        const streams = await this.redisPub.smembers(key);
        console.log(
          `🔍 [MarketControl] Found ${streams.length} workflow-scoped symbols:`,
          streams,
        );
        streams.forEach((s) => allStreams.add(s));

        // Also check companion sources (e.g., trading/news alongside market)
        const companionSources = this.getCompanionSources(source);
        for (const companionSource of companionSources) {
          const companionKey = REDIS_CHANNELS.workflowSubscriptionStreams(
            userId,
            workflowId,
            companionSource,
            String(environment || ""),
          );
          console.log(
            `🔍 [MarketControl] Checking companion streams at key: ${companionKey}`,
          );
          const companionStreams = await this.redisPub.smembers(companionKey);
          if (companionStreams.length > 0) {
            console.log(
              `🔍 [MarketControl] Found ${companionStreams.length} companion streams:`,
              companionStreams,
            );
            companionStreams.forEach((s) => allStreams.add(s));
          }
        }
      }
    } catch (err) {
      console.error(
        `❌ [MarketControl] Failed to get workflow-scoped symbols for ${workflowId}:`,
        err,
      );
    }

    return Array.from(allStreams);
  }

  /**
   * Get all GLOBAL symbols currently subscribed for a user across all sources
   * Uses pattern matching to find ALL subscription keys (handles _stream suffix variants)
   */
  private async getUserSubscribedStreams(
    userId: string,
    source: string,
    environment: string,
  ): Promise<string[]> {
    const allStream = new Set<string>();

    try {
      // Use pattern matching to find ALL subscription keys for this user
      const streamKey = REDIS_CHANNELS.globalSubscriptionStreams(
        userId,
        source,
        environment,
      );
      const streams = await this.redisPub.smembers(streamKey);
      streams.forEach((s) => allStream.add(s));

      // Also check companion sources (e.g., trading/news alongside market/crypto)
      const companionSources = this.getCompanionSources(source);
      for (const companionSource of companionSources) {
        const companionKey = REDIS_CHANNELS.globalSubscriptionStreams(
          userId,
          companionSource,
          environment,
        );
        const companionStreams = await this.redisPub.smembers(companionKey);
        if (companionStreams.length > 0) {
          console.log(
            `🔍 [MarketControl] Found ${companionStreams.length} companion streams (global):`,
            companionStreams,
          );
          companionStreams.forEach((s) => allStream.add(s));
        }
      }
    } catch (err) {
      console.error(
        `❌ [MarketControl] Failed to get user subscribed symbols:`,
        err,
      );
    }

    return Array.from(allStream);
  }

  /**
   * Update active streaming workflows for a user with newly subscribed streams
   * This ensures workflows activated BEFORE streams were subscribed still receive data
   *
   * IMPORTANT: Respects subscription scope:
   * - 'workflow' scope: ONLY updates the target workflow
   * - 'global' scope: Updates ALL active streaming workflows for the user
   */
  private async updateActiveStreamingWorkflows(
    userId: string,
    newStreamNames: string[],
    newSymbolsOrScope: string[] | string,
    scopeOrTargetWorkflowId?: string,
    targetWorkflowIdOrTradingStreams?: string | string[],
    maybeTradingNativeStreams: string[] = [],
  ): Promise<void> {
    const legacySignature = Array.isArray(newSymbolsOrScope);
    const newSymbols = legacySignature ? newSymbolsOrScope : [];
    const scope = legacySignature
      ? String(scopeOrTargetWorkflowId || "global")
      : newSymbolsOrScope;
    const targetWorkflowId = legacySignature
      ? typeof targetWorkflowIdOrTradingStreams === "string"
        ? targetWorkflowIdOrTradingStreams
        : undefined
      : scopeOrTargetWorkflowId;
    const tradingNativeStreams = legacySignature
      ? Array.isArray(targetWorkflowIdOrTradingStreams)
        ? targetWorkflowIdOrTradingStreams
        : maybeTradingNativeStreams
      : [];

    try {
      const subscriber = MarketDataSubscriber.getInstance();

      await this.refreshManualListeners(userId, scope, targetWorkflowId);
      // If workflow-scoped, only update the target workflow AND any test listeners for it
      if (scope === "workflow" && targetWorkflowId) {
        console.log(
          `📡 [MarketControl] Updating ONLY target workflow ${targetWorkflowId} with ${newStreamNames.length} workflow-scoped streams`,
        );
        await subscriber.addStreamsToRegistration(
          targetWorkflowId,
          newStreamNames,
          tradingNativeStreams,
        );
        if (newSymbols.length > 0) {
          await subscriber.addAllowedSymbolsToRegistration(
            targetWorkflowId,
            newSymbols,
          );
        }

        const fallbackWorkflowIds =
          subscriber.getRegisteredWorkflowIdsForUser(userId);
        if (!fallbackWorkflowIds.includes(targetWorkflowId)) {
          console.warn(
            `⚠️ [MarketControl] Target workflow ${targetWorkflowId} not found in memory; skipping workflow-scoped update for user ${userId}`,
          );
        }

        console.log(
          `✅ [MarketControl] Added ${newStreamNames.length} streams to target workflow ${targetWorkflowId} only`,
        );
        return;
      }

      // Global scope: update all active workflows for this user
      const activeStreamingWorkflowsKey =
        REDIS_CHANNELS.activeStreamingWorkflows(userId);
      const activeStreamingWorkflows = new Set(
        await this.redisPub.smembers(activeStreamingWorkflowsKey),
      );

      // Fallback: include in-memory registrations so subscribe can patch workflows
      // even if scope/targetWorkflowId metadata was missing in control message.
      const inMemoryactiveStreamingWorkflows =
        subscriber.getRegisteredWorkflowIdsForUser(userId);
      inMemoryactiveStreamingWorkflows.forEach((workflowId) =>
        activeStreamingWorkflows.add(workflowId),
      );

      if (activeStreamingWorkflows.size === 0) {
        console.log(
          `ℹ️ [MarketControl] No active streaming workflows for user ${userId} (Redis SET and in-memory fallback empty)`,
        );
        return;
      }

      console.log(
        `📡 [MarketControl] Updating ${activeStreamingWorkflows.size} active streaming workflows with new GLOBAL streams:`,
        newStreamNames,
      );

      for (const activeStreamingWorkflow of activeStreamingWorkflows) {
        // Manual routing is refreshed from its own source/scope keys above.
        if (activeStreamingWorkflow.startsWith("manual-stream-")) continue;
        try {
          // Apply stream filter if specified
          const streamsToAdd = newStreamNames;

          // Add new streams to existing registration
          await subscriber.addStreamsToRegistration(
            activeStreamingWorkflow,
            streamsToAdd,
            tradingNativeStreams,
          );
          if (newSymbols.length > 0) {
            await subscriber.addAllowedSymbolsToRegistration(
              activeStreamingWorkflow,
              newSymbols,
            );
          }

          console.log(
            `✅ [MarketControl] Added ${streamsToAdd.length} streams to workflow ${activeStreamingWorkflow}`,
          );
        } catch (err) {
          console.error(
            `❌ [MarketControl] Failed to update workflow ${activeStreamingWorkflow}:`,
            err,
          );
        }
      }

      // Also update test listeners for global scope
      // Use user-specific SET for O(1) lookup instead of pattern scanning
      // Key pattern: user:${userId}:stream:active_listeners
      const activeUserStreamListenersKey = `user:${userId}:stream:active_listeners`;
      try {
        const activeUserStreamListenerKeys = await this.redisPub.smembers(
          activeUserStreamListenersKey,
        );

        if (activeUserStreamListenerKeys.length > 0) {
          console.log(
            `🔍 [MarketControl] Found ${activeUserStreamListenerKeys.length} test listener(s) for user ${userId} to update with global streams`,
          );

          for (const activeUserStreamListenerKey of activeUserStreamListenerKeys) {
            try {
              const listenerJson = await this.redisPub.get(
                activeUserStreamListenerKey,
              );
              if (!listenerJson) {
                // Listener expired, clean up stale SET entry
                await this.redisPub.srem(
                  activeUserStreamListenersKey,
                  activeUserStreamListenerKey,
                );
                continue;
              }

              const listenerData = JSON.parse(listenerJson);

              // Apply filter_symbols if specified
              let streamsToAdd = newStreamNames;
              if (
                listenerData.filterSymbols &&
                listenerData.filterSymbols.length > 0
              ) {
                const allowedStreams = listenerData.filterSymbols.map(
                  (s: string) => s,
                );
                streamsToAdd = newStreamNames.filter((s) =>
                  allowedStreams.includes(s),
                );

                if (streamsToAdd.length === 0) {
                  console.log(
                    `ℹ️ [MarketControl] Test listener ${activeUserStreamListenerKey} filters exclude new symbols, skipping`,
                  );
                  continue;
                }
              }

              await subscriber.addStreamsToRegistration(
                activeUserStreamListenerKey,
                streamsToAdd,
                // tradingNativeStreams,
              );
              // await subscriber.addAllowedSymbolsToRegistration(
              //   activeUserStreamListenerKey,
              //   newSymbols,
              // );
              console.log(
                `🧪 [MarketControl] Updated test listener ${activeUserStreamListenerKey} with ${streamsToAdd.length} global streams`,
              );
            } catch (err) {
              console.warn(
                `⚠️ [MarketControl] Failed to update test listener ${activeUserStreamListenerKey}:`,
                err,
              );
            }
          }
        }
      } catch (err) {
        console.warn(
          `⚠️ [MarketControl] Failed to get user test listeners for global update:`,
          err,
        );
      }
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to update active streaming workflows:`,
        error,
      );
    }
  }

  /**
   * Handle subscribe control message (with mutex protection)
   *
   * IMPORTANT: Subscribe nodes ONLY manage gateway subscriptions.
   * They do NOT register for data delivery - that's handled by StreamData trigger nodes.
   * Data routing is managed by md:control:register_workflow channel.
   */
  private async handleSubscribe(msg: ControlMessage): Promise<void> {
    const {
      source,
      userId,
      workflowId,
      symbols,
      streamType,
      exchange,
      feed,
      environment,
      assetType,
      marketType,
      interval,
      depthLevels,
      contractType,
      scope,
      targetWorkflowId,
      // tradingNativeStreams = [],
    } = msg;

    try {
      if (!environment) {
        throw new Error(
          `[MarketControl] Missing required environment for subscribe (${source})`,
        );
      }
      const deadlineAt = msg.startupDeadlineAt ?? (source.startsWith("dhan") ? Date.now() + 120000 : undefined);
      const resolved = source.startsWith("dhan") ? await this.withinStartupBudget(this.resolveDhanConnection(userId, source, msg.credentialId, environment, msg.credentialRevision), deadlineAt) : undefined;
      if (deadlineAt && Date.now() >= deadlineAt) throw Object.assign(new Error("Stream startup timed out before connection setup."), { code: "STREAM_STARTUP_TIMEOUT" });
      const connectionKey = resolved?.key ?? this.getStateKey(userId, source);
      let routingStreams: string[] = [];
      // Serialize only the gateway being connected, not unrelated users or feeds.
      await this.getGatewayMutex(userId, source, connectionKey).runExclusive(async () => {
        if (workflowId?.startsWith("manual-stream-") && await getRedisQueue().exists(`market:listener-stopped:${userId}:${workflowId}`)) return;
        const stateKey = connectionKey;
        let state = this.sourceStates.get(stateKey);

        if (state && (state.credentialId !== (msg.credentialId || "default") || state.environment !== environment)) {
          throw new Error("This feed already has an active connection with different credentials or environment");
        }
        // Connect gateway if needed
        if (state && !state.gateway.getStats().connected && state.gateway.getLifecycle()?.status !== "failed" && state.gateway.getLifecycle()?.status !== "stopped") {
          await this.withinStartupBudget(state.gateway.waitUntilReady(), deadlineAt);
        }
        if (!state || !state.gateway.getStats().connected) {
          console.log(`🔌 [MarketControl] Connecting to ${source} gateway...`);
          await this.connectGateway(
            source,
            userId,
            msg.credentialId,
            feed,
            marketType,
            environment, deadlineAt, resolved,
          );
          state = this.sourceStates.get(stateKey)!;
          console.log(`✅ [MarketControl] Connected to ${source} gateway`);
        }

        if (workflowId?.startsWith("manual-stream-") && await getRedisQueue().exists(`market:listener-stopped:${userId}:${workflowId}`)) {
          if (state.streams.size === 0) {
            state.gateway.disconnect();
            this.sourceStates.delete(stateKey);
          }
          return;
        }
        // // Build stream names FIRST (before any tracking)
        // const processedStreamType = this.processStreamTypesForStreamNames(
        //   streamType || [],
        //   source,
        //   interval,
        //   depthLevels,
        //   contractType,
        // );

        const tradingSource = isTradingSource(source);

        const requestedStreamNames = tradingSource
          ? (streamType ?? []).map((eventType) =>
              tradingRoutingKey(source, eventType),
            )
          : buildNativeStreamNames(
              source,
              symbols,
              streamType,
              interval,
              contractType,
              exchange,
            );

        // Check which stream names are NEW (not already in state.streams)
        const newStreamNames = requestedStreamNames.filter(
          (name) => !state.streams.has(name),
        );

        if (requestedStreamNames.length > 0) {
          console.log(
            `➕ [MarketControl] Ensuring subscriptions on ${source}:`,
            requestedStreamNames.slice(0, 5).join(", ") +
              (requestedStreamNames.length > 5 ? "..." : ""),
          );

          // Add to tracking
          newStreamNames.forEach((name) => state.streams.add(name));

          // Track workflow streams (for reference counting only, NOT for data routing)
          const currentStream =
            state.workflowStreams.get(workflowId) || new Set();
          requestedStreamNames.forEach((s) => currentStream.add(s));
          state.workflowStreams.set(workflowId, currentStream);
          // Subscribe gateway with stream names directly
          if (newStreamNames.length > 0) {
            state.gateway.subscribeStreams(newStreamNames);
          }

          if (source.startsWith("dhan")) await state.gateway.waitForStartup(deadlineAt ?? Date.now() + 120000);
          // Persist every requested stream for this scope, including streams
          // already subscribed by another workflow or an earlier listener.
          const routingStreamNames = requestedStreamNames;

          // Persist to Redis
          await this.persistState(userId, source, false, state);

          // Store routing stream names in Redis (:streams key)
          const streamsKey =
            scope === "workflow" && targetWorkflowId
              ? REDIS_CHANNELS.workflowSubscriptionStreams(
                  userId,
                  targetWorkflowId,
                  source,
                  environment,
                )
              : REDIS_CHANNELS.globalSubscriptionStreams(
                  userId,
                  source,
                  environment,
                );

          await this.redisPub.sadd(streamsKey, ...routingStreamNames);
          console.log(
            `💾 [MarketControl] Stored ${routingStreamNames.length} routing stream names in ${streamsKey}`,
          );

          // Persist broker resolution state (e.g. Dhan symbol->securityId map)
          // for one-time rehydration on process restart (never per tick).
          const subCfg = getBrokerStreamConfig(source);
          if (subCfg.persistSubscriptionState) {
            const snapshot = subCfg.persistSubscriptionState();
            if (snapshot && Object.keys(snapshot).length > 0) {
              await this.redisPub.hset(`md:resolution:${source}`, snapshot);
            }
          }

          // Extract symbols from new stream names for workflow notification
          // const newSymbols = [
          //   ...new Set(
          //     newStreamNames.map((name) => extractSymbol(source, name)),
          //   ),
          // ];

          routingStreams = routingStreamNames;

          console.log(
            `✅ [MarketControl] Recorded ${requestedStreamNames.length} subscription stream(s) on ${source}`,
          );
        }
      });
      if (routingStreams.length) await this.updateActiveStreamingWorkflows(userId, routingStreams, scope, targetWorkflowId);
      const activeState = this.sourceStates.get(connectionKey);
      if (activeState) await getRedisQueue().set(`market:gateway-binding:${userId}:${source}:${environment}${activeState.credentialRevision ? `:${activeState.credentialId}:${activeState.credentialRevision}` : ""}`,
        JSON.stringify({ source: activeState.source, credentialId: activeState.credentialId, credentialRevision: activeState.credentialRevision, environment }));
      const gateway = activeState?.gateway;
      if (gateway?.getLifecycle()) gateway.onLifecycle?.(gateway.getLifecycle()!);
      if (msg.requestId) {
        await this.redisPub.set(
          `md:subscription:result:${userId}:${msg.requestId}`,
          JSON.stringify({ success: true }),
          "EX", 120,
        );
      }
    } catch (error) {
      if (workflowId?.startsWith("manual-stream-")) {
        await this.reportStartupFailure(userId, workflowId, error);
        return;
      }
      const payload = { userId, credentialRevision: msg.credentialRevision, source: getUnifiedSocketStateSource(source), environment: environment || "", credentialId: msg.credentialId || "default",
        status: "failed", code: "GATEWAY_SETUP_FAILED", message: `Unable to initialize ${source.split("_")[0]} stream gateway.`, retryCount: 0, timestamp: new Date().toISOString() };
      const key = `market:gateway-lifecycle:${userId}:${payload.source}:${payload.environment}:${payload.credentialId}${payload.credentialRevision ? `:${payload.credentialRevision}` : ""}`;
      // Preserve the decoded terminal gateway reason when one was already reported.
      const existing = await getRedisQueue().get(key);
      if (!["failed", "stopped"].includes((error as any)?.gatewayLifecycle?.status) && (!existing || JSON.parse(existing).status !== "failed")) {
        await getRedisQueue().setex(key, 3600, JSON.stringify(payload));
        await getRedisQueue().publish("market:gateway-lifecycle", JSON.stringify(payload));
      }
      if (msg.requestId) {
        await this.redisPub.set(
          `md:subscription:result:${userId}:${msg.requestId}`,
          JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Subscription failed" }),
          "EX", 120,
        );
      }
      console.error(
        `❌ [MarketControl] Failed to handle subscribe for ${source}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle unsubscribe control message
   */
  private async handleUnsubscribe(msg: ControlMessage): Promise<void> {
    const {
      userId,
      source,
      workflowId,
      symbols,
      streamType,
      interval,
      exchange,
      assetType,
      marketType,
      depthLevels,
      contractType,
      environment,
      scope,
      targetWorkflowId,
    } = msg;

    try {
      if (!environment) {
        throw new Error(
          `[MarketControl] Missing required environment for unsubscribe (${source})`,
        );
      }
      const state = Array.from(this.sourceStates.values()).find(state => state.connectedUserId === userId &&
        state.source === getUnifiedSocketStateSource(source) && state.environment === environment && state.workflowStreams.has(workflowId));
      const stateKey = state?.key ?? this.getStateKey(userId, source);
      if (!state) {
        console.log(
          `⚠️ [MarketControl] No gateway state found for ${source} and user ${userId}`,
        );
        return;
      }

      const subscriber = MarketDataSubscriber.getInstance();
      // const tradingSource = isTradingSource(source);
      // const streamType = tradingSource
      //   ? computeTradingNativeStreams(source, marketType)
      //   : [];

      if (symbols.length > 0) {
        // Build stream names to remove
        // const processedStreamType = this.processStreamTypesForStreamNames(
        //   streamType || [],
        //   source,
        //   interval,
        //   depthLevels,
        //   contractType,
        // );

        const tradingSource = isTradingSource(source);

        let streamNamesToRemove = tradingSource
          ? (streamType ?? []).map((eventType) =>
              tradingRoutingKey(source, eventType),
            )
          : buildNativeStreamNames(
              source,
              symbols,
              streamType,
              interval,
              contractType,
              exchange,
            );

        if (streamNamesToRemove.length === 0) {
          streamNamesToRemove = Array.from(
            state.workflowStreams.get(workflowId) ?? new Set<string>(),
          );
        }

        console.log(
          `➖ [MarketControl] Unsubscribing from streams on ${source}:`,
          streamNamesToRemove.slice(0, 5).join(", ") +
            (streamNamesToRemove.length > 5 ? "..." : ""),
        );

        const workflowStreams =
          state.workflowStreams.get(workflowId) ?? new Set<string>();
        streamNamesToRemove.forEach((name) => workflowStreams.delete(name));
        if (workflowStreams.size === 0) {
          state.workflowStreams.delete(workflowId);
        } else {
          state.workflowStreams.set(workflowId, workflowStreams);
        }

        const unownedStreams = streamNamesToRemove.filter(stream =>
          !Array.from(state.workflowStreams.values()).some(streams => streams.has(stream)));
        const shouldRemoveGatewayStreams = unownedStreams.length > 0;

        if (shouldRemoveGatewayStreams) {
          unownedStreams.forEach((name) => state.streams.delete(name));
          state.gateway.unsubscribeStreams(unownedStreams);
        }

        if (
          streamNamesToRemove.length > 0 &&
          (scope === "workflow" || shouldRemoveGatewayStreams)
        ) {
          // Routing keys are identical to native stream names.
          const routingStreamNamesToRemove = scope === "workflow" ? streamNamesToRemove : unownedStreams;
          const streamsKey =
            scope === "workflow" && targetWorkflowId
              ? REDIS_CHANNELS.workflowSubscriptionStreams(
                  userId,
                  targetWorkflowId,
                  source,
                  environment,
                )
              : REDIS_CHANNELS.globalSubscriptionStreams(
                  userId,
                  source,
                  environment,
                );

          await this.redisPub.srem(streamsKey, ...routingStreamNamesToRemove);
          console.log(
            `🗑️ [MarketControl] Removed ${routingStreamNamesToRemove.length} routing stream names from ${streamsKey}`,
          );

          const remainingStreamsCount = await this.redisPub.scard(streamsKey);
          if (remainingStreamsCount === 0) {
            await this.redisPub.del(streamsKey);
            console.log(
              `🗑️ [MarketControl] Removed empty streams key ${streamsKey}`,
            );
          }

          if (workflowId) {
            // if (tradingSource) {
            //   await subscriber.removeAllowedSymbolsFromRegistration(
            //     workflowId,
            //     symbols,
            //   );
            //   if (shouldRemoveGatewayStreams) {
            //     await subscriber.removeStreamsFromRegistration(
            //       userId,
            //       workflowId,
            //       streamNamesToRemove,
            //     );
            //   }
            // } else {
            await subscriber.removeStreamsFromRegistration(
              userId,
              workflowId,
              routingStreamNamesToRemove,
            );
            // }
            console.log(
              `✅ [MarketControl] Updated workflow ${workflowId} registration for unsubscribe`,
            );
          }
        }

        await this.persistState(userId, source, false, state);
        console.log(
          `✅ [MarketControl] Unsubscribed from ${streamNamesToRemove.length} stream(s) on ${source}`,
        );
      }

      // If this unsubscribe was workflow-level without specific symbols,
      // treat as full workflow deregistration.
      // if (workflowId && symbols.length === 0 && !tradingSource) {
      if (workflowId && symbols.length === 0) {
        await subscriber.unregisterWorkflow(userId, workflowId);
        console.log(
          `✅ [MarketControl] Unregistered workflow ${workflowId} from MarketDataSubscriber`,
        );
      }

      // if (workflowId && !tradingSource) {
      if (workflowId && symbols.length === 0) {
        state.workflowStreams.delete(workflowId);
      }

      // Disconnect if no more streams
      if (state.streams.size === 0) {
        console.log(
          `🔌 [MarketControl] No streams left, disconnecting ${source} gateway`,
        );
        state.gateway.disconnect();
        this.sourceStates.delete(stateKey);
        await this.redisPub.del(this.persistedStateKey(state));
        console.log(`✅ [MarketControl] Disconnected ${source} gateway`);
      }
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to handle unsubscribe for ${source}:`,
        error,
      );
    }
  }

  /**
   * Connect to a gateway using credentials
   */
  private async connectGateway(
    source: MarketSource,
    userId: string,
    credentialId?: string,
    feed?: string,
    marketType?: string,
    environment?: string,
    deadlineAt?: number,
    resolvedDhan?: { creds: any; revision: string; key: string },
  ): Promise<void> {
    let attemptedGateway: MarketDataGateway | undefined;
    try {
      // Map source to credential service type and gateway source
      const baseSource = source.split("_")[0];

      const serviceType = baseSource;
      const gatewaySource = baseSource;

      let creds: any;

      // Use getCredentials (like brokers) when credentialId is provided
      if (resolvedDhan) { creds = resolvedDhan.creds; }
      else if (credentialId) {
        const { credentials } = await CredentialManager.getCredentials(
          userId,
          serviceType,
          credentialId,
        );

        if (!credentials?.client_json) {
          throw new Error(
            `No credentials found for ${serviceType}/${credentialId}`,
          );
        }

        console.log(
          `🔑 [MarketControl] Retrieved credentials for ${serviceType}/${credentialId}`,
        );
        creds = credentials.client_json;
      } else {
        // Fallback: get most recent credential (backward compatibility)
        const { credentials, error } =
          await CredentialManager.getDecryptedCredentials(userId, serviceType);

        if (error || !credentials) {
          throw new Error(`No credentials found for ${serviceType}: ${error}`);
        }

        console.log(
          `🔑 [MarketControl] Retrieved credentials for ${serviceType} (fallback)`,
        );
        creds = credentials;
      }

      // Add feed parameter to credentials if provided (for Alpaca)
      if (feed) {
        creds = { ...creds, feed };
        console.log(
          `📡 [MarketControl] Using ${feed.toUpperCase()} feed for ${source}`,
        );
      }

      // Dhan environment is verified before credential resolution; other brokers retain their routing behavior.
      // Add environment for broker WS routing (Binance + Alpaca)
      if (environment) {
        creds = {
          ...creds,
          environment,
        };
        console.log(
          `🌐 [MarketControl] Using ${environment} environment for ${source}`,
        );
      }
      if (marketType) {
        creds = { ...creds, marketType: marketType };
        console.log(
          `📊 [MarketControl] Using ${marketType} asset type for ${source}`,
        );
      }

      // Get or create gateway instance using mapped gateway source
      // Pass original source (e.g., 'alpaca_news') for behavior routing
      const gatewayInstanceSource = getUnifiedSocketStateSource(source);
      const gateway = MarketDataGateway.getInstance(
        gatewaySource,
        gatewayInstanceSource,
        resolvedDhan?.key ?? this.getStateKey(userId, source),
      );

      attemptedGateway = gateway;
      gateway.routingIdentity = resolvedDhan?.key ?? this.getStateKey(userId, source);
      const identity = { userId, source: gatewayInstanceSource, credentialId: credentialId || "default", credentialRevision: resolvedDhan?.revision, environment: environment || "" };
      let publication = Promise.resolve();
      gateway.onLifecycle = (event) => {
        publication = publication.then(async () => {
          const redis = getRedisQueue();
          const payload = { ...event, ...identity };
          const key = `market:gateway-lifecycle:${userId}:${gatewayInstanceSource}:${identity.environment}:${identity.credentialId}${identity.credentialRevision ? `:${identity.credentialRevision}` : ""}`;
          if (event.status === "failed" || event.status === "stopped") await redis.setex(key, 3600, JSON.stringify(payload));
          else await redis.set(key, JSON.stringify(payload));
          await redis.publish("market:gateway-lifecycle", JSON.stringify(payload));
        }).catch(error => console.error("Gateway lifecycle publication failed", error));
      };

      await getRedisQueue().set(`market:gateway-binding:${userId}:${source}:${identity.environment}${identity.credentialRevision ? `:${identity.credentialId}:${identity.credentialRevision}` : ""}`, JSON.stringify(identity));
      // Retain shared ownership when reopening a failed cycle of the same identity.
      const previous = this.sourceStates.get(resolvedDhan?.key ?? this.getStateKey(userId, source));
      // Track state with streams (single source of truth)
      this.sourceStates.set(resolvedDhan?.key ?? this.getStateKey(userId, source), {
        key: resolvedDhan?.key ?? this.getStateKey(userId, source),
        credentialRevision: resolvedDhan?.revision,
        source: gatewayInstanceSource as MarketSource,
        gateway,
        connectedUserId: userId,
        credentialId: credentialId || "default",
        environment,
        streams: previous?.streams ?? new Set(),
        workflowStreams: previous?.workflowStreams ?? new Map(),
      });

      // Keep the control operation pending across transient connection closes.
      await this.withinStartupBudget(gateway.connect(creds, {
        userId,
        credentialId: credentialId || "default",
        source: gatewayInstanceSource,
      }).catch(async error => {
        if (gateway.getLifecycle()?.status === "failed") throw error;
        await gateway.waitUntilReady();
      }), deadlineAt);


      console.log(
        `✅ [MarketControl] Gateway ${source} connected for user ${userId}`,
      );
    } catch (error) {
      console.error(
        `❌ [MarketControl] Failed to connect gateway ${source}:`,
        error,
      );
      const lifecycle = attemptedGateway?.getLifecycle();
      const state = Array.from(this.sourceStates.values()).find(state => state.gateway === attemptedGateway);
      if ((error as any)?.code === "STREAM_STARTUP_TIMEOUT" && state && !state.streams.size) {
        attemptedGateway?.disconnect();
        this.sourceStates.delete(state.key);
      }
      throw Object.assign(error instanceof Error ? error : new Error("Gateway connection failed"), { gatewayLifecycle: lifecycle });
    }
  }

  /**
   * Persist gateway state to Redis (with circuit breaker)
   */
  private persistedStateKey(state: SourceState): string {
    const source = state.credentialRevision ? `${state.source}~${state.environment}~${encodeURIComponent(state.credentialId)}~${state.credentialRevision}` : state.source;
    return REDIS_CHANNELS.gatewayState(state.connectedUserId, source);
  }

  private async persistState(
    userId: string,
    source: MarketSource,
    strict = false,
    selectedState?: SourceState,
  ): Promise<void> {
    const state = selectedState ?? this.sourceStates.get(this.getStateKey(userId, source));
    if (!state) return;

    const persistedSource = getUnifiedSocketStateSource(source);

    const stateData = {
      userId: state.connectedUserId,
      source: state.source, credentialRevision: state.credentialRevision,
      credentialId: state.credentialId,
      environment: state.environment,
      // Store native stream names directly
      streams: Array.from(state.streams),
      workflowStreams: Array.from(state.workflowStreams.entries()).map(
        ([wfId, stream]) => ({
          workflowId: wfId,
          streams: Array.from(stream),
        }),
      ),
      timestamp: new Date().toISOString(),
    };

    try {
      await redisSetBreaker.fire(
        this.persistedStateKey(state),
        JSON.stringify(stateData),
      );

      if (persistedSource !== source) {
        await this.redisPub.del(REDIS_CHANNELS.gatewayState(userId, source));
      }

      console.log(
        `💾 [MarketControl] Persisted state for ${source} as ${persistedSource}`,
      );
    } catch (error) {
      console.warn(
        `⚠️ [MarketControl] Failed to persist state for ${source}, continuing with in-memory state`,
      );
      if (strict) throw error;
      // Continue operation - state is still in memory
    }
  }

  /**
   * Restore active subscriptions from Redis on startup
   */
  private async restoreFromRedis(): Promise<void> {
    try {
      console.log("🔄 [MarketControl] Restoring gateway states from Redis...");

      const stateKeys = await this.redisPub.keys("gateway:userId:*:*:state");
      let restoredCount = 0;

      for (const stateKey of stateKeys) {
        const match = stateKey.match(/^gateway:userId:([^:]+):([^:]+):state$/);
        if (!match) {
          continue;
        }
        const [, userId, persistedSourceName] = match;
        const stateJson = await this.redisPub.get(stateKey);

        if (stateJson) {
          try {
            const stateData = JSON.parse(stateJson);
            const source = String(stateData.source ?? persistedSourceName);
            const resolved = source.startsWith("dhan") ? await this.resolveDhanConnection(userId, source, stateData.credentialId, stateData.environment, stateData.credentialRevision) : undefined;
            const persistedWorkflowStreams = stateData.workflowStreams || [];

            console.log(`📦 [MarketControl] Found saved state for ${source}:`, {
              userId: stateData.userId,
              streamCount: stateData.streams?.length || 0,
              workflowCount: persistedWorkflowStreams.length || 0,
            });

            const restoredStateKey = this.getStateKey(
              userId,
              source as MarketSource, stateData.credentialId, stateData.environment, resolved?.revision,
            );
            let state = this.sourceStates.get(restoredStateKey);

            // Rehydrate broker resolution state (e.g. Dhan symbol->securityId
            // map) before connecting. Gateway open can immediately resubscribe,
            // so native names without securityId must be resolvable first.
            const restoreCfg = getBrokerStreamConfig(source as MarketSource);
            if (restoreCfg.restoreSubscriptionState) {
              const snapshot = await this.redisPub.hgetall(
                `md:resolution:${source}`,
              );
              if (snapshot && Object.keys(snapshot).length > 0) {
                restoreCfg.restoreSubscriptionState(snapshot);
              }
            }

            if (!state || !state.gateway.getStats().connected) {
              // Reconnect gateway. unifiedSocket aliases (for example, schwab_trading)
              // deliberately collapse to the base gateway state key.
              await this.connectGateway(
                source as MarketSource,
                userId,
                stateData.credentialId,
                stateData.feed,
                stateData.marketType,
                stateData.environment, resolved ? Date.now() + 120000 : undefined, resolved,
              );
              state = this.sourceStates.get(restoredStateKey)!;
            }

            // Restore streams directly - no conversion needed!
            if (stateData.streams && Array.isArray(stateData.streams)) {
              stateData.streams.forEach((s: string) => state.streams.add(s));

              // Subscribe gateway with stored stream names
              state.gateway.subscribeStreams(stateData.streams);

              console.log(
                `🔄 [MarketControl] Restored ${stateData.streams.length} streams on ${source}`,
              );
            }

            // Restore workflow mappings
            if (Array.isArray(persistedWorkflowStreams)) {
              persistedWorkflowStreams.forEach((wf: any) => {
                const streams = new Set<string>();
                const persistedStreams = Array.isArray(wf.streams)
                  ? wf.streams
                  : [];

                persistedStreams.forEach((s: string) => streams.add(String(s)));

                state.workflowStreams.set(wf.workflowId, streams);
              });
            }

            restoredCount++;
            console.log(
              `✅ [MarketControl] Restored ${source} gateway with ${state.streams.size} streams`,
            );
          } catch (error) {
            console.error(
              `❌ [MarketControl] Failed to restore ${persistedSourceName}:`,
              error,
            );
          }
        }
      }

      console.log(
        `✅ [MarketControl] Restored ${restoredCount} gateway(s) from Redis`,
      );
    } catch (error) {
      console.error("❌ [MarketControl] Failed to restore from Redis:", error);
    }
  }

  /**
   * Get current statistics for all gateways
   */
  getStats() {
    const stats: Record<string, any> = {};

    for (const [stateKey, state] of this.sourceStates.entries()) {
      stats[stateKey] = {
        connected: state.gateway.getStats().connected,
        authenticated: state.gateway.getStats().authenticated,
        source: state.source,
        userId: state.connectedUserId,
        streamCount: state.streams.size,
        streams: Array.from(state.streams),
        workflowCount: state.workflowStreams.size,
        workflows: Array.from(state.workflowStreams.entries()).map(
          ([wfId, streams]) => ({
            workflowId: wfId,
            streamCount: streams.size,
          }),
        ),
      };
    }

    return {
      initialized: this.initialized,
      gatewayCount: this.sourceStates.size,
      gateways: stats,
    };
  }

  /**
   * Cleanup and disconnect all gateways
   */
  async cleanup(): Promise<void> {
    console.log("🧹 [MarketControl] Cleaning up...");

    for (const [, state] of this.sourceStates.entries()) {
      try {
        state.gateway.disconnect();
        console.log(`✅ [MarketControl] Disconnected ${state.source} gateway`);
      } catch (error) {
        console.error(
          `❌ [MarketControl] Error disconnecting ${state.source}:`,
          error,
        );
      }
    }

    this.sourceStates.clear();

    await this.redisSub.quit();
    await this.redisPub.quit();
    console.log("✅ [MarketControl] Cleanup complete");
  }
}

