/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { RedisKeys } from "../infra/redisKeys";
import { RedisOps } from "../infra/redisOps";
import logger from "../utils/logger";
import {
  normalizeRedisRunResultUpdate,
  stringifyWorkflowRunResult,
  type RedisRunResultUpdate,
} from "./workflowRunResultContract";

const RUN_TTL_SECONDS = 86400; // 24 hours - cleanup old runs if sync fails
/**
 * Create a workflow run in Redis (instead of direct Supabase insert)
 */
export async function createRunInRedis(
  userId: string,
  workflowId: string,
  runId: string,
  snapshot?: {
    nodes?: any;
    edges?: any;
    node_count?: number;
    edge_count?: number;
    source?: string;
    variable_revision?: string;
  },
  executionId?: string,
): Promise<boolean> {

  const runData: Record<string, string> = {
    id: runId,
    workflow_id: workflowId,
    initiated_by: userId,
    status: "queued",
    started_at: new Date().toISOString(),
  };
  if (snapshot?.variable_revision !== undefined) runData.variable_revision = snapshot.variable_revision;

  if (snapshot?.nodes !== undefined) {
    runData.nodes =
      typeof snapshot.nodes === "string"
        ? snapshot.nodes
        : JSON.stringify(snapshot.nodes);
  }
  if (snapshot?.edges !== undefined) {
    runData.edges =
      typeof snapshot.edges === "string"
        ? snapshot.edges
        : JSON.stringify(snapshot.edges);
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
  if (executionId) {
    runData.execution_id = executionId;
  }

  // Store run data in Redis hash with TTL and queue for sync in one round-trip
  const pipeline = RedisOps.pipeline();
  const runKey = RedisKeys.userRun(userId, runId);
  const pendingQueue = RedisKeys.userRunsPending(userId);
  pipeline.hset(runKey, runData);
  pipeline.expire(runKey, RUN_TTL_SECONDS);
  pipeline.lpush(pendingQueue, runId);
  pipeline.ltrim(pendingQueue, 0, 9999);
  pipeline.sadd(RedisKeys.registryRunsPending(), userId);
  const results = await pipeline.exec();

  logger.debug({ runId, workflowId }, "Created run in Redis");
  // Report partial writes without changing the existing admission/retry policy.
  return !!results && results.every(([error]) => !error);
}

/**
 * Update run status in Redis
 */
export async function updateRunStatusInRedis(
  userId: string,
  runId: string,
  status: "running" | "success" | "failed" | "cancelled",
  executionResult?: RedisRunResultUpdate,
  metadata?: {
    variableRevision?: string;
    variableCheckpoint?: Readonly<Record<string, unknown>>;
  },
): Promise<void> {

  const updates: Record<string, string> = {
    status,
  };

  if (status === "success" || status === "failed" || status === "cancelled") {
    updates.completed_at = new Date().toISOString();
  }

  if (executionResult !== undefined) {
    const normalized = normalizeRedisRunResultUpdate(executionResult);
    if (normalized.result !== undefined) updates.result = stringifyWorkflowRunResult(normalized.result);
    if (normalized.errorMessage) updates.error_message = normalized.errorMessage;
  }

  if (metadata?.variableRevision !== undefined) {
    updates.variable_revision = metadata.variableRevision;
  }
  if (metadata?.variableCheckpoint !== undefined) {
    updates.variable_checkpoint = JSON.stringify(metadata.variableCheckpoint);
  }

  await RedisOps.hset(RedisKeys.userRun(userId, runId), updates);

  logger.debug({ runId, status }, "Updated run status in Redis");
}

/**
 * Check if run exists in Redis
 */
export async function runExistsInRedis(
  userId: string,
  runId: string,
): Promise<boolean> {
  return (await RedisOps.exists(RedisKeys.userRun(userId, runId))) === 1;
}
