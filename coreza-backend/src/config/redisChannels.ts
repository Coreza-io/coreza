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
  controlSubscribe: "md:control:subscribe",
  controlUnsubscribe: "md:control:unsubscribe",

  // Control channels for register management
  controlRegister: "md:control:register_workflow",
  controlUnregister: "md:control:unregister_workflow",

  // User-specific WebSocket delivery channel
  userData: (userId: string) => `ws:user:${userId}`,

  // Registered Workflow persistence (user-scoped)
  registeredWorkflow: (userId: string, workflowId: string) =>
    `md:user:${userId}:wf:sub:${workflowId}`,

  // Gateway state persistence (per-user, per-source)
  gatewayState: (userId: string, source: string) =>
    `md:gateway:${userId}:${source}:state`,
} as const;

type RedisChannelValue = typeof REDIS_CHANNELS[keyof typeof REDIS_CHANNELS];
export type RedisChannel = RedisChannelValue extends (...args: any[]) => infer R
  ? R
  : RedisChannelValue;
