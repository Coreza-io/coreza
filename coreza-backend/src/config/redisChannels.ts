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
  
  // Workflow subscription persistence
  workflowSubscription: (workflowId: string) => `wf:sub:${workflowId}`,
  symbolWorkflows: (symbol: string) => `wf:subs:symbol:${symbol.toUpperCase()}`,
  
  // Gateway state persistence (Phase 5)
  gatewayState: (source: string) => `md:gateway:${source}`,
  gatewaySymbols: (source: string) => `md:gateway:${source}:symbols`,
} as const;

type RedisChannelValue = typeof REDIS_CHANNELS[keyof typeof REDIS_CHANNELS];
export type RedisChannel = RedisChannelValue extends (...args: any[]) => infer R
  ? R
  : RedisChannelValue;
