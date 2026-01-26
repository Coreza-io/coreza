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
 * STATUS SERVICE
 * ============================================
 *
 * Centralized service for aggregating subscription status.
 * Provides read-only views of gateway states, registrations, and subscriptions.
 *
 * All Redis operations use keys from REDIS_CHANNELS for consistency.
 */

import { getRedisCache } from "../config/redis";
import { REDIS_CHANNELS, REDIS_KEY_PATTERNS } from "../config/redisChannels";
import { supabase } from "../config/supabase";
import logger from "../utils/logger";
import { parseStreamName } from "../utils/streamName";

// ============================================
// TYPES
// ============================================

export interface GatewayState {
  source: string;
  connected: boolean;
  symbols: string[];
  eventTypes: string[];
  connectedAt: string | null;
  lastMessageAt: string | null;
}

export interface WorkflowRegistration {
  workflowId: string;
  workflowName?: string;
  nodeId: string;
  symbols: string[];
  eventTypes: string[];
  source: string;
  isActive: boolean;
}

export interface WorkflowScopedSubscription {
  workflowId: string;
  workflowName?: string;
  source: string;
  symbols: string[];
  streams?: string[];  // Native stream names (e.g., btcusdt@kline_1m)
}

export interface SubscriptionStatus {
  sources: GatewayState[];
  workflows: WorkflowRegistration[];
  userSubscriptions: Record<string, string[]>; // source -> symbols (legacy)
  userSubscriptionStreams: Record<string, string[]>; // source -> stream names (new)
  workflowScopedSubscriptions: WorkflowScopedSubscription[];
  stats: {
    totalSources: number;
    totalSymbols: number;
    totalStreams: number;
    totalWorkflows: number;
    connectedSources: string[];
  };
  symbolSourceMap: Record<string, string[]>; // symbol -> sources
}

// ============================================
// STATUS SERVICE
// ============================================

export class StatusService {
  /**
   * Get all gateway states for a user
   */
  static async getGatewayStates(userId: string): Promise<GatewayState[]> {
    const redis = getRedisCache();
    const gatewayKeys = await redis.keys(
      REDIS_KEY_PATTERNS.userGatewayStates(userId),
    );
    const sources: GatewayState[] = [];

    for (const key of gatewayKeys) {
      const stateStr = await redis.get(key);
      if (stateStr) {
        try {
          const state = JSON.parse(stateStr);
          // Extract source from key: md:gateway:{userId}:{source}:state
          const sourceMatch = key.match(
            new RegExp(`^md:gateway:${userId}:([^:]+):state$`),
          );
          if (sourceMatch) {
            sources.push({
              source: sourceMatch[1],
              connected: state.connected || false,
              symbols: state.symbols || [],
              eventTypes: state.eventTypes || [],
              connectedAt: state.connectedAt || null,
              lastMessageAt: state.lastMessageAt || null,
            });
          }
        } catch (e) {
          logger.error({ key, error: e }, "Error parsing gateway state");
        }
      }
    }

    return sources;
  }

  /**
   * Get all workflow registrations for a user
   */
  static async getWorkflowRegistrations(
    userId: string,
  ): Promise<WorkflowRegistration[]> {
    const redis = getRedisCache();
    const regKeys = await redis.keys(
      REDIS_KEY_PATTERNS.userWorkflowRegistrations(userId),
    );
    const registrations: WorkflowRegistration[] = [];
    const workflowIds = new Set<string>();

    for (const key of regKeys) {
      const regStr = await redis.get(key);
      if (regStr) {
        try {
          const reg = JSON.parse(regStr);
          registrations.push({
            workflowId: reg.workflowId,
            nodeId: reg.nodeId,
            symbols: reg.symbols || [],
            eventTypes: reg.eventTypes || [],
            source: reg.source || "unknown",
            isActive: true,
          });
          if (reg.workflowId) {
            workflowIds.add(reg.workflowId);
          }
        } catch (e) {
          logger.error(
            { key, error: e },
            "Error parsing workflow registration",
          );
        }
      }
    }

    // Also check active streaming workflows SET
    const activeWorkflows = await redis.smembers(
      REDIS_CHANNELS.activeStreamingWorkflows(userId),
    );

    for (const workflowId of activeWorkflows) {
      workflowIds.add(workflowId);

      const alreadyIncluded = registrations.some(
        (r) => r.workflowId === workflowId,
      );
      if (!alreadyIncluded) {
        // Try to get additional info from stream filter
        const filterKey = REDIS_CHANNELS.workflowStreamFilter(
          userId,
          workflowId,
        );
        const filterStr = await redis.get(filterKey);
        let source = "unknown";
        let eventTypes: string[] = [];

        if (filterStr) {
          try {
            const filter = JSON.parse(filterStr);
            source = filter.source || "unknown";
            eventTypes = filter.eventTypes || [];
          } catch {
            /* ignore parse errors */
          }
        }

        registrations.push({
          workflowId,
          nodeId: "",
          symbols: [],
          eventTypes,
          source,
          isActive: true,
        });
      }
    }

    // Fetch workflow names from Supabase
    if (workflowIds.size > 0) {
      const { data: workflows } = await supabase
        .from("workflows")
        .select("id, name")
        .in("id", Array.from(workflowIds));

      if (workflows) {
        for (const reg of registrations) {
          const wf = workflows.find((w) => w.id === reg.workflowId);
          reg.workflowName = wf?.name || "Unknown Workflow";
        }
      }
    }

    return registrations;
  }

  /**
   * Get global (user-level) subscriptions - returns both symbols (legacy) and streams (new)
   */
  static async getGlobalSubscriptions(
    userId: string,
  ): Promise<{ symbols: Record<string, string[]>; streams: Record<string, string[]> }> {
    const redis = getRedisCache();
    const symbols: Record<string, string[]> = {};
    const streams: Record<string, string[]> = {};

    // Try new :streams key pattern first
    const streamKeys = await redis.keys(
      REDIS_KEY_PATTERNS.userGlobalSubscriptionStreams(userId),
    );

    for (const key of streamKeys) {
      // Pattern: md:user:{userId}:subscription:scope:global:{source}:streams
      const match = key.match(
        /md:user:[^:]+:subscription:scope:global:([^:]+):streams$/,
      );
      if (match) {
        const streamNames = await redis.smembers(key);
        if (streamNames.length > 0) {
          streams[match[1]] = streamNames;
          // Also extract symbols from stream names for backward compatibility
          const extractedSymbols = new Set<string>();
          for (const streamName of streamNames) {
            const parsed = parseStreamName(match[1], streamName);
            extractedSymbols.add(parsed.symbol);
          }
          if (!symbols[match[1]]) {
            symbols[match[1]] = Array.from(extractedSymbols);
          }
        }
      }
    }

    // Also check legacy :symbols keys for backward compatibility
    const symbolKeys = await redis.keys(
      REDIS_KEY_PATTERNS.userGlobalSubscriptions(userId),
    );

    for (const key of symbolKeys) {
      // Pattern: md:user:{userId}:subscription:scope:global:{source}:symbols
      const match = key.match(
        /md:user:[^:]+:subscription:scope:global:([^:]+):symbols$/,
      );
      if (match) {
        const legacySymbols = await redis.smembers(key);
        if (legacySymbols.length > 0 && !symbols[match[1]]) {
          symbols[match[1]] = legacySymbols;
        }
      }
    }

    return { symbols, streams };
  }

  /**
   * Get workflow-scoped subscriptions
   */
  static async getWorkflowScopedSubscriptions(
    userId: string,
  ): Promise<WorkflowScopedSubscription[]> {
    const redis = getRedisCache();
    const subscriptionsMap = new Map<string, WorkflowScopedSubscription>();
    const workflowIds = new Set<string>();

    // Try new :streams key pattern first
    const streamKeys = await redis.keys(
      REDIS_KEY_PATTERNS.userWorkflowSubscriptionStreams(userId),
    );

    for (const key of streamKeys) {
      // Pattern: md:user:{userId}:subscription:scope:workflow:{workflowId}:{source}:streams
      const match = key.match(
        /md:user:[^:]+:subscription:scope:workflow:([^:]+):([^:]+):streams$/,
      );
      if (match) {
        const [, workflowId, source] = match;
        const streamNames = await redis.smembers(key);
        if (streamNames.length > 0) {
          const mapKey = `${workflowId}:${source}`;
          // Extract symbols from stream names
          const extractedSymbols = new Set<string>();
          for (const streamName of streamNames) {
            const parsed = parseStreamName(source, streamName);
            extractedSymbols.add(parsed.symbol);
          }
          subscriptionsMap.set(mapKey, {
            workflowId,
            source,
            symbols: Array.from(extractedSymbols),
            streams: streamNames,
          });
          workflowIds.add(workflowId);
        }
      }
    }

    // Also check legacy :symbols keys for backward compatibility
    const symbolKeys = await redis.keys(
      REDIS_KEY_PATTERNS.userWorkflowSubscriptions(userId),
    );

    for (const key of symbolKeys) {
      // Pattern: md:user:{userId}:subscription:scope:workflow:{workflowId}:{source}:symbols
      const match = key.match(
        /md:user:[^:]+:subscription:scope:workflow:([^:]+):([^:]+):symbols$/,
      );
      if (match) {
        const [, workflowId, source] = match;
        const mapKey = `${workflowId}:${source}`;
        // Only use legacy symbols if we don't have streams data
        if (!subscriptionsMap.has(mapKey)) {
          const symbols = await redis.smembers(key);
          if (symbols.length > 0) {
            subscriptionsMap.set(mapKey, { workflowId, source, symbols });
            workflowIds.add(workflowId);
          }
        }
      }
    }

    const subscriptions = Array.from(subscriptionsMap.values());

    // Fetch workflow names from Supabase
    if (workflowIds.size > 0) {
      const { data: workflows } = await supabase
        .from("workflows")
        .select("id, name")
        .in("id", Array.from(workflowIds));

      if (workflows) {
        for (const sub of subscriptions) {
          const wf = workflows.find((w) => w.id === sub.workflowId);
          sub.workflowName = wf?.name || "Unknown Workflow";
        }
      }
    }

    return subscriptions;
  }

  /**
   * Build symbol-source map from all data sources
   */
  static buildSymbolSourceMap(
    sources: GatewayState[],
    workflows: WorkflowRegistration[],
    globalSubs: Record<string, string[]>,
    workflowSubs: WorkflowScopedSubscription[],
  ): { allSymbols: Set<string>; symbolSourceMap: Record<string, string[]> } {
    const allSymbols = new Set<string>();
    const symbolSourceMap: Record<string, string[]> = {};

    const addSymbol = (symbol: string, source: string) => {
      allSymbols.add(symbol);
      if (!symbolSourceMap[symbol]) symbolSourceMap[symbol] = [];
      if (!symbolSourceMap[symbol].includes(source)) {
        symbolSourceMap[symbol].push(source);
      }
    };

    sources.forEach((s) =>
      s.symbols.forEach((sym) => addSymbol(sym, s.source)),
    );
    workflows.forEach((w) =>
      w.symbols.forEach((sym) => addSymbol(sym, w.source)),
    );
    Object.entries(globalSubs).forEach(([source, symbols]) =>
      symbols.forEach((sym) => addSymbol(sym, source)),
    );
    workflowSubs.forEach((sub) =>
      sub.symbols.forEach((sym) => addSymbol(sym, sub.source)),
    );

    return { allSymbols, symbolSourceMap };
  }

  /**
   * Get complete subscription status for a user
   */
  static async getSubscriptionStatus(
    userId: string,
  ): Promise<SubscriptionStatus> {
    const [sources, workflows, globalSubsResult, workflowScopedSubscriptions] =
      await Promise.all([
        this.getGatewayStates(userId),
        this.getWorkflowRegistrations(userId),
        this.getGlobalSubscriptions(userId),
        this.getWorkflowScopedSubscriptions(userId),
      ]);

    const { symbols: userSubscriptions, streams: userSubscriptionStreams } = globalSubsResult;

    const { allSymbols, symbolSourceMap } = this.buildSymbolSourceMap(
      sources,
      workflows,
      userSubscriptions,
      workflowScopedSubscriptions,
    );

    // Count total streams
    let totalStreams = 0;
    for (const streamList of Object.values(userSubscriptionStreams)) {
      totalStreams += streamList.length;
    }
    for (const sub of workflowScopedSubscriptions) {
      if (sub.streams) {
        totalStreams += sub.streams.length;
      }
    }

    return {
      sources,
      workflows,
      userSubscriptions,
      userSubscriptionStreams,
      workflowScopedSubscriptions,
      stats: {
        totalSources: sources.filter((s) => s.connected).length,
        totalSymbols: allSymbols.size,
        totalStreams,
        totalWorkflows: workflows.length,
        connectedSources: sources
          .filter((s) => s.connected)
          .map((s) => s.source),
      },
      symbolSourceMap,
    };
  }
}

export default StatusService;
