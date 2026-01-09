export const REDIS_CHANNELS = {
  // Symbol-level market data (fanout)
  marketData: (symbol: string) => `md:symbol:${symbol.toUpperCase()}`,

  // Control channels for subscription management
  controlSubscribe: "md:control:subscribe",
  controlUnsubscribe: "md:control:unsubscribe",

  // Control channels for register management
  controlRegister: "md:control:register_workflow",
  controlUnregister: "md:control:unregister_workflow",

  // Source-specific channels (optional granularity)
  sourceData: (source: string, symbol: string) =>
    `md:${source}:${symbol.toUpperCase()}`,

  // User-specific channels (optional for direct delivery)
  userData: (userId: string) => `md:user:${userId}`,

  // Workflow subscription persistence
  workflowSubscription: (workflowId: string) => `wf:sub:${workflowId}`,
  symbolWorkflows: (symbol: string) => `wf:subs:symbol:${symbol.toUpperCase()}`,

  // Gateway state persistence (Phase 5)
  gatewayState: (source: string) => `md:gateway:${source}`,
  gatewaySymbols: (source: string) => `md:gateway:${source}:symbols`,
} as const;

type RedisChannelValue = (typeof REDIS_CHANNELS)[keyof typeof REDIS_CHANNELS];
export type RedisChannel = RedisChannelValue extends (...args: any[]) => infer R
  ? R
  : RedisChannelValue;
