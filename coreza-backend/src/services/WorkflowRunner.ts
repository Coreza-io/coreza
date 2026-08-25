import Redis from "ioredis";
import { randomUUID } from "crypto";
import { createDedicatedStreamConnection } from "../config/redis";
import { WorkflowEdge, WorkflowNode } from "../nodes/types";
import { WorkflowEngine } from "../engine";
import { PortfolioManager } from "../simulation/PortfolioManager";
import {
  createRunInRedis,
  updateRunStatusInRedis,
} from "../utils/redisRunStorage";
import { WorkflowExecutionResult } from "../engine/types";
import { RedisKeys } from "../infra/redisKeys";
import {
  scanConsolidators,
  commitConsolidatorEmissions,
  type ConsolidatorEmission,
} from "../engine/consolidation/consolidatorScan";
import {
  findDeliveredEmissionIds,
  recordDeliveredEmissions,
} from "../engine/consolidation/consolidatorDeliveryReceipt";
import {
  consolidatorDownstreamFailuresCounter,
  consolidatorEmissionsCounter,
  consolidatorScanLatencyHistogram,
  consolidatorScansCounter,
} from "../utils/metrics";

const STRATEGY_GROUP = "strategy-group";
const AUTOCLAIM_IDLE_MS = 60_000; // 60s idle threshold for reclaiming
const POLL_BLOCK_MS = 5_000;
const POLL_BATCH_SIZE = 10;
const TRANSIENT_BACKOFF_MS = 1_000;

interface StreamEventEnvelope {
  type?: string;
  data: unknown;
  timestamp?: string;
  symbol?: string;
}

interface StreamMessageWithSequence {
  messageId: string;
  fields: string[];
  seq: number;
  orderingDomain: string;
  index: number;
}

export class WorkflowRunner {
  private readonly engine: WorkflowEngine;
  private readonly streamRedisClient: Redis;
  private readonly streamKey: string;
  private readonly executionId: string;
  private running = false;
  private workChain: Promise<void> = Promise.resolve();
  private scanTimer?: NodeJS.Timeout;
  private readonly abortController: AbortController;
  private readonly consumerName: string;
  private readonly serializedSnapshot: {
    nodes: string;
    edges: string;
    nodeCount: number;
    edgeCount: number;
  };
  /** Entry/trigger node IDs (nodes with no incoming edges and type trigger/backtest) */
  private readonly triggerNodeIds: readonly string[];
  /** Immediate downstream targets of trigger nodes — execution starts here */
  private readonly downstreamEntryIds: string[];

  constructor(
    private readonly workflowId: string,
    private readonly userId: string,
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    executionId?: string,
  ) {
    this.executionId = executionId ?? "";
    this.streamRedisClient = createDedicatedStreamConnection(
      `Strategy-${workflowId}`,
    );
    this.streamKey = RedisKeys.strategyStream(userId, workflowId);
    this.abortController = new AbortController();
    this.consumerName = `consumer-${workflowId}-${this.executionId}`;
    this.serializedSnapshot = {
      nodes: JSON.stringify(nodes),
      edges: JSON.stringify(edges),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
    this.engine = new WorkflowEngine(
      this.executionId,
      workflowId,
      userId,
      nodes,
      edges,
      "best-effort",
      this.abortController.signal,
      "live",
    );

    // Cache trigger node IDs and their downstream targets at build time
    const graph = this.engine.getGraph();
    this.triggerNodeIds = graph.entryNodeIds;
    const downstreamSet = new Set<string>();
    for (const triggerId of this.triggerNodeIds) {
      for (const edge of graph.getOutgoingEdges(triggerId)) {
        downstreamSet.add(edge.target);
      }
    }
    this.downstreamEntryIds = [...downstreamSet];
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.ensureConsumerGroup();
    await this.reclaimPendingMessages();
    this.startConsolidatorScanTimer();
    await this.pollLoop();
  }

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.streamRedisClient.xgroup(
        "CREATE",
        this.streamKey,
        STRATEGY_GROUP,
        "0",
        "MKSTREAM",
      );
    } catch (err: any) {
      // BUSYGROUP = group already exists, safe to ignore
      if (!err?.message?.includes("BUSYGROUP")) throw err;
    }
  }

  private async reclaimPendingMessages(): Promise<void> {
    try {
      const claimed = await (this.streamRedisClient as any).xautoclaim(
        this.streamKey,
        STRATEGY_GROUP,
        this.consumerName,
        AUTOCLAIM_IDLE_MS,
        "0-0",
        "COUNT",
        POLL_BATCH_SIZE,
      );

      // xautoclaim returns [nextStartId, [[id, fields], ...], deletedIds]
      const messages = claimed?.[1];
      if (!messages?.length) return;

      const parsed = this.parseAndSortMessages(messages);

      for (const item of parsed) {
        if (!this.running) break;
        await this.processMessage(item.messageId, item.fields);
      }
    } catch (err) {
      // XAUTOCLAIM may not be supported on older Redis; log and continue
      console.warn(
        "[WorkflowRunner] XAUTOCLAIM failed (non-fatal):",
        (err as Error).message,
      );
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      let results: [string, [string, string[]][]][] | null = null;

      try {
        results = (await (this.streamRedisClient as any).xreadgroup(
          "GROUP",
          STRATEGY_GROUP,
          this.consumerName,
          "BLOCK",
          String(POLL_BLOCK_MS),
          "COUNT",
          String(POLL_BATCH_SIZE),
          "STREAMS",
          this.streamKey,
          ">",
        )) as [string, [string, string[]][]][] | null;
      } catch (err) {
        if (!this.running) break;
        console.warn(
          "[WorkflowRunner] XREADGROUP error (retrying):",
          (err as Error).message,
        );
        await this.sleep(TRANSIENT_BACKOFF_MS);
        continue;
      }

      if (!results?.length) continue;

      for (const [, messages] of results) {
        const parsed = this.parseAndSortMessages(messages);

        for (const item of parsed) {
          if (!this.running) break;
          await this.processMessage(item.messageId, item.fields);
        }
      }
    }
  }

  private async processMessage(
    messageId: string,
    fields: string[],
  ): Promise<void> {
    return this.enqueueWork(() => this.processMessageInternal(messageId, fields));
  }

  private async processMessageInternal(
    messageId: string,
    fields: string[],
  ): Promise<void> {
    // Phase 1: Extract payload — permanent failure if missing
    const rawPayload = this.extractPayload(fields);
    if (!rawPayload) {
      await this.ack(messageId);
      return;
    }

    // Phase 2: Parse envelope — permanent failure if invalid JSON
    let envelope: StreamEventEnvelope;
    try {
      envelope = this.parseEnvelope(rawPayload);
    } catch {
      console.warn(
        "[WorkflowRunner] Invalid JSON, discarding message:",
        messageId,
      );
      await this.ack(messageId);
      return;
    }

    // Phase 3: Create run record — transient failure, do NOT ack
    const runId = randomUUID();
    try {
      await createRunInRedis(
        this.userId,
        this.workflowId,
        runId,
        {
          nodes: this.serializedSnapshot.nodes,
          edges: this.serializedSnapshot.edges,
          node_count: this.serializedSnapshot.nodeCount,
          edge_count: this.serializedSnapshot.edgeCount,
          source: "stream",
        },
        this.executionId,
      );
    } catch (err) {
      console.warn(
        "[WorkflowRunner] createRunInRedis failed (will retry):",
        (err as Error).message,
      );
      return; // No ack — message stays pending for reclaim
    }

    // Phase 4: Execute workflow — skip trigger, start from downstream
    this.engine.resetForNextBar(true);
    this.engine.setRunId(runId);

    // Preload trigger node results with actual stream data so downstream
    // nodes can reference them (e.g. $('OnBar').json.data)
    const triggerOutput = { success: true, data: envelope.data };
    const preload: Record<string, any> = {};
    for (const triggerId of this.triggerNodeIds) {
      preload[triggerId] = triggerOutput;
    }
    this.engine.preloadResults(preload);

    try {
      // Execute from downstream nodes only — trigger executors are skipped
      const executionResult = await this.engine.executeFromEntries(
        { data: envelope.data },
        this.downstreamEntryIds,
      );

      // Phase 5a: Record success
      await this.recordSuccess(runId, executionResult, messageId);
    } catch (error) {
      // Phase 5b: Record failure (execution failed — not retryable)
      await this.recordFailure(runId, error);
    }

    // Phase 6: Ack
    await this.ack(messageId);
  }

  private enqueueWork(work: () => Promise<void>): Promise<void> {
    const next = this.workChain.then(work, work);
    this.workChain = next.catch(() => undefined);
    return next;
  }

  private startConsolidatorScanTimer(): void {
    if (process.env.ENABLE_CONSOLIDATOR_SCAN !== "true") return;
    const intervalMs = this.positiveEnv("CONSOLIDATOR_SCAN_INTERVAL_MS", 1_000);
    // This default is deliberately conservative; production deployments should
    // set it from the measured tail latency of their market-data feed.
    const graceMs = this.positiveEnv("CONSOLIDATOR_SCAN_GRACE_MS", 60_000, true);
    const scheduleNext = (): void => {
      if (!this.running) return;
      this.scanTimer = setTimeout(() => {
        void this.enqueueWork(() => this.processConsolidatorScan(new Date(), graceMs))
          .catch((error) => console.error("[WorkflowRunner] Consolidator scan failed:", error))
          .finally(scheduleNext);
      }, intervalMs);
    };
    scheduleNext();
  }

  private positiveEnv(name: string, fallback: number, allowZero = false): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : fallback;
  }

  private async processConsolidatorScan(scanTime: Date, graceMs: number): Promise<void> {
    consolidatorScansCounter.inc();
    const stopTimer = consolidatorScanLatencyHistogram.startTimer();
    let emissions: ConsolidatorEmission[];
    try {
      emissions = scanConsolidators(this.engine.getDataContext(), scanTime, { commit: false, graceMs });
    } finally {
      stopTimer();
    }
    if (emissions.length === 0) return;
    const deliveredIds = await findDeliveredEmissionIds(
      this.userId,
      this.executionId,
      emissions.map((emission) => emission.emissionId),
    );
    if (deliveredIds.size > 0) {
      const alreadyDelivered = emissions.filter((emission) => deliveredIds.has(emission.emissionId));
      commitConsolidatorEmissions(this.engine.getDataContext(), alreadyDelivered);
      emissions = emissions.filter((emission) => !deliveredIds.has(emission.emissionId));
    }
    if (emissions.length === 0) return;
    consolidatorEmissionsCounter.inc(emissions.length);
    const runId = randomUUID();
    await createRunInRedis(this.userId, this.workflowId, runId, {
      nodes: this.serializedSnapshot.nodes,
      edges: this.serializedSnapshot.edges,
      node_count: this.serializedSnapshot.nodeCount,
      edge_count: this.serializedSnapshot.edgeCount,
      source: "consolidator_scan",
    }, this.executionId);
    this.engine.setRunId(runId);
    try {
      const result = await this.engine.executeInjectedResults(
        emissions,
        async (delivered) => {
          await recordDeliveredEmissions(
            this.userId,
            this.executionId,
            delivered.map((emission) => emission.emissionId),
          );
          commitConsolidatorEmissions(this.engine.getDataContext(), delivered);
        },
      );
      if (result.success) {
        await this.recordSuccess(runId, result, "consolidator_scan");
      } else {
        consolidatorDownstreamFailuresCounter.inc();
        await updateRunStatusInRedis(this.userId, runId, "failed", result);
      }
    } catch (error) {
      consolidatorDownstreamFailuresCounter.inc();
      await this.recordFailure(runId, error);
    }
  }

  private parseAndSortMessages(
    messages: [string, string[]][],
  ): StreamMessageWithSequence[] {
    // Secondary ordering safety only:
    // subscriber ingress serializes per workflow+orderingDomain before XADD.
    // This sort protects reclaimed/mixed batches and malformed edge cases.
    const parsed = messages.map(([messageId, fields], index) => {
      const rawPayload = this.extractPayload(fields);
      let seq = 0;
      let orderingDomain = "unknown";

      if (rawPayload) {
        try {
          const parsedEnvelope = this.parseEnvelope(rawPayload);
          if (
            parsedEnvelope.data &&
            typeof parsedEnvelope.data === "object" &&
            "_seq" in parsedEnvelope.data
          ) {
            const value = (parsedEnvelope.data as { _seq?: unknown })._seq;
            seq = typeof value === "number" ? value : 0;
          }
          if (
            parsedEnvelope.data &&
            typeof parsedEnvelope.data === "object" &&
            "_orderingDomain" in parsedEnvelope.data
          ) {
            const value = (parsedEnvelope.data as { _orderingDomain?: unknown })
              ._orderingDomain;
            orderingDomain = typeof value === "string" ? value : "unknown";
          }
        } catch {
          seq = 0;
          orderingDomain = "unknown";
        }
      }

      return { messageId, fields, seq, orderingDomain, index };
    });

    parsed.sort((a, b) => {
      if (a.orderingDomain !== b.orderingDomain) {
        return a.index - b.index;
      }
      return a.seq - b.seq;
    });

    return parsed;
  }

  private extractPayload(fields: string[]): string | undefined {
    const idx = fields.findIndex((f) => f === "event");
    return idx >= 0 ? fields[idx + 1] : undefined;
  }

  private parseEnvelope(raw: string): StreamEventEnvelope {
    const parsed = JSON.parse(raw);
    // Normalize: if parsed has a data property, use it as-is; otherwise wrap
    if (parsed && typeof parsed === "object" && "data" in parsed) {
      return parsed as StreamEventEnvelope;
    }
    return { data: parsed };
  }

  private async recordSuccess(
    runId: string,
    executionResult: WorkflowExecutionResult,
    messageId: string,
  ): Promise<void> {
    try {
      await updateRunStatusInRedis(
        this.userId,
        runId,
        "success",
        executionResult,
      );
    } catch (err) {
      console.warn(
        "[WorkflowRunner] recordSuccess failed:",
        (err as Error).message,
      );
    }
  }

  private async recordFailure(runId: string, error: unknown): Promise<void> {
    try {
      await updateRunStatusInRedis(this.userId, runId, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } catch (err) {
      console.warn(
        "[WorkflowRunner] recordFailure failed:",
        (err as Error).message,
      );
    }
    console.error("[WorkflowRunner] Execution error:", error);
  }

  private async ack(messageId: string): Promise<void> {
    try {
      await this.streamRedisClient.xack(
        this.streamKey,
        STRATEGY_GROUP,
        messageId,
      );
    } catch (err) {
      console.warn(
        "[WorkflowRunner] ACK failed for",
        messageId,
        ":",
        (err as Error).message,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.scanTimer) clearTimeout(this.scanTimer);
    await this.workChain;
    this.abortController.abort();
    this.engine.destroy();
    PortfolioManager.removeInstance(this.userId, this.executionId);
    await this.cleanupRunnerKeys();
    await this.streamRedisClient.quit();
  }

  private async cleanupRunnerKeys(): Promise<void> {
    const pattern = RedisKeys.executionPattern(
      this.userId,
      this.workflowId,
      this.executionId,
    );
    let cursor = "0";

    do {
      const [nextCursor, keys] = await this.streamRedisClient.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "200",
      );

      cursor = nextCursor;

      if (keys.length > 0) {
        await this.streamRedisClient.del(...keys);
      }
    } while (cursor !== "0");
  }
}
