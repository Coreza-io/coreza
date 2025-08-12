import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null
});

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
