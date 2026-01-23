export const REDIS_CHANNELS = {
  // Symbol-level market data (fanout)
  marketData: (symbol: string) => `md:symbol:${symbol.toUpperCase()}`,

  // Control channels for subscription management (broker connections)
  controlSubscribe: "md:control:subscribe",
  controlUnsubscribe: "md:control:unsubscribe",

  // Control channels for workflow registration (internal routing)
  controlRegister: "md:control:register_workflow",
  controlUnregister: "md:control:unregister_workflow",

  // User-specific WebSocket delivery channel
  userData: (userId: string) => `ws:user:${userId}`,

  // Workflow registration persistence (user-scoped)
  // NOTE: This is for REGISTRATIONS (internal routing), not broker subscriptions
  workflowRegistration: (userId: string, workflowId: string) =>
    `md:user:${userId}:wf:reg:${workflowId}`,

  // Gateway state persistence (per-user, per-source)
  gatewayState: (userId: string, source: string) =>
    `md:gateway:${userId}:${source}:state`,
} as const;

type RedisChannelValue = (typeof REDIS_CHANNELS)[keyof typeof REDIS_CHANNELS];
export type RedisChannel = RedisChannelValue extends (...args: any[]) => infer R
  ? R
  : RedisChannelValue;
