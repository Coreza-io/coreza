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
import { RedisKeys } from '../infra/redisKeys';

type LoopState = {
  loopItems: any[];
  loopIndex: number;
  batchSize: number;
  parallel: boolean;
  continueOnError: boolean;
  aggregated: any[];              // or object if you aggregate keyed
  _edgeBuf: Record<string, any>;  // edgeId -> payloads
  finished: boolean;
};

/**
 * Enhanced node store with loop state and feedback buffering
 */
export class NodeStoreV2 {
  private executionId: string;
  private readonly userId: string;
  private readonly workflowId: string;
  private readonly sessionId: string;
  private nodes = new Map<string, any>();
  private loops = new Map<string, LoopState>();
  private nodeResults = new Map<string, any>();
  private nodeStates = new Map<string, Map<string, any>>();
  private workflowNodes: any[];
  private _cachedResults: Record<string, any> | null = null;
  private pinnedResults = new Map<string, any>();

  constructor(
    executionId: string,
    nodes: any[],
    userId: string,
    workflowId: string,
    sessionId?: string,
  ) {
    this.executionId = executionId;
    this.userId = userId;
    this.workflowId = workflowId;
    this.sessionId = sessionId ?? executionId;
    this.workflowNodes = nodes;
    
    // Populate node definitions
    for (const node of nodes) {
      this.setNodeDef(node.id, node);
    }
  }

  getNodeDef(id: string) {
    return this.nodes.get(id);
  }

  setNodeDef(id: string, def: any) {
    this.nodes.set(id, def);
  }

  ensureLoopState(id: string, input: any, config?: any): LoopState {
    const existing = this.loops.get(id);
    if (existing) return existing;

    // Parse input array based on configuration
    const inputField = config?.inputArray || 'items';
    let items: any[];
    
    if (Array.isArray(input)) {
      items = input;
    } else if (input != null && typeof input === 'object' && input[inputField]) {
      items = Array.isArray(input[inputField]) ? input[inputField] : [input[inputField]];
    } else if (input == null) {
      items = [];
    } else if (typeof input === 'string') {
      items = this.tryJson(input);
    } else {
      items = [input];
    }

    const st: LoopState = {
      loopItems: items,
      loopIndex: 0,
      batchSize: config?.batchSize || this.getLoopBatchSize(id) || 1,
      parallel: config?.parallel || false,
      continueOnError: config?.continueOnError || false,
      aggregated: [],
      _edgeBuf: {},
      finished: false,
    };
    this.loops.set(id, st);
    return st;
  }

  getLoopState(id: string): LoopState | undefined {
    return this.loops.get(id);
  }

  advanceLoop(id: string, currentBatch: any[]) {
    const st = this.loops.get(id)!;
    st.loopIndex += 1;
    // emit mid-run output shape if you need to store it:
    this.nodes.set(id, { output: currentBatch });
  }

  appendAggregate(id: string, arrivals: any) {
    const st = this.loops.get(id)!;
    if (Array.isArray(arrivals)) st.aggregated.push(...arrivals);
    else if (arrivals != null) st.aggregated.push(arrivals);
  }

  getAggregated(id: string) {
    return this.loops.get(id)?.aggregated;
  }

  bufferToLoop(loopId: string, edgeId: string, payload: any) {
    const st = this.loops.get(loopId);
    if (!st) return; // loop not started yet
    st._edgeBuf[edgeId] = payload;
  }

  consumeEdgeBuf(loopId: string) {
    const st = this.loops.get(loopId)!;
    const val = Object.values(st._edgeBuf);
    st._edgeBuf = {};
    return val;
  }

  // Alias for consistency with LoopHandler
  appendEdgeBuf(loopId: string, payload: any) {
    this.bufferToLoop(loopId, `edge-${Date.now()}`, payload);
  }

  finishLoop(id: string) {
    const st = this.loops.get(id)!;
    st.finished = true;
    // set final output
    this.nodes.set(id, { output: st.aggregated, done: true });
  }

  setNodeError(id: string, err: any) {
    this.nodes.set(id, { error: err.message || err, failed: true });
  }

  getLoopBatchSize(id: string): number {
    const def = this.nodes.get(id);
    return def?.values?.batchSize || def?.data?.batchSize || 1;
  }

  private tryJson(x: string) {
    try { 
      const v = JSON.parse(x); 
      return Array.isArray(v) ? v : [v]; 
    }
    catch { 
      return [x]; 
    }
  }

  // Node result management
  setNodeResult(nodeId: string, result: any) {
    this.nodeResults.set(nodeId, result);
    if (this._cachedResults) {
      this._cachedResults[nodeId] = result;
    }
  }

  getNodeResult(nodeId: string) {
    return this.nodeResults.get(nodeId);
  }

  getAllResults() {
    if (this._cachedResults) {
      return this._cachedResults;
    }

    const results: any = {};
    for (const [nodeId, result] of this.nodeResults.entries()) {
      results[nodeId] = result;
    }

    this._cachedResults = results;
    return this._cachedResults;
  }

  /**
   * Pin results that should survive clearResults().
   * Used for BacktestInit results that never change between bars.
   */
  pinResults(results: Record<string, any>): void {
    for (const [nodeId, result] of Object.entries(results)) {
      this.pinnedResults.set(nodeId, result);
      this.nodeResults.set(nodeId, result);
      if (this._cachedResults) {
        this._cachedResults[nodeId] = result;
      }
    }
  }

  /**
   * Clear only per-bar results, preserving node defs, states, and pinned results.
   * Much cheaper than constructing a new NodeStoreV2.
   */
  clearResults(): void {
    this.nodeResults.clear();

    for (const [nodeId, result] of this.pinnedResults) {
      this.nodeResults.set(nodeId, result);
    }

    if (!this._cachedResults) {
      if (this.pinnedResults.size === 0) return;
      this._cachedResults = {};
    }

    for (const key of Object.keys(this._cachedResults)) {
      if (!this.pinnedResults.has(key)) {
        delete this._cachedResults[key];
      }
    }

    for (const [nodeId, result] of this.pinnedResults) {
      this._cachedResults[nodeId] = result;
    }
  }

  // Node state management (for execution context)
  getNodeState(nodeId: string, key: string): any {
    const nodeStateMap = this.nodeStates.get(nodeId);
    return nodeStateMap?.get(key);
  }

  setNodeState(nodeId: string, key: string, value: any): void {
    let nodeStateMap = this.nodeStates.get(nodeId);
    if (!nodeStateMap) {
      nodeStateMap = new Map();
      this.nodeStates.set(nodeId, nodeStateMap);
    }
    nodeStateMap.set(key, value);
  }

  // Persistent value management (for Edit Fields nodes)
  async getPersistentValue(
    userId: string,
    workflowId: string,
    key: string,
  ): Promise<any> {
    const redis = getRedisCache();
    const redisKey = RedisKeys.persistent(userId, workflowId, key);
    const value = await redis.get(redisKey);
    return value ? JSON.parse(value) : null;
  }

  async setPersistentValue(
    userId: string,
    workflowId: string,
    key: string,
    value: any,
  ): Promise<void> {
    const redis = getRedisCache();
    const redisKey = RedisKeys.persistent(userId, workflowId, key);
    await redis.set(redisKey, JSON.stringify(value));
  }

  // Redis persistence methods (legacy compatibility)
  async setNodeStateRedis(nodeId: string, state: string): Promise<void> {
    const redis = getRedisCache();
    const key = RedisKeys.nodeState(this.userId, this.workflowId, this.sessionId, this.executionId, nodeId);
    await redis.hset(key, 'state', state);
  }

  async getNodeStateRedis(nodeId: string): Promise<string | null> {
    const redis = getRedisCache();
    const key = RedisKeys.nodeState(this.userId, this.workflowId, this.sessionId, this.executionId, nodeId);
    return await redis.hget(key, 'state');
  }

  async setNodeOutput(nodeId: string, output: any): Promise<void> {
    const redis = getRedisCache();
    const key = RedisKeys.nodeState(this.userId, this.workflowId, this.sessionId, this.executionId, nodeId);
    await redis.hset(key, 'output', JSON.stringify(output ?? null));
  }

  async getNodeOutput(nodeId: string): Promise<any> {
    const redis = getRedisCache();
    const key = RedisKeys.nodeState(this.userId, this.workflowId, this.sessionId, this.executionId, nodeId);
    const value = await redis.hget(key, 'output');
    return value ? JSON.parse(value) : null;
  }
}
