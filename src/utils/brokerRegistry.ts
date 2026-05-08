/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * Frontend Broker Capabilities Registry
 * 
 * All broker-specific UI logic is driven from this config.
 * To add a new broker, add an entry here — zero code changes elsewhere.
 */

export interface BrokerUIConfig {
  /** Display name */
  label: string;
  /** Emoji icon for badges */
  emoji: string;
  /** Tailwind classes for badge styling */
  badgeClasses: string;
  /** Stream name format: 'at' for symbol@type (Binance), 'dot' for type.symbol (Alpaca) */
  streamFormat: 'at' | 'dot' | 'generic';
  /** Source IDs that map to this broker (e.g. alpaca, alpaca_market, alpaca_news) */
  sourceIds: string[];
  /** Whether this broker supports news streams */
  supportsNews?: boolean;
  /** News unsubscribe endpoint (if different from default) */
  newsUnsubscribeEndpoint?: string;
}

export const BROKER_REGISTRY: Record<string, BrokerUIConfig> = {
  alpaca: {
    label: 'Alpaca',
    emoji: '🦙',
    badgeClasses: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    streamFormat: 'dot',
    sourceIds: ['alpaca', 'alpaca_market', 'alpaca_news'],
    supportsNews: true,
    newsUnsubscribeEndpoint: '/alpaca-news/unsubscribe',
  },
  binance: {
    label: 'Binance',
    emoji: '₿',
    badgeClasses: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    streamFormat: 'at',
    sourceIds: ['binance', 'binance_testnet'],
  },
  dhan: {
    label: 'Dhan',
    emoji: '📊',
    badgeClasses: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    streamFormat: 'at',
    sourceIds: ['dhan'],
  },
  schwab: {
    label: 'Schwab',
    emoji: '💼',
    badgeClasses: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    streamFormat: 'generic',
    sourceIds: ['schwab'],
  },
};

/** Resolve a source ID (e.g. "alpaca_news", "binance_testnet") to its broker key */
export function getBrokerKeyFromSource(source: string): string | undefined {
  for (const [key, config] of Object.entries(BROKER_REGISTRY)) {
    if (config.sourceIds.includes(source) || source.startsWith(key)) {
      return key;
    }
  }
  return undefined;
}

/** Get broker config from a source ID */
export function getBrokerConfig(source: string): BrokerUIConfig | undefined {
  const key = getBrokerKeyFromSource(source);
  return key ? BROKER_REGISTRY[key] : undefined;
}

/** Get all registered broker keys */
export function getAllBrokerKeys(): string[] {
  return Object.keys(BROKER_REGISTRY);
}

/** Get badge classes for a source, with fallback */
export function getSourceBadgeClasses(source: string): string {
  const config = getBrokerConfig(source);
  return config?.badgeClasses ?? 'bg-gray-500/20 text-gray-400 border-gray-500/30';
}

/** Get emoji for a source, with fallback */
export function getSourceEmoji(source: string): string {
  const config = getBrokerConfig(source);
  return config?.emoji ?? '📡';
}

/** Check if a node definition represents a news stream node */
export function isNewsStreamNode(definition: any): boolean {
  if (!definition?.name) return false;
  const name = definition.name.toLowerCase();
  return name.includes('news') && (
    definition.category === 'Stream' ||
    definition.executionMode === 'streaming'
  );
}

/** Get the news unsubscribe endpoint for a broker */
export function getNewsUnsubscribeEndpoint(source: string): string {
  const config = getBrokerConfig(source);
  return config?.newsUnsubscribeEndpoint ?? `/stream/${source}/news/unsubscribe`;
}
