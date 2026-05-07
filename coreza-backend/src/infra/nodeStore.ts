/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { getRedisCache } from "../config/redis";
import { RedisKeys } from "./redisKeys";

const keyFor = (
  userId: string,
  workflowId: string,
  executionId: string,
  nodeId: string,
) =>
  RedisKeys.nodeState(
    userId,
    workflowId,
    executionId,
    nodeId,
  );

export class NodeStore {
  static async setNodeState(
    userId: string,
    workflowId: string,
    executionId: string,
    nodeId: string,
    state: string,
  ): Promise<void> {
    const key = keyFor(
      userId,
      workflowId,
      executionId,
      nodeId,
    );
    await getRedisCache().hset(key, "state", state);
  }

  static async getNodeState(
    userId: string,
    workflowId: string,
    executionId: string,
    nodeId: string,
  ): Promise<string | null> {
    const key = keyFor(
      userId,
      workflowId,
      executionId,
      nodeId,
    );
    return getRedisCache().hget(key, "state");
  }

  static async setNodeOutput(
    userId: string,
    workflowId: string,
    executionId: string,
    nodeId: string,
    output: unknown,
  ): Promise<void> {
    const key = keyFor(
      userId,
      workflowId,
      executionId,
      nodeId,
    );
    await getRedisCache().hset(key, "output", JSON.stringify(output ?? null));
  }

  static async getNodeOutput(
    userId: string,
    workflowId: string,
    executionId: string,
    nodeId: string,
  ): Promise<unknown> {
    const key = keyFor(
      userId,
      workflowId,
      executionId,
      nodeId,
    );
    const value = await getRedisCache().hget(key, "output");
    return value ? JSON.parse(value) : null;
  }
}
