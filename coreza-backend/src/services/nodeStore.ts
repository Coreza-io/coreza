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

import { redis } from '../config/redis';

const keyFor = (runId: string, nodeId: string) => `workflow:${runId}:node:${nodeId}`;

export class NodeStore {
  static async setNodeState(runId: string, nodeId: string, state: string): Promise<void> {
    const key = keyFor(runId, nodeId);
    await redis.hset(key, 'state', state);
  }

  static async getNodeState(runId: string, nodeId: string): Promise<string | null> {
    const key = keyFor(runId, nodeId);
    return await redis.hget(key, 'state');
  }

  static async setNodeOutput(runId: string, nodeId: string, output: any): Promise<void> {
    const key = keyFor(runId, nodeId);
    await redis.hset(key, 'output', JSON.stringify(output ?? null));
  }

  static async getNodeOutput(runId: string, nodeId: string): Promise<any> {
    const key = keyFor(runId, nodeId);
    const value = await redis.hget(key, 'output');
    return value ? JSON.parse(value) : null;
  }
}
