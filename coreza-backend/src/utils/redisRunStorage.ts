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

import { getRedisCache } from '../config/redis';
import logger from '../utils/logger';

const RUN_TTL_SECONDS = 86400; // 24 hours - cleanup old runs if sync fails

/**
 * Create a workflow run in Redis (instead of direct Supabase insert)
 */
export async function createRunInRedis(
  runId: string,
  workflowId: string,
  userId: string,
  snapshot?: {
    nodes?: any;
    edges?: any;
    node_count?: number;
    edge_count?: number;
    source?: string;
  }
): Promise<void> {
  const redis = getRedisCache();
  
  const runData: Record<string, string> = {
    id: runId,
    workflow_id: workflowId,
    initiated_by: userId,
    status: 'queued',
    started_at: new Date().toISOString(),
  };

  if (snapshot?.nodes !== undefined) {
    runData.nodes = typeof snapshot.nodes === 'string' ? snapshot.nodes : JSON.stringify(snapshot.nodes);
  }
  if (snapshot?.edges !== undefined) {
    runData.edges = typeof snapshot.edges === 'string' ? snapshot.edges : JSON.stringify(snapshot.edges);
  }
  if (snapshot?.node_count !== undefined) {
    runData.node_count = String(snapshot.node_count);
  }
  if (snapshot?.edge_count !== undefined) {
    runData.edge_count = String(snapshot.edge_count);
  }
  if (snapshot?.source) {
    runData.source = snapshot.source;
  }

  // Store run data in Redis hash with TTL
  await redis.hset(`runs:data:${runId}`, runData);
  await redis.expire(`runs:data:${runId}`, RUN_TTL_SECONDS);

  // Add to pending sync list
  await redis.lpush('runs:pending:all', runId);

  logger.debug({ runId, workflowId }, 'Created run in Redis');
}

/**
 * Update run status in Redis
 */
export async function updateRunStatusInRedis(
  runId: string,
  status: 'running' | 'success' | 'failed' | 'cancelled',
  options?: {
    result?: any;
    errorMessage?: string;
  }
): Promise<void> {
  const redis = getRedisCache();
  
  const updates: Record<string, string> = {
    status,
  };

  if (status === 'success' || status === 'failed' || status === 'cancelled') {
    updates.completed_at = new Date().toISOString();
  }

  if (options?.result !== undefined) {
    updates.result = JSON.stringify(options.result);
  }

  if (options?.errorMessage) {
    updates.error_message = options.errorMessage;
  }

  await redis.hset(`runs:data:${runId}`, updates);
  
  logger.debug({ runId, status }, 'Updated run status in Redis');
}

/**
 * Check if run exists in Redis
 */
export async function runExistsInRedis(runId: string): Promise<boolean> {
  const redis = getRedisCache();
  return await redis.exists(`runs:data:${runId}`) === 1;
}
