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

  constructor(runId: string) {
    this.runId = runId;
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

  // Redis persistence methods
  async setNodeState(nodeId: string, state: string): Promise<void> {
    const key = `workflow:${this.runId}:node:${nodeId}`;
    await redis.hset(key, 'state', state);
  }

  async getNodeState(nodeId: string): Promise<string | null> {
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