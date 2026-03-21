import Redis from "ioredis";
import { randomUUID } from "crypto";
import { createDedicatedStreamConnection } from "../config/redis";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { WorkflowEngine } from "../engine";
import { PortfolioManager } from "../simulation/PortfolioManager";
import { createRunInRedis, updateRunStatusInRedis } from "../utils/redisRunStorage";

const STRATEGY_GROUP = "strategy-group";

export class WorkflowRunner {
  private readonly engine: WorkflowEngine;
  private readonly redisStream: Redis;
  private readonly streamKey: string;
  private readonly runnerId: string;
  private running = false;
  private readonly abortController: AbortController;
  private readonly consumerName: string;
  private readonly workflowSnapshot: {
    nodes: any;
    edges: any;
    node_count: number;
    edge_count: number;
  };

  constructor(
    private readonly workflowId: string,
    private readonly userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ) {
    this.runnerId = randomUUID();
    this.redisStream = createDedicatedStreamConnection(`Strategy-${workflowId}`);
    this.streamKey = `strategy:stream:${workflowId}`;
    this.abortController = new AbortController();
    this.consumerName = `consumer-${workflowId}-${this.runnerId}`;
    this.workflowSnapshot = {
      nodes,
      edges,
      node_count: nodes.length,
      edge_count: edges.length,
    };
    this.engine = new WorkflowEngine(
      this.runnerId,
      workflowId,
      userId,
      nodes,
      edges,
      "best-effort",
      this.abortController.signal,
      "standard",
    );
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.redisStream
      .xgroup("CREATE", this.streamKey, STRATEGY_GROUP, "0", "MKSTREAM")
      .catch(() => undefined);

    while (this.running) {
      const results = (await this.redisStream.xreadgroup(
        "GROUP",
        STRATEGY_GROUP,
        this.consumerName,
        "BLOCK",
        "5000",
        "COUNT",
        "10",
        "STREAMS",
        this.streamKey,
        ">",
      )) as [string, [string, string[]][]][] | null;

      if (!results?.length) continue;

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          const payloadIndex = fields.findIndex((field) => field === "event");
          const rawEvent = payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;

          if (!rawEvent) {
            await this.redisStream.xack(this.streamKey, STRATEGY_GROUP, messageId);
            continue;
          }

          const eventRunId = randomUUID();
          await createRunInRedis(eventRunId, this.workflowId, this.userId, {
            ...this.workflowSnapshot,
            source: 'stream',
          });

          this.engine.resetForNextBar(true);

          try {
            const event = JSON.parse(rawEvent);
            const result = await this.engine.execute({ data: event?.data ?? event });

            await updateRunStatusInRedis(eventRunId, 'success', {
              result: {
                success: true,
                data: result,
                meta: {
                  source: 'stream',
                  timestamp: new Date().toISOString(),
                  streamMessageId: messageId,
                },
              },
            });
          } catch (error) {
            await updateRunStatusInRedis(eventRunId, 'failed', {
              errorMessage: error instanceof Error ? error.message : String(error),
            });
            console.error("[WorkflowRunner] Error processing stream event:", error);
          }

          await this.redisStream.xack(this.streamKey, STRATEGY_GROUP, messageId);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
    this.engine.destroy();
    PortfolioManager.removeInstance(this.userId, this.runnerId);
    await this.cleanupRunnerKeys();
    await this.redisStream.quit();
  }

  private async cleanupRunnerKeys(): Promise<void> {
    const pattern = `user:${this.userId}:workflow:${this.workflowId}:runId:${this.runnerId}:*`;
    let cursor = "0";

    do {
      const [nextCursor, keys] = await this.redisStream.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "200",
      );

      cursor = nextCursor;

      if (keys.length > 0) {
        await this.redisStream.del(...keys);
      }
    } while (cursor !== "0");
  }
}
