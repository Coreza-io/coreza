import { v4 as uuidv4 } from "uuid";
import Redis from "ioredis";
import { createDedicatedCacheConnection, getRedisCache } from "../config/redis";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { WorkflowEngine } from "./workflowEngine";
import { BacktestExecutor } from "../nodes/executors/BacktestExecutor";

const BACKTEST_GROUP = "backtest-group";

export class BacktestRunner {
  private readonly engine: WorkflowEngine;
  private readonly redisStream: Redis;
  private readonly redisCache: Redis;
  private readonly streamKey: string;
  private running = false;
  private readonly abortController: AbortController;
  private readonly consumerName: string;
  private barsProcessed = 0;

  constructor(
    private readonly backtestId: string,
    workflowId: string,
    userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    private readonly entryNodeIds: string[],
    private readonly backtestInitResult: Record<string, any>,
    private readonly totalBars: number,
  ) {
    this.redisStream = createDedicatedCacheConnection(`Backtest-${backtestId}`);
    this.redisCache = getRedisCache();
    this.streamKey = `backtest:stream:${backtestId}`;
    this.abortController = new AbortController();
    this.consumerName = `consumer-${backtestId}`;
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
      .xgroup("CREATE", this.streamKey, BACKTEST_GROUP, "0", "MKSTREAM")
      .catch(() => undefined);

    while (this.running) {
      const results = (await this.redisStream.xreadgroup(
        "GROUP",
        BACKTEST_GROUP,
        this.consumerName,
        "COUNT",
        "100",
        "STREAMS",
        this.streamKey,
        ">",
      )) as [string, [string, string[]][]][] | null;

      if (!results?.length) {
        await this.finalize();
        break;
      }

      for (const [, messages] of results) {
        for (const [messageId, fields] of messages) {
          const payloadIndex = fields.findIndex((field) => field === "event");
          const rawEvent =
            payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;

          if (!rawEvent) {
            await this.redisStream.xack(this.streamKey, BACKTEST_GROUP, messageId);
            continue;
          }

          this.engine.resetLight(uuidv4(), this.abortController.signal);

          // Pre-load BacktestInit results so templates like
          // {{ $('BacktestInit').json.backtest_id }} resolve correctly
          this.engine.preloadResults(this.backtestInitResult);

          try {
            const event = JSON.parse(rawEvent);
            // Use executeFromEntries to start from the identified entry nodes
            await this.engine.executeFromEntries(
              { data: event?.bar ?? event },
              this.entryNodeIds,
            );
          } catch (error) {
            console.error("[BacktestRunner] Error processing stream event:", error);
          }

          await this.redisStream.xack(this.streamKey, BACKTEST_GROUP, messageId);
          this.barsProcessed += 1;

          if (this.barsProcessed % 1000 === 0) {
            await this.reportProgress();
          }
        }
      }

      if (this.barsProcessed >= this.totalBars) {
        await this.finalize();
        break;
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
    await this.redisStream.quit();
  }

  private async reportProgress(): Promise<void> {
    const percent =
      this.totalBars > 0 ? Math.round((this.barsProcessed / this.totalBars) * 100) : 100;

    await this.redisCache.set(
      `backtest:progress:${this.backtestId}`,
      JSON.stringify({
        backtestId: this.backtestId,
        barsProcessed: this.barsProcessed,
        totalBars: this.totalBars,
        percent,
        updatedAt: new Date().toISOString(),
      }),
      "EX",
      3600,
    );
  }

  private async finalize(): Promise<void> {
    this.running = false;
    await this.reportProgress();

    try {
      const backtestExecutor = new BacktestExecutor();
      await backtestExecutor.finalizeBacktestById(this.backtestId);
    } catch (error) {
      console.error(`[BacktestRunner] Finalization failed for ${this.backtestId}:`, error);
    }

    await this.redisCache.del(`backtest:progress:${this.backtestId}`);
    await this.redisStream.del(this.streamKey).catch(() => undefined);
    await this.redisStream.quit();
  }
}
