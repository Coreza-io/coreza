/*
 * Copyright (C) 2024 Coreza
 * Shared utilities for stream data symbol/type filtering
 */

import Redis from "ioredis";

export interface SymbolFilterConfig {
  userId: string;
  workflowId?: string;
  source: string;
  scope: "global" | "workflow";
  symbols?: string[];
}

export interface EventFilterConfig {
  symbols?: string[];
  streamTypes?: string[];
}

/**
 * Get allowed symbols based on subscription mode
 * Fetches from Redis and optionally intersects with filter_symbols
 */
export async function getAllowedSymbols(
  redis: Redis,
  config: SymbolFilterConfig,
): Promise<string[]> {
  const { userId, workflowId, source, scope, symbols } = config;

  let subscribedSymbols: string[] = [];

  if (scope === "global") {
    // Fetch user's globally subscribed symbols
    subscribedSymbols = await redis.smembers(
      `user:${userId}:subscribed_symbols:${source}`,
    );
  } else {
    // Workflow-scoped symbols
    if (!workflowId) {
      return symbols?.map((s) => s.toUpperCase()) || [];
    }
    subscribedSymbols = await redis.smembers(
      `workflow:${workflowId}:subscribed_symbols:${source}`,
    );
  }

  // Normalize to uppercase
  const normalizedSubscribed = subscribedSymbols.map((s) => s.toUpperCase());

  // If filter_symbols specified, intersect with subscribed
  if (symbols && symbols.length > 0) {
    const normalizedFilter = symbols.map((s) => s.toUpperCase());
    return normalizedSubscribed.filter((s) => normalizedFilter.includes(s));
  }

  return normalizedSubscribed;
}

/**
 * Check if an event symbol matches the allowed symbols filter
 * Returns true if symbol passes filter (or no filter applied)
 */
export function matchesSymbolFilter(
  eventSymbol: string | undefined,
  allowedSymbols: string[],
): boolean {
  if (!allowedSymbols || allowedSymbols.length === 0) {
    return true; // No filter = allow all
  }
  if (!eventSymbol) {
    return false; // No symbol in event but filter exists
  }
  return allowedSymbols.includes(eventSymbol.toUpperCase());
}

/**
 * Check if an event type matches the allowed types filter
 * Returns true if type passes filter (or no filter applied)
 */
export function matchesTypeFilter(
  eventType: string | undefined,
  allowedTypes: string[],
): boolean {
  if (!allowedTypes || allowedTypes.length === 0) {
    return true; // No filter = allow all
  }
  if (!eventType) {
    return false; // No type in event but filter exists
  }
  const normalizedEventType = eventType.toLowerCase();
  const normalizedAllowedTypes = allowedTypes.map((type) => type.toLowerCase());
  return normalizedAllowedTypes.includes(normalizedEventType);
}

/**
 * Combined check for both symbol and type filters
 * Returns true only if event passes both filters
 */
export function matchesEventFilters(
  eventSymbol: string | undefined,
  eventType: string | undefined,
  config: EventFilterConfig,
): boolean {
  const { symbols, streamTypes } = config;

  // Normalize filter symbols to uppercase
  const normalizedSymbols = symbols?.map((s) => s.toUpperCase()) || [];

  if (!matchesSymbolFilter(eventSymbol, normalizedSymbols)) {
    return false;
  }

  if (!matchesTypeFilter(eventType, streamTypes || [])) {
    return false;
  }

  return true;
}

/**
 * Parse comma-separated symbol string into array
 */
export function parseSymbolString(symbolString?: string): string[] {
  if (!symbolString) return [];
  return symbolString
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}
