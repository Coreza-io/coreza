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

import supabase from '../config/supabase';
import { SUBSCRIPTION_LIMITS } from '../config/featureGates';
import { Subscription, SubscriptionTier } from '../types/subscription';

interface UsageCheckResult {
  allowed: boolean;
  remainingExecutions?: number;
  limit?: number;
  requiresOverageBilling?: boolean;
  reason?: string;
}

interface UsageAggregation {
  daily: number;
  monthly: number;
}

function getPeriodStart(period: 'daily' | 'monthly'): string {
  const now = new Date();
  if (period === 'daily') {
    now.setHours(0, 0, 0, 0);
  } else {
    now.setDate(1);
    now.setHours(0, 0, 0, 0);
  }
  return now.toISOString();
}

export class UsageMeteringService {
  static async getExecutionCount(userId: string, period: 'daily' | 'monthly' = 'monthly'): Promise<number> {
    const periodStart = getPeriodStart(period);

    const { count, error } = await supabase
      .from('workflow_runs' as any)
      .select('id', { head: true, count: 'exact' })
      .eq('initiated_by', userId)
      .gte('started_at', periodStart);

    if (error) {
      console.error('[UsageMeteringService] Failed to count executions', error);
      return 0;
    }

    return count || 0;
  }

  static getTierLimit(tier: SubscriptionTier): number {
    return SUBSCRIPTION_LIMITS[tier]?.executionsPerMonth ?? 0;
  }

  static async checkExecutionAllowance(userId: string, subscription: Subscription | null): Promise<UsageCheckResult> {
    if (!subscription) {
      return { allowed: false, reason: 'No active subscription found' };
    }

    const limit = this.getTierLimit(subscription.tier);

    if (!Number.isFinite(limit)) {
      return { allowed: true };
    }

    const usage = await this.getExecutionCount(userId, 'monthly');
    const remainingExecutions = limit - usage;

    if (remainingExecutions > 0) {
      return { allowed: true, remainingExecutions, limit };
    }

    // Paid tiers can proceed with overage billing enabled
    const requiresOverageBilling = subscription.tier !== 'free';
    return {
      allowed: requiresOverageBilling,
      remainingExecutions: 0,
      limit,
      requiresOverageBilling,
      reason: requiresOverageBilling
        ? 'Execution limit reached. Overage billing will apply.'
        : 'Monthly execution limit reached for the Free plan.',
    };
  }

  static async recordExecution(userId: string, workflowId: string, subscription: Subscription | null) {
    const { allowed, reason } = await this.checkExecutionAllowance(userId, subscription);
    if (!allowed) {
      return { success: false, error: reason || 'Execution not allowed' };
    }

    const { error } = await supabase.from('usage_events' as any).insert({
      user_id: userId,
      workflow_id: workflowId,
      event_type: 'workflow_execution',
      occurred_at: new Date().toISOString(),
    });

    if (error) {
      console.error('[UsageMeteringService] Failed to record execution', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  static async getAggregatedUsage(userId: string): Promise<UsageAggregation> {
    const [daily, monthly] = await Promise.all([
      this.getExecutionCount(userId, 'daily'),
      this.getExecutionCount(userId, 'monthly'),
    ]);

    return { daily, monthly };
  }
}
