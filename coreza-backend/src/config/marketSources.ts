/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { MarketSource } from '../types/marketEvent';
import { GATEWAY_CONFIGS } from '../brokers';

/**
 * Auto-generated mapping from frontend stream source params to MarketSource.
 * Built dynamically from GATEWAY_CONFIGS to avoid manual maintenance.
 * 
 * This maps route params like 'alpaca_stream' or 'binance_stream' to 
 * the canonical MarketSource type used internally.
 */
export const SOURCE_TO_MARKET_SOURCE: Record<string, MarketSource> = {};

// Build mappings dynamically from gateway configs
for (const [gatewayId, config] of Object.entries(GATEWAY_CONFIGS)) {
  const source = config.id;
  
  // Map {source}_stream pattern (e.g., 'alpaca_stream' → 'alpaca')
  SOURCE_TO_MARKET_SOURCE[`${source}_stream`] = source;
  
  // Also map direct gateway name (e.g., 'alpaca' → 'alpaca')
  SOURCE_TO_MARKET_SOURCE[source] = source;
}

/**
 * Get the MarketSource for a given frontend source param.
 * Returns null if source is not recognized.
 */
export function getMarketSource(source: string): MarketSource | null {
  return SOURCE_TO_MARKET_SOURCE[source] || null;
}

/**
 * Check if a source string is a valid market source.
 */
export function isValidMarketSource(source: string): boolean {
  return source in SOURCE_TO_MARKET_SOURCE;
}

/**
 * Get all registered market source keys (including _stream variants).
 */
export function getAllMarketSourceKeys(): string[] {
  return Object.keys(SOURCE_TO_MARKET_SOURCE);
}
