export const REDIS_CHANNELS = {
  // Symbol-level market data (fanout)
  marketData: (symbol: string) => `md:symbol:${symbol.toUpperCase()}`,
  
  // Control channels for subscription management
  controlSubscribe: 'md:control:subscribe',
  controlUnsubscribe: 'md:control:unsubscribe',
  
  // Source-specific channels (optional granularity)
  sourceData: (source: string, symbol: string) => `md:${source}:${symbol.toUpperCase()}`,
  
  // User-specific channels (optional for direct delivery)
  userData: (userId: string) => `md:user:${userId}`,
} as const;

export type RedisChannel = ReturnType<typeof REDIS_CHANNELS[keyof typeof REDIS_CHANNELS]>;
