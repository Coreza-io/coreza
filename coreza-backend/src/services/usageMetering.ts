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

import { Subscription } from '../types/subscription';

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

/**
 * Open Source Edition: All usage checks pass by default.
 * No execution limits are enforced.
 */
export class UsageMeteringService {
  static async getExecutionCount(_userId: string, _period: 'daily' | 'monthly' = 'monthly'): Promise<number> {
    return 0;
  }

  static getTierLimit(_tier: string): number {
    return Number.POSITIVE_INFINITY;
  }

  static async checkExecutionAllowance(_userId: string, _subscription: Subscription | null): Promise<UsageCheckResult> {
    return { allowed: true };
  }

  static async recordExecution(_userId: string, _workflowId: string, _subscription: Subscription | null) {
    return { success: true };
  }

  static async getAggregatedUsage(_userId: string): Promise<UsageAggregation> {
    return { daily: 0, monthly: 0 };
  }
}
