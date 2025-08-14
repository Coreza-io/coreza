import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null
});

type LoopState = {
  loopItems: any[];
  loopIndex: number;
  batchSize: number;
  aggregated: any[];              // or object if you aggregate keyed
  _edgeBuf: Record<string, any>;  // edgeId -> payloads
  finished: boolean;
};

/**
 * Enhanced node store with loop state and feedback buffering
 */
export class NodeStoreV2 {
  private runId: string;
  private nodes = new Map<string, any>();
  private loops = new Map<string, LoopState>();
  private nodeResults = new Map<string, any>();
  private nodeStates = new Map<string, Map<string, any>>();
  private workflowNodes: any[];

  constructor(runId: string, nodes: any[]) {
    this.runId = runId;
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

  ensureLoopState(id: string, input: any): LoopState {
    const existing = this.loops.get(id);
    if (existing) return existing;

    const items = Array.isArray(input) ? input
                : input == null ? []
                : typeof input === 'string' ? this.tryJson(input)
                : [input];

    const st: LoopState = {
      loopItems: items,
      loopIndex: 0,
      batchSize: this.getLoopBatchSize(id) ?? 1,
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
  }

  getNodeResult(nodeId: string) {
    return this.nodeResults.get(nodeId);
  }

  getAllResults() {
    const results: any = {};
    for (const [nodeId, result] of this.nodeResults.entries()) {
      results[nodeId] = result;
    }
    return results;
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
  async getPersistentValue(workflowId: string, key: string): Promise<any> {
    const redisKey = `workflow:${workflowId}:persistent:${key}`;
    const value = await redis.get(redisKey);
    return value ? JSON.parse(value) : null;
  }

  async setPersistentValue(workflowId: string, key: string, value: any): Promise<void> {
    const redisKey = `workflow:${workflowId}:persistent:${key}`;
    await redis.set(redisKey, JSON.stringify(value));
  }

  // Redis persistence methods (legacy compatibility)
  async setNodeStateRedis(nodeId: string, state: string): Promise<void> {
    const key = `workflow:${this.runId}:node:${nodeId}`;
    await redis.hset(key, 'state', state);
  }

  async getNodeStateRedis(nodeId: string): Promise<string | null> {
    const key = `workflow:${this.runId}:node:${nodeId}`;
    return await redis.hget(key, 'state');
  }

  async setNodeOutput(nodeId: string, output: any): Promise<void> {
    const key = `workflow:${this.runId}:node:${nodeId}`;
    await redis.hset(key, 'output', JSON.stringify(output ?? null));
  }

  async getNodeOutput(nodeId: string): Promise<any> {
    const key = `workflow:${this.runId}:node:${nodeId}`;
    const value = await redis.hget(key, 'output');
    return value ? JSON.parse(value) : null;
  }
}