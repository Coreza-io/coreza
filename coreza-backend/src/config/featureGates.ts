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

import { FeatureGate, SubscriptionTier } from '../types/subscription';

/**
 * Open Source Edition: All features are available to all tiers.
 */
const ALL_TIERS: SubscriptionTier[] = ['free', 'trader', 'professional', 'enterprise'];

export const FEATURE_GATES: FeatureGate[] = [
  { feature: 'Basic Indicators', required_tier: ALL_TIERS, description: 'RSI, EMA, SMA, MACD, Bollinger Bands' },
  { feature: 'Advanced Indicators', required_tier: ALL_TIERS, description: 'Ichimoku, ADX, VWAP' },
  { feature: 'AI Agent', required_tier: ALL_TIERS, description: 'AI Agent System' },
  { feature: 'Risk Engine', required_tier: ALL_TIERS, description: 'Portfolio and trading risk analysis engine' },
  { feature: 'LLM Features', required_tier: ALL_TIERS, description: 'OpenAI and other LLM integrations' },
  { feature: 'Screeners', required_tier: ALL_TIERS, description: 'Market screeners and filtering tools' },
  { feature: 'Real-time Streaming', required_tier: ALL_TIERS, description: 'Live market data streaming' },
  { feature: 'Multi-Broker Trading', required_tier: ALL_TIERS, description: 'Execute trades across multiple brokers' },
  { feature: 'Telegram/WhatsApp', required_tier: ALL_TIERS, description: 'Messaging integrations (Telegram, WhatsApp)' },
  { feature: 'Multiple Brokers', required_tier: ALL_TIERS, description: 'Number of broker connections available to the user' },
];

export const SUBSCRIPTION_LIMITS: Record<SubscriptionTier, { executionsPerMonth: number; brokerConnections: number | 'unlimited' }> = {
  free: { executionsPerMonth: Number.POSITIVE_INFINITY, brokerConnections: 'unlimited' },
  trader: { executionsPerMonth: Number.POSITIVE_INFINITY, brokerConnections: 'unlimited' },
  professional: { executionsPerMonth: Number.POSITIVE_INFINITY, brokerConnections: 'unlimited' },
  enterprise: { executionsPerMonth: Number.POSITIVE_INFINITY, brokerConnections: 'unlimited' },
};

export const UPGRADE_URL = process.env.UPGRADE_URL || process.env.PRICING_URL || 'https://coreza.ai/pricing';
