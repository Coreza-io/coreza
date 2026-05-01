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

  // stream-level market data (fanout) - published by MarketDataGateway
  streamData: (stream: string) => `md:stream:${stream}`,

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

  // Global subscription streams (user-level, shared across all workflows)
  // Stores native stream names: btcusdt@kline_1m, bars.AAPL
  // Used by: SubscriptionService, MarketControlHandler
  globalSubscriptionStreams: (
    userId: string,
    source: string,
    environment: string,
  ) =>
    `md:user:${userId}:subscription:scope:global:${source}:${environment}:streams`,

  // Workflow-scoped subscription streams (isolated to specific workflow)
  // Stores native stream names: btcusdt@kline_1m, bars.AAPL
  // Used by: SubscriptionService, MarketControlHandler
  workflowSubscriptionStreams: (
    userId: string,
    workflowId: string,
    source: string,
    environment: string,
  ) =>
    `md:user:${userId}:subscription:scope:workflow:${workflowId}:${source}:${environment}:streams`,

  // ============================================
  // GATEWAY STATE KEYS (MarketDataGateway)
  // ============================================

  // Gateway state persistence (per-user, per-source)
  gatewayState: (userId: string, source: string) =>
    `md:gateway:${userId}:${source}:state`,

  // Users associated with a gateway (for multi-user restoration)
  gatewayUsers: (source: string) => `md:gateway:${source}:users`,

  // ============================================
  // LISTENER KEYS (Stream testing in UI)
  // ============================================

  // Individual test listener data
  // Used by: stream.ts register/unregister endpoints
  Listener: (userId: string, workflowId: string, nodeId: string) =>
    `md:user:${userId}:stream:${workflowId}:${nodeId}`,

  // listener result (stores captured market event)
  ListenerResult: (userId: string, workflowId: string, nodeId: string) =>
    `md:user:${userId}:stream:${workflowId}:${nodeId}:result`,

  // User's active listeners SET (for efficient per-user queries)
  userActiveListeners: (userId: string) =>
    `md:user:${userId}:stream:active_listeners`,

  // User's listener count (for rate limiting)
  userListenerCount: (userId: string) =>
    `md:user:${userId}:stream:listener_count`,
} as const;

// ============================================
// KEY PATTERN CONSTANTS (for Redis KEYS/SCAN operations)
// ============================================

export const REDIS_KEY_PATTERNS = {
  // All workflow registrations for a user
  userWorkflowRegistrations: (userId: string) => `md:user:${userId}:wf:reg:*`,

  // All global subscription streams for a user (new format)
  userGlobalSubscriptionStreams: (userId: string) =>
    `md:user:${userId}:subscription:scope:global:*:streams`,

  // All workflow-scoped subscription streams for a user (new format)
  userWorkflowSubscriptionStreams: (userId: string) =>
    `md:user:${userId}:subscription:scope:workflow:*:*:streams`,

  // All global subscription environments for a user
  userGlobalSubscriptionEnvironments: (userId: string) =>
    `md:user:${userId}:subscription:scope:global:*:environment`,

  // All workflow-scoped subscription environments for a user
  userWorkflowSubscriptionEnvironments: (userId: string) =>
    `md:user:${userId}:subscription:scope:workflow:*:*:environment`,

  // All gateway states for a user
  userGatewayStates: (userId: string) => `md:gateway:${userId}:*:state`,

  // All test listeners for a user
  userListeners: (userId: string) => `md:user:${userId}:stream:*`,
} as const;

// Type exports
type RedisChannelValue = (typeof REDIS_CHANNELS)[keyof typeof REDIS_CHANNELS];
export type RedisChannel = RedisChannelValue extends (...args: any[]) => infer R
  ? R
  : RedisChannelValue;
