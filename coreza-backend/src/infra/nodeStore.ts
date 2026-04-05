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

import { getRedisCache } from "../config/redis";
import { RedisKeys } from "./redisKeys";

const keyFor = (
  userId: string,
  workflowId: string,
  sessionId: string,
  runId: string,
  nodeId: string,
) => RedisKeys.nodeState(userId, workflowId, sessionId, runId, nodeId);

export class NodeStore {
  static async setNodeState(
    userId: string,
    workflowId: string,
    sessionId: string,
    runId: string,
    nodeId: string,
    state: string,
  ): Promise<void> {
    const key = keyFor(userId, workflowId, sessionId, runId, nodeId);
    await getRedisCache().hset(key, "state", state);
  }

  static async getNodeState(
    userId: string,
    workflowId: string,
    sessionId: string,
    runId: string,
    nodeId: string,
  ): Promise<string | null> {
    const key = keyFor(userId, workflowId, sessionId, runId, nodeId);
    return getRedisCache().hget(key, "state");
  }

  static async setNodeOutput(
    userId: string,
    workflowId: string,
    sessionId: string,
    runId: string,
    nodeId: string,
    output: unknown,
  ): Promise<void> {
    const key = keyFor(userId, workflowId, sessionId, runId, nodeId);
    await getRedisCache().hset(key, "output", JSON.stringify(output ?? null));
  }

  static async getNodeOutput(
    userId: string,
    workflowId: string,
    sessionId: string,
    runId: string,
    nodeId: string,
  ): Promise<unknown> {
    const key = keyFor(userId, workflowId, sessionId, runId, nodeId);
    const value = await getRedisCache().hget(key, "output");
    return value ? JSON.parse(value) : null;
  }
}
