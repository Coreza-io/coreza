/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * ============================================
 * REDIS CHANNELS AND KEY PATTERNS
 * ============================================
 *
 * This file defines all Redis channels and key patterns used in the system.
 * Use these constants instead of hardcoding keys to ensure consistency.
 *
 * TERMINOLOGY:
 * - Subscribe/Unsubscribe: Connecting to external broker (MarketDataGateway)
 * - Register/Unregister: Adding/removing workflow from internal routing (MarketDataSubscriber)
 */

export const REDIS_CHANNELS = {
  // ============================================
  // PUB/SUB CHANNELS (Real-time messaging)
  // ============================================

  // Symbol-level market data (fanout) - published by MarketDataGateway
  marketData: (symbol: string) => `md:symbol:${symbol.toUpperCase()}`,

  // Control channels for SUBSCRIPTION management (broker connections)
  controlSubscribe: "md:control:subscribe",
  controlUnsubscribe: "md:control:unsubscribe",

  // Control channels for REGISTRATION management (internal routing)
  controlRegister: "md:control:register_workflow",
  controlUnregister: "md:control:unregister_workflow",

  // User-specific WebSocket delivery channel (WebSocketManager subscribes)
  userData: (userId: string) => `ws:user:${userId}`,

  // ============================================
  // WORKFLOW REGISTRATION KEYS (MarketDataSubscriber)
  // ============================================

  // Workflow registration persistence (stores workflow routing info)
  // Used by: MarketDataSubscriber, StreamingCleanupService
  workflowRegistration: (userId: string, workflowId: string) =>
    `md:user:${userId}:wf:reg:${workflowId}`,

  // Active streaming workflows SET (tracks which workflows are streaming)
  // Used by: stream.ts status endpoint, cleanup services
  activeStreamingWorkflows: (userId: string) =>
    `md:user:${userId}:active_streaming_workflows`,

  // Workflow stream filter (stores filter config for a streaming workflow)
  workflowStreamFilter: (userId: string, workflowId: string) =>
    `md:user:${userId}:workflow:${workflowId}:stream_filter`,

  // ============================================
  // SUBSCRIPTION KEYS (Broker connections via Subscribe nodes)
  // ============================================

  // Global subscription symbols (user-level, shared across all workflows)
  // Used by: SubscriptionService, MarketControlHandler
  globalSubscription: (userId: string, source: string) =>
    `md:user:${userId}:subscription:scope:global:${source}:symbols`,

  // Workflow-scoped subscription symbols (isolated to specific workflow)
  // Used by: SubscriptionService, MarketControlHandler
  workflowSubscription: (userId: string, workflowId: string, source: string) =>
    `md:user:${userId}:subscription:scope:workflow:${workflowId}:${source}:symbols`,

  // ============================================
  // GATEWAY STATE KEYS (MarketDataGateway)
  // ============================================

  // Gateway state persistence (per-user, per-source)
  gatewayState: (userId: string, source: string) =>
    `md:gateway:${userId}:${source}:state`,

  // Users associated with a gateway (for multi-user restoration)
  gatewayUsers: (source: string) => `md:gateway:${source}:users`,

  // ============================================
  // TEST LISTENER KEYS (Stream testing in UI)
  // ============================================

  // Individual test listener data
  // Used by: stream.ts register/unregister endpoints
  testListener: (userId: string, workflowId: string, nodeId: string) =>
    `md:user:${userId}:stream:${workflowId}:${nodeId}`,

  // Test listener result (stores captured market event)
  testListenerResult: (userId: string, workflowId: string, nodeId: string) =>
    `md:user:${userId}:stream:${workflowId}:${nodeId}:result`,

  // User's active test listeners SET (for efficient per-user queries)
  userActiveListeners: (userId: string) =>
    `md:user:${userId}:stream:active_listeners`,

  // User's test listener count (for rate limiting)
  userListenerCount: (userId: string) =>
    `md:user:${userId}:stream:listener_count`,

  // ============================================
  // LEGACY KEY PATTERNS (for migration/cleanup)
  // ============================================

  // Legacy subscription key pattern (before standardization)
  // Pattern: md:user:{userId}:subscribed_symbols:{source}
  legacySubscribedSymbols: (userId: string, source: string) =>
    `md:user:${userId}:subscribed_symbols:${source}`,

  // Legacy workflow-scoped subscription pattern
  // Pattern: md:user:{userId}:workflow:{workflowId}:subscribed_symbols:{source}
  legacyWorkflowSubscribedSymbols: (
    userId: string,
    workflowId: string,
    source: string,
  ) => `md:user:${userId}:workflow:${workflowId}:subscribed_symbols:${source}`,
} as const;

// ============================================
// KEY PATTERN CONSTANTS (for Redis KEYS/SCAN operations)
// ============================================

export const REDIS_KEY_PATTERNS = {
  // All workflow registrations for a user
  userWorkflowRegistrations: (userId: string) => `md:user:${userId}:wf:reg:*`,

  // All global subscriptions for a user
  userGlobalSubscriptions: (userId: string) =>
    `md:user:${userId}:subscription:scope:global:*:symbols`,

  // All workflow-scoped subscriptions for a user
  userWorkflowSubscriptions: (userId: string) =>
    `md:user:${userId}:subscription:scope:workflow:*:*:symbols`,

  // All gateway states for a user
  userGatewayStates: (userId: string) => `md:gateway:${userId}:*:state`,

  // All test listeners for a user
  userTestListeners: (userId: string) => `md:user:${userId}:stream:*`,

  // Legacy patterns (for cleanup)
  legacyUserSubscriptions: (userId: string) =>
    `md:user:${userId}:subscribed_symbols:*`,
  legacyUserWorkflowSubscriptions: (userId: string) =>
    `md:user:${userId}:workflow:*:subscribed_symbols:*`,
} as const;

// Type exports
type RedisChannelValue = (typeof REDIS_CHANNELS)[keyof typeof REDIS_CHANNELS];
export type RedisChannel = RedisChannelValue extends (...args: any[]) => infer R
  ? R
  : RedisChannelValue;
