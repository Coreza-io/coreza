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
  userDataPattern: "ws:user:*",

  // ============================================
  // WORKFLOW REGISTRATION KEYS (MarketDataSubscriber)
  // ============================================

  // Workflow registration persistence (stores workflow routing info)
  // Used by: MarketDataSubscriber, StreamingCleanupService
  workflowRegistration: (userId: string, workflowId: string) =>
    `workflow:userId:${userId}:workflowId:${workflowId}`,

  // Active streaming workflows SET (tracks which workflows are streaming)
  // Used by: stream.ts status endpoint, cleanup services
  activeStreamingWorkflows: (userId: string) =>
    `workflow:userId:${userId}:active_streaming`,

  // Workflow stream filter (stores filter config for a streaming workflow)
  workflowStreamFilter: (userId: string, workflowId: string) =>
    `workflow:userId:${userId}:workflowId:${workflowId}:stream_filter`,

  // ============================================
  // SUBSCRIPTION KEYS (Broker connections via Subscribe nodes)
  // ============================================

  // Global subscription streams (user-level, shared across all workflows)
  // Stores native stream names: btcusdt@kline_1m, bars.AAPL
  // Used by: SubscriptionService, MarketControlHandler
  globalSubscriptionStreams: (
    userId: string,
    source: string,
    environment: string,
  ) => `sub:userId:${userId}:scope:global:${source}:${environment}:streams`,

  // Workflow-scoped subscription streams (isolated to specific workflow)
  // Stores native stream names: btcusdt@kline_1m, bars.AAPL
  // Used by: SubscriptionService, MarketControlHandler
  workflowSubscriptionStreams: (
    userId: string,
    workflowId: string,
    source: string,
    environment: string,
  ) =>
    `sub:userId:${userId}:scope:workflow:workflowId:${workflowId}:${source}:${environment}:streams`,

  // ============================================
  // GATEWAY STATE KEYS (MarketDataGateway)
  // ============================================

  // Gateway state persistence (per-user, per-source)
  gatewayState: (userId: string, source: string) =>
    `gateway:userId:${userId}:${source}:state`,

  // Users associated with a gateway (for multi-user restoration)
  gatewayUsers: (source: string) => `gateway:${source}:users`,

  // ============================================
  // TEST LISTENER KEYS (Stream testing in UI)
  // ============================================

  // Individual test listener data
  // Used by: stream.ts register/unregister endpoints
  Listener: (userId: string, workflowId: string, nodeId: string) =>
    `listener:userId:${userId}:workflowId:${workflowId}:${nodeId}`,

  // listener result (stores captured market event)
  ListenerResult: (userId: string, workflowId: string, nodeId: string) =>
    `listener:userId:${userId}:workflowId:${workflowId}:${nodeId}:result`,

  // User's active test listeners SET (for efficient per-user queries)
  userActiveListeners: (userId: string) =>
    `listener:userId:${userId}:active`,

  // User's test listener count (for rate limiting)
  userListenerCount: (userId: string) =>
    `listener:userId:${userId}:count`,
} as const;

// ============================================
// KEY PATTERN CONSTANTS (for Redis KEYS/SCAN operations)
// ============================================

export const REDIS_KEY_PATTERNS = {
  // All workflow registrations for a user
  userWorkflowRegistrations: (userId: string) => `workflow:userId:${userId}:workflowId:*`,

  // All global subscription streams for a user (new format)
  userGlobalSubscriptionStreams: (userId: string) =>
    `sub:userId:${userId}:scope:global:*:streams`,

  // All workflow-scoped subscription streams for a user (new format)
  userWorkflowSubscriptionStreams: (userId: string) =>
    `sub:userId:${userId}:scope:workflow:workflowId:*:*:*:streams`,

  // All global subscription environments for a user
  userGlobalSubscriptionEnvironments: (userId: string) =>
    `sub:userId:${userId}:scope:global:*:environment`,

  // All workflow-scoped subscription environments for a user
  userWorkflowSubscriptionEnvironments: (userId: string) =>
    `sub:userId:${userId}:scope:workflow:workflowId:*:*:*:environment`,

  // LEGACY: Symbol-only patterns (for backward compatibility)
  userGlobalSubscriptions: (userId: string) =>
    `sub:userId:${userId}:scope:global:*:symbols`,
  userWorkflowSubscriptions: (userId: string) =>
    `sub:userId:${userId}:scope:workflow:workflowId:*:*:*:symbols`,

  // All gateway states for a user
  userGatewayStates: (userId: string) => `gateway:userId:${userId}:*:state`,

  // All test listeners for a user
  userListeners: (userId: string) => `listener:userId:${userId}:*`,
} as const;

// Type exports
type RedisChannelValue = (typeof REDIS_CHANNELS)[keyof typeof REDIS_CHANNELS];
export type RedisChannel = RedisChannelValue extends (...args: any[]) => infer R
  ? R
  : RedisChannelValue;
