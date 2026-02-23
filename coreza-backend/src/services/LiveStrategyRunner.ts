import { v4 as uuidv4 } from "uuid";
import Redis from "ioredis";
import { createDedicatedCacheConnection } from "../config/redis";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { WorkflowEngine } from "./workflowEngine";

const STRATEGY_GROUP = "strategy-group";

export class LiveStrategyRunner {
  private readonly engine: WorkflowEngine;
  private readonly redisStream: Redis;
  private readonly streamKey: string;
  private running = false;
  private readonly abortController: AbortController;
  private readonly consumerName: string;

  constructor(
    private readonly workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
  ) {
    this.redisStream = createDedicatedCacheConnection(`Strategy-${workflowId}`);
    this.streamKey = `strategy:stream:${workflowId}`;
    this.abortController = new AbortController();
    this.consumerName = `consumer-${workflowId}`;
    this.engine = new WorkflowEngine(
      uuidv4(),
      workflowId,
      userId,
      nodes,
      edges,
      "best-effort",
      this.abortController.signal,
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

          const runId = uuidv4();
          this.engine.reset(runId, this.abortController.signal);

          try {
            const event = JSON.parse(rawEvent);
            await this.engine.execute({ data: event?.data ?? event });
          } catch (error) {
            console.error("[LiveStrategyRunner] Error processing stream event:", error);
          }

          await this.redisStream.xack(this.streamKey, STRATEGY_GROUP, messageId);
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
    await this.redisStream.quit();
  }
}
