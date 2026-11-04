/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * ============================================
 * REGISTRATION SERVICE
 * ============================================
 *
 * Centralized service for managing test listener registrations.
 * Handles rate limiting, creation, deletion, activity tracking, and cleanup.
 *
 * All Redis operations use keys from REDIS_CHANNELS for consistency.
 */

import { createRedisQueuePubSub, getRedisQueue } from "../config/redis";
import { SubscriptionService } from "./SubscriptionService";
import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS } from "../config/redisChannels";
import {
  MAX_LISTENERS_PER_USER,
  LISTENER_TTL_SECONDS,
  LUA_INCREMENT_LISTENER_COUNT,
  LUA_DECREMENT_LISTENER_COUNT,
} from "../config/streaming";
import logger from "../utils/logger";

// ============================================
// TYPES
// ============================================

export interface ListenerDependency { source: string; credentialId: string; environment: string; credentialRevision?: string; }
export interface ListenerParams {
  attemptId?: string;
  routingWorkflowId?: string;
  dependencies?: ListenerDependency[];
  credentialId?: string;
  credentialRevision?: string;
  startupDeadlineAt?: number;
  startupCompleted?: boolean;
  requiredSources?: string[];
  userId: string;
  workflowId: string;
  nodeId: string;
  source: string;
  mode: string;
  scope: string;
  environment?: string;
  symbols?: string[];
  streamTypes?: string[];
  exchange?: string;
  assetType?: string;
  marketType?: string;
  contractType?: "perpetual" | "current_quarter" | "next_quarter";
  interval?: string;
  depth_levels?: string;
}

export interface ListenerData {
  attemptId?: string;
  routingWorkflowId?: string;
  dependencies?: ListenerDependency[];
  lifecycle?: any;
  credentialId?: string;
  credentialRevision?: string;
  startupDeadlineAt?: number;
  startupCompleted?: boolean;
  requiredSources?: string[];
  exchange: any;
  userId: string;
  workflowId: string;
  nodeId: string;
  status: "connecting" | "listening" | "reconnecting" | "failed" | "stopped";
  startedAt: string;
  mode: string;
  scope: string;
  source: string;
  environment?: string;
  symbols?: string[];
  streamTypes?: string[];
  assetType?: string;
  marketType?: string;
  contractType?: "perpetual" | "current_quarter" | "next_quarter";
  interval?: string;
  depth_levels?: string;
}

export interface CleanupResult {
  cleaned: number;
  total: number;
}

// ============================================
// REGISTRATION SERVICE
// ============================================

export class RegistrationService {
  private static readonly startupDeadlinesKey = "market:listener-startup-deadlines";
  private static readonly pendingCleanupKey = "market:listener-pending-cleanup";
  private static cleanupCursor = "0";
  private static cleanupRunning = false;

  private static async deliverCleanup(id: string, raw: string): Promise<void> {
    const { listener, event } = JSON.parse(raw);
    const queue = getRedisQueue();
    // Notification delivery must never prevent releasing backend resources.
    let notified = false;
    try {
      await queue.publish(`ws:user:${listener.userId}`, JSON.stringify(event));
      notified = true;
    } catch (error) { logger.warn({ error, id }, "Listener notification will be retried"); }
    const doneKey = `market:listener-cleanup-done:${id}`;
    if (await queue.exists(doneKey)) {
      if (notified) await getRedisCache().hdel(this.pendingCleanupKey, id);
      return;
    }
    await queue.setex(`market:listener-stopped:${listener.userId}:${listener.routingWorkflowId}`, 3600, "1");
    await queue.del(`market:listener-ready:${listener.routingWorkflowId}`);
    await queue.publish(REDIS_CHANNELS.controlUnregister, JSON.stringify({
      action: "unregister_workflow", userId: listener.userId, workflowId: listener.routingWorkflowId,
      isTestListener: true, manualCleanup: { id, listener },
    }));
  }

  private static async retryPendingCleanup(): Promise<void> {
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;
    try {
      const cache = getRedisCache();
      for (const key of await cache.zrangebyscore(this.startupDeadlinesKey, "-inf", Date.now(), "LIMIT", 0, 25)) {
        const raw = await cache.get(key);
        if (raw) await this.reconcileListener(JSON.parse(raw));
        else await cache.zrem(this.startupDeadlinesKey, key);
      }
      const [cursor, entries] = await getRedisCache().hscan(this.pendingCleanupKey, this.cleanupCursor, "COUNT", 25);
      this.cleanupCursor = cursor;
      for (let i = 0; i < entries.length; i += 2) {
        try { await this.deliverCleanup(entries[i], entries[i + 1]); }
        catch (error) { logger.warn({ error, id: entries[i] }, "Listener cleanup will be retried"); }
      }
    } catch (error) { logger.error({ error }, "Pending listener cleanup scan failed"); }
    finally { this.cleanupRunning = false; }
  }

  private static lifecycleSubscription: ReturnType<typeof createRedisQueuePubSub> | undefined;

  static async initializeLifecycle(): Promise<void> {
    if (this.lifecycleSubscription) return;
    const connection = createRedisQueuePubSub();
    this.lifecycleSubscription = connection;
    connection.sub.on("message", (_channel, raw) => {
      void (async () => {
        const event = JSON.parse(raw);
        const listeners = await this.getActiveListeners(event.userId);
        await Promise.all(listeners.filter(listener => listener.attemptId).map(listener => this.reconcileListener(listener)));
      })().catch(error => logger.error({ error }, "Listener lifecycle reconciliation failed"));
    });
    await connection.sub.subscribe("market:gateway-lifecycle");
    const cleanupTimer = setInterval(() => { void this.retryPendingCleanup(); }, 5000);
    cleanupTimer.unref();
    void this.retryPendingCleanup();
  }

  static async reconcileListener(listener: ListenerData): Promise<any> {
    if (!listener.attemptId) return null;
    const redis = getRedisCache();
    if (listener.status === "failed" || listener.status === "stopped") {
      await this.stopListener(listener, listener.lifecycle);
      const saved = await redis.get(`${REDIS_CHANNELS.Listener(listener.userId, listener.workflowId, listener.nodeId)}:status:${listener.attemptId}`);
      return saved ? JSON.parse(saved) : listener.lifecycle;
    }
    if (listener.routingWorkflowId && await getRedisQueue().exists(`market:listener-stopped:${listener.userId}:${listener.routingWorkflowId}`)) {
      await this.stopListener(listener);
      const stopped = await redis.get(`${REDIS_CHANNELS.Listener(listener.userId, listener.workflowId, listener.nodeId)}:status:${listener.attemptId}`);
      return stopped ? JSON.parse(stopped) : null;
    }
    const statusKey = `${REDIS_CHANNELS.Listener(listener.userId, listener.workflowId, listener.nodeId)}:status:${listener.attemptId}`;
    const startupErrorRaw = await getRedisQueue().get(`market:listener-startup-error:${listener.routingWorkflowId}`);
    const startupError = startupErrorRaw ? JSON.parse(startupErrorRaw) : undefined;
    const snapshots = await Promise.all((Array.isArray(listener.dependencies) ? listener.dependencies : []).map(async dep => {
      const suffix = dep.credentialRevision ? `:${dep.credentialId}:${dep.credentialRevision}` : "";
      const bindingRaw = await getRedisQueue().get(`market:gateway-binding:${listener.userId}:${dep.source}:${dep.environment}${suffix}`);
      const binding = bindingRaw ? JSON.parse(bindingRaw) : dep;
      if (listener.mode === "listen" && dep.credentialId !== "default" && binding.credentialId !== dep.credentialId) {
        return { status: "failed", code: "GATEWAY_IDENTITY_MISMATCH", message: "The subscribed feed uses different credentials.", timestamp: new Date().toISOString() };
      }
      const credentialId = dep.credentialId === "default" ? binding.credentialId : dep.credentialId;
      const raw = await getRedisQueue().get(`market:gateway-lifecycle:${listener.userId}:${binding.source}:${dep.environment}:${credentialId}${dep.credentialRevision ? `:${dep.credentialRevision}` : ""}`);
      const snapshot = raw ? JSON.parse(raw) : { status: "connecting" };
      if (listener.mode === "subscribe" && ["failed", "stopped"].includes(snapshot.status) && snapshot.timestamp < listener.startedAt) return { status: "connecting" };
      return snapshot;
    }));
    const routingReady = await getRedisQueue().exists(`market:listener-ready:${listener.routingWorkflowId}`);
    const feedsReady = snapshots.length > 0 && snapshots.every(event => event.status === "listening");
    const deadlineExceeded = !listener.startupCompleted && !(routingReady && feedsReady) && listener.startupDeadlineAt && Date.now() >= listener.startupDeadlineAt;
    const failure = startupError ?? snapshots.find(event => event.status === "failed" || event.status === "stopped") ??
      (deadlineExceeded ? { code: "STREAM_STARTUP_TIMEOUT", message: "Stream startup timed out before all required feeds and routing became ready." } : undefined);
    const state = failure ? "failed" : routingReady && feedsReady ? "listening"
      : listener.startupCompleted && snapshots.some(event => event.status === "reconnecting") ? "reconnecting" : "connecting";
    const event = { type: "market_stream_lifecycle", userId: listener.userId, workflowId: listener.workflowId,
      nodeId: listener.nodeId, attemptId: listener.attemptId, routingWorkflowId: listener.routingWorkflowId,
      status: state, code: failure?.code ?? (failure ? "GATEWAY_STOPPED" : undefined),
      message: failure?.message ?? (failure ? "Stream gateway stopped" : undefined),
      retryCount: failure?.retryCount, timestamp: new Date().toISOString() };
    if (state === "failed") {
      // Queue cleanup and retire active state atomically, before any notification I/O.
      await this.stopListener(listener, event);
      const saved = await redis.get(statusKey);
      return saved ? JSON.parse(saved) : event;
    }
    const activeKey = REDIS_CHANNELS.Listener(listener.userId, listener.workflowId, listener.nodeId);
    const updated = await redis.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local listener = cjson.decode(raw)
      if listener.attemptId ~= ARGV[1] then return 0 end
      if listener.status == 'failed' or listener.status == 'stopped' then return 0 end
      listener.status = ARGV[2]
      listener.lifecycle = cjson.decode(ARGV[3])
      if ARGV[2] == 'listening' then listener.startupCompleted = true; redis.call('ZREM', KEYS[3], KEYS[1]) end
      redis.call('SET', KEYS[1], cjson.encode(listener))
      redis.call('SET', KEYS[2], ARGV[3], 'EX', 3600)
      return 1
    `, 3, activeKey, statusKey, this.startupDeadlinesKey, listener.attemptId, state, JSON.stringify(event));
    if (updated) await getRedisQueue().publish(`ws:user:${listener.userId}`, JSON.stringify(event));
    const saved = await redis.get(statusKey);
    return saved ? JSON.parse(saved) : event;
  }

  static async stopListener(listener: ListenerData, terminal?: any): Promise<void> {
    const { userId, workflowId, nodeId, attemptId } = listener;
    const key = REDIS_CHANNELS.Listener(userId, workflowId, nodeId);
    const redis = getRedisCache();
    if (attemptId && listener.routingWorkflowId) {
      const id = `${userId}:${workflowId}:${nodeId}:${attemptId}`;
      const event = terminal ?? { type: "market_stream_lifecycle", workflowId, nodeId, attemptId, status: "stopped", timestamp: new Date().toISOString() };
      // Retire active state and persist the cleanup outbox in the same transaction.
      // The outbox survives process/Redis connection failures and is retried until
      // the market-stream service acknowledges the exact private routing owner.
      await redis.eval(`
        local raw = redis.call('GET', KEYS[1])
        if not raw then return 0 end
        local listener = cjson.decode(raw)
        if listener.attemptId ~= ARGV[1] then return 0 end
        local pending = cjson.decode(ARGV[3])
        pending.listener = listener
        if listener.status == 'failed' and listener.lifecycle then pending.event = listener.lifecycle end
        redis.call('HSET', KEYS[5], ARGV[2], cjson.encode(pending))
        redis.call('SET', KEYS[6], cjson.encode(pending.event), 'EX', 3600)
        redis.call('DEL', KEYS[1], KEYS[2])
        redis.call('SREM', KEYS[3], KEYS[1])
        redis.call('ZREM', KEYS[7], KEYS[1])
        local count = tonumber(redis.call('GET', KEYS[4]) or '0')
        if count > 0 then redis.call('DECR', KEYS[4]) end
        return 1
      `, 7, key, REDIS_CHANNELS.ListenerResult(userId, workflowId, nodeId),
        REDIS_CHANNELS.userActiveListeners(userId), REDIS_CHANNELS.userListenerCount(userId),
        this.pendingCleanupKey, `${key}:status:${attemptId}`, this.startupDeadlinesKey, attemptId, id, JSON.stringify({ listener, event }));
      const pending = await redis.hget(this.pendingCleanupKey, id);
      if (pending) {
        try { await this.deliverCleanup(id, pending); }
        catch (error) { logger.warn({ error, id }, "Listener cleanup durably queued for retry"); }
      }
      return;
    }
    // Claim this exact attempt once. Cleanup uses its private routing/ownership ID,
    // so a concurrent replacement or live workflow cannot lose its registrations.
    const claimed = await redis.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local listener = cjson.decode(raw)
      if (listener.attemptId or '') ~= ARGV[1] then return 0 end
      redis.call('DEL', KEYS[1], KEYS[2])
      redis.call('SREM', KEYS[3], KEYS[1])
      local count = tonumber(redis.call('GET', KEYS[4]) or '0')
      if count > 0 then redis.call('DECR', KEYS[4]) end
      return 1
    `, 4, key, REDIS_CHANNELS.ListenerResult(userId, workflowId, nodeId),
      REDIS_CHANNELS.userActiveListeners(userId), REDIS_CHANNELS.userListenerCount(userId), attemptId ?? "");
    if (!claimed) return;
    const event = terminal ?? { type: "market_stream_lifecycle", workflowId, nodeId, attemptId, status: "stopped", timestamp: new Date().toISOString() };
    await redis.setex(`${key}:status:${attemptId}`, 3600, JSON.stringify(event));
    const owner = listener.routingWorkflowId ?? workflowId;
    if (listener.routingWorkflowId) {
      await getRedisQueue().setex(`market:listener-stopped:${userId}:${owner}`, 3600, "1");
      await getRedisQueue().del(`market:listener-ready:${owner}`);
    }
    if (listener.mode === "subscribe") {
      const orderMarkers = new Set(["trade_updates", "ORDER_TRADE_UPDATE", "ALGO_UPDATE", "executionReport", "account_activity", "order_alert", "order_update"]);
      for (const dep of listener.dependencies ?? [{ source: listener.source, environment: listener.environment ?? "", credentialId: "" }]) {
        const trading = dep.source.endsWith("_trading");
        const news = dep.source.endsWith("_news");
        const streamType = (listener.streamTypes ?? []).filter(type => trading ? orderMarkers.has(type) : news ? type === "news" : !orderMarkers.has(type) && type !== "news");
        if (!streamType.length) continue;
        await SubscriptionService.unsubscribe({ source: dep.source as any, userId, workflowId: owner, nodeId,
          symbols: trading ? ["*"] : listener.symbols, streamType, exchange: listener.exchange,
          assetType: listener.assetType, marketType: listener.marketType, contractType: listener.contractType,
          interval: listener.interval, depth_levels: listener.depth_levels, environment: dep.environment,
          scope: listener.scope === "global" ? "global" : "workflow", targetWorkflowId: owner });
      }
    }
    await this.publishUnregisterWorkflow({ userId, workflowId: owner, isTestListener: true });
  }

  /**
   * Delete user active listeners SET key when empty.
   */
  private static async deleteActiveListenersSetIfEmpty(
    userListenersKey: string,
  ): Promise<void> {
    const redis = getRedisCache();
    const remaining = await redis.scard(userListenersKey);

    if (remaining === 0) {
      await redis.del(userListenersKey);
    }
  }

  /**
   * Check and increment listener count (rate limiting)
   * Returns true if allowed, false if limit exceeded
   */
  static async checkAndIncrementListenerCount(
    userId: string,
  ): Promise<boolean> {
    const redis = getRedisCache();
    const countKey = REDIS_CHANNELS.userListenerCount(userId);

    const allowed = await redis.eval(
      LUA_INCREMENT_LISTENER_COUNT,
      1,
      countKey,
      String(MAX_LISTENERS_PER_USER),
      String(LISTENER_TTL_SECONDS),
    );

    if (allowed === 0) {
      logger.warn(
        { userId, maxListeners: MAX_LISTENERS_PER_USER },
        "User exceeded max test listeners",
      );
      return false;
    }

    return true;
  }

  /**
   * Decrement listener count when a listener is stopped
   */
  static async decrementListenerCount(userId: string): Promise<void> {
    const redis = getRedisCache();
    const countKey = REDIS_CHANNELS.userListenerCount(userId);
    await redis.eval(LUA_DECREMENT_LISTENER_COUNT, 1, countKey);
  }

  /**
   * Create a test listener with TTL
   */
  static async createListener(params: ListenerParams): Promise<string> {
    const {
      userId,
      workflowId,
      nodeId,
      source,
      mode = "listen",
      scope,
      environment,
      symbols,
      streamTypes,
      exchange,
      assetType,
      marketType,
      contractType,
      interval,
      depth_levels,
    } = params;
    const redis = getRedisCache();

    const listenerKey = REDIS_CHANNELS.Listener(userId, workflowId, nodeId);
    const now = new Date().toISOString();

    const listenerData: ListenerData = {
      userId,
      workflowId,
      nodeId,
      attemptId: params.attemptId,
      routingWorkflowId: params.routingWorkflowId,
      dependencies: params.dependencies,
      credentialId: params.credentialId,
      credentialRevision: params.credentialRevision, startupDeadlineAt: params.startupDeadlineAt,
      requiredSources: params.requiredSources,
      status: "connecting",
      startedAt: now,
      mode,
      scope,
      source,
      environment,
      symbols,
      streamTypes,
      exchange,
      assetType,
      marketType,
      contractType,
      interval,
      depth_levels,
    };

    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);
    if (params.attemptId) {
      // Manual attempts remain discoverable until explicit Stop or terminal cleanup,
      // including quiet feeds and browsers that reconnect after the old five-minute TTL.
      const created = await redis.eval(`
        if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
        if redis.call('SCARD', KEYS[2]) >= tonumber(ARGV[2]) then return -1 end
        redis.call('SET', KEYS[1], ARGV[1])
        redis.call('SADD', KEYS[2], KEYS[1])
        redis.call('ZADD', KEYS[4], ARGV[3], KEYS[1])
        redis.call('INCR', KEYS[3])
        redis.call('PERSIST', KEYS[3])
        return 1
      `, 4, listenerKey, userListenersKey, REDIS_CHANNELS.userListenerCount(userId), this.startupDeadlinesKey,
        JSON.stringify(listenerData), String(MAX_LISTENERS_PER_USER), String(params.startupDeadlineAt ?? Date.now() + 120000));
      if (created === -1) throw Object.assign(new Error(`Maximum concurrent test listeners (${MAX_LISTENERS_PER_USER}) exceeded.`), { statusCode: 429 });
      if (!created) throw new Error("Another listener attempt is already starting for this node");
    } else {
      const created = await redis.set(listenerKey, JSON.stringify(listenerData), "EX", LISTENER_TTL_SECONDS, "NX");
      if (!created) {
        await this.decrementListenerCount(userId);
        throw new Error("Another listener attempt is already starting for this node");
      }
      await redis.sadd(userListenersKey, listenerKey);
    }

    logger.debug(
      { userId, workflowId, nodeId, source, listenerKey },
      "Created test listener",
    );

    return listenerKey;
  }

  /**
   * Delete a test listener and clean up associated resources
   */
  static async deleteListener(
    userId: string,
    workflowId: string,
    nodeId: string,
  ): Promise<void> {
    const redis = getRedisCache();

    const listenerKey = REDIS_CHANNELS.Listener(userId, workflowId, nodeId);
    const resultKey = REDIS_CHANNELS.ListenerResult(userId, workflowId, nodeId);
    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);

    await redis.eval(`
      if redis.call('DEL', KEYS[1]) == 0 then return 0 end
      redis.call('DEL', KEYS[2])
      redis.call('SREM', KEYS[3], KEYS[1])
      local count = tonumber(redis.call('GET', KEYS[4]) or '0')
      if count > 0 then redis.call('DECR', KEYS[4]) end
      return 1
    `, 4, listenerKey, resultKey, userListenersKey, REDIS_CHANNELS.userListenerCount(userId));

    logger.debug(
      { userId, workflowId, nodeId, listenerKey },
      "Deleted test listener",
    );
  }

  /**
   * Get all active listeners for a user
   */
  static async getActiveListeners(userId: string): Promise<ListenerData[]> {
    const redis = getRedisCache();
    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);

    const listenerKeys = await redis.smembers(userListenersKey);
    const listeners: ListenerData[] = [];
    const removeOrphan = async (key: string) => redis.eval(`
      if redis.call('SREM', KEYS[1], ARGV[1]) == 0 then return 0 end
      local count = tonumber(redis.call('GET', KEYS[2]) or '0')
      if count > 0 then redis.call('DECR', KEYS[2]) end
      return 1
    `, 2, userListenersKey, REDIS_CHANNELS.userListenerCount(userId), key);

    for (const key of listenerKeys) {
      const data = await redis.get(key);
      if (data) {
        try {
          listeners.push(JSON.parse(data));
        } catch {
          // Key exists in SET but data is invalid, clean up
          await removeOrphan(key);
        }
      } else {
        // Key exists in SET but not in Redis, clean up orphan
        await removeOrphan(key);
      }
    }

    await this.deleteActiveListenersSetIfEmpty(userListenersKey);

    return listeners;
  }

  /**
   * Update activity timestamp for a workflow registration
   */
  static async updateActivity(
    userId: string,
    workflowId: string,
  ): Promise<boolean> {
    const redis = getRedisCache();
    const regKey = REDIS_CHANNELS.workflowRegistration(userId, workflowId);

    const data = await redis.get(regKey);
    if (!data) {
      return false;
    }

    try {
      const registration = JSON.parse(data);
      registration.lastActivityAt = new Date().toISOString();
      await redis.set(regKey, JSON.stringify(registration));
      return true;
    } catch (error) {
      logger.warn(
        { userId, workflowId, error },
        "Failed to update registration activity",
      );
      return false;
    }
  }

  /**
   * Publish registration control message to market-stream-service
   */
  static async publishRegisterWorkflow(params: {
    manualListener?: { workflowId: string; nodeId: string; attemptId: string };
    lookupWorkflowId?: string;
    userId: string;
    workflowId: string;
    nodeId: string;
    source: string;
    scope: string;
    environment?: string;
    onlyClosedBars?: boolean;
    interval?: string;
    isLive?: boolean;
    symbols?: string[];
    streamTypes?: string[];
    // symbolMatchMode?: "exact" | "wildcard";
    // tradingNativeStreams?: string[];
  }): Promise<void> {
    const redis = getRedisQueue();

    const controlMessage = {
      action: "register_workflow",
      manualListener: params.manualListener,
      lookupWorkflowId: params.lookupWorkflowId,
      userId: params.userId,
      workflowId: params.workflowId,
      nodeId: params.nodeId,
      source: params.source,
      scope: params.scope,
      environment: params.environment,
      onlyClosedBars: params.onlyClosedBars ?? true, // Default to true
      interval: params.interval,
      isLive: params.isLive ?? false,
      // symbols: params.symbols ?? [],
      // streamTypes: params.streamTypes ?? [],
      // symbolMatchMode: params.symbolMatchMode ?? "exact",
      // tradingNativeStreams: params.tradingNativeStreams ?? [],
    };

    await redis.publish(
      REDIS_CHANNELS.controlRegister,
      JSON.stringify(controlMessage),
    );

    logger.debug({ ...params }, "Published register_workflow control message");
  }

  /**
   * Publish unregistration control message to market-stream-service
   */
  static async publishUnregisterWorkflow(params: {
    userId: string;
    workflowId: string;
    isTestListener?: boolean;
  }): Promise<void> {
    const redis = getRedisQueue();

    const controlMessage = {
      action: "unregister_workflow",
      userId: params.userId,
      workflowId: params.workflowId,
      isTestListener: params.isTestListener,
    };

    await redis.publish(
      REDIS_CHANNELS.controlUnregister,
      JSON.stringify(controlMessage),
    );

    logger.debug(
      { ...params },
      "Published unregister_workflow control message",
    );
  }

  /**
   * Cleanup all test listeners for a user (e.g., on sign out)
   */
  static async cleanupUserListeners(userId: string): Promise<CleanupResult> {
    const redis = getRedisCache();
    const userListenersKey = REDIS_CHANNELS.userActiveListeners(userId);

    // Get all test listener keys for this user
    const listenerKeys = await redis.smembers(userListenersKey);
    let cleanedCount = 0;

    for (const listenerKey of listenerKeys) {
      try {
        const raw = await redis.get(listenerKey);
        if (raw) {
          await this.stopListener(JSON.parse(raw));
          cleanedCount++;
        } else await redis.srem(userListenersKey, listenerKey);
      } catch (error) {
        logger.error({ listenerKey, error }, "Failed to cleanup test listener");
      }
    }

    await this.deleteActiveListenersSetIfEmpty(userListenersKey);

    logger.info(
      { userId, cleaned: cleanedCount, total: listenerKeys.length },
      "User listeners cleanup completed",
    );

    return { cleaned: cleanedCount, total: listenerKeys.length };
  }
}

export default RegistrationService;
