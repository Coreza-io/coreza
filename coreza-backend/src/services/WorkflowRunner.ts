import { isPersistentVariableEdit, referencesVariables } from "../variables/contract";
import { withLiveRedis } from "../variables/LiveVariableProtocol";
import { FillSyncWorker } from "../workers/FillSyncWorker";
import { LiveStrategiesRepository } from "../repositories/LiveStrategiesRepository";
import { resultSuccess } from "../contracts/nodeResult";
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
import { LIVE_TIMING_ENABLED, timingNow, liveEventKind, observeStage, observeLive, observeEpoch, countLive, liveStage, liveQueueDelay, liveExecution, liveRunnerCycle, liveReceiptToDecision, type LiveTimingEnvelope, type LiveExecutionTiming } from "../utils/liveTiming";

const STRATEGY_GROUP = "strategy-group";
const AUTOCLAIM_IDLE_MS = 60_000; // 60s idle threshold for reclaiming
const POLL_BLOCK_MS = 5_000;
const POLL_BATCH_SIZE = 10;
const TRANSIENT_BACKOFF_MS = 1_000;

interface StreamEventEnvelope {
  _timing?: LiveTimingEnvelope;
  type?: string;
  data: unknown;
  timestamp?: string;
  symbol?: string;
}

interface StreamMessageWithSequence {
  batchReceivedAt?: number;
  messageId: string;
  fields: string[];
  payload:
    | { status: "valid"; envelope: StreamEventEnvelope }
    | { status: "missing" | "invalid" };
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
  private activeMessage?: Promise<void>;
  private stopTask?: Promise<void>;
  private stopIncomplete = false;
  private readonly usesVariables: boolean;
  get runnerInstanceId(): string { return this.executionId; }
  get requiresRecovery(): boolean { return this.stopIncomplete || this.engine.variableSafetyStop; }
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
    this.usesVariables = referencesVariables(nodes.map(node => node.values)) || nodes.some(isPersistentVariableEdit);
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
    this.engine.setVariableSafetyStopHandler(() => {
      // Retain pending source events and ownership for approved recovery.
      void LiveStrategiesRepository.setStatus(this.executionId, userId, workflowId, "failed", "Strategy paused for live variable recovery")
        .catch(error => console.error("Failed to record activation safety stop", error));
      this.running = false;
      this.abortController.abort();
    });

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
    await this.initialize();
    if (this.abortController.signal.aborted) throw new Error("Strategy startup cancelled");
    this.running = true;

    await this.ensureConsumerGroup();
    await this.reclaimPendingMessages();
    await this.pollLoop();
  }

  initialize(): Promise<void> { return this.engine.initialize(); }

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
        await this.processMessage(item);
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
      let batchReceivedAt = 0;
      const readStartedAt = timingNow();
      let readOutcome = "error";

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
        batchReceivedAt = timingNow();
        readOutcome = results?.length ? "data" : "idle";
      } catch (err) {
        if (!this.running) break;
        console.warn(
          "[WorkflowRunner] XREADGROUP error (retrying):",
          (err as Error).message,
        );
        await this.sleep(TRANSIENT_BACKOFF_MS);
        continue;
      } finally {
        observeStage("stream_read", readStartedAt, readOutcome);
      }

      if (!results?.length) continue;

      for (const [, messages] of results) {
        const parsed = this.parseAndSortMessages(messages, batchReceivedAt);

        for (const item of parsed) {
          if (!this.running) break;
          await this.processMessage(item);
        }
      }
    }
  }

  private async processMessage(
    message: StreamMessageWithSequence,
  ): Promise<void> {
    const ingress = message.payload.status === "valid" ? message.payload.envelope._timing : undefined;
    const timing: LiveExecutionTiming | undefined = LIVE_TIMING_ENABLED ? {
      eventKind: liveEventKind(ingress?.eventKind ?? (message.payload.status === "valid" ? (message.payload.envelope.data as any)?.type : undefined)),
      startedAt: timingNow(), executionStartedAt: 0, executionStartedEpoch: 0, ingress, submitted: false, outcome: "error",
    } : undefined;
    if (timing && message.batchReceivedAt !== undefined) observeStage("consumer_batch_wait", message.batchReceivedAt);
    try {
      try { this.engine.assertVariableAdmission(); }
      catch {
        if (timing) timing.outcome = "admission_blocked";
        this.running = false;
        return; // Safety stops retain the pending source event.
      }
      const task = this.executeMessage(message, timing);
      this.activeMessage = task;
      try { await task; } finally { if (this.activeMessage === task) this.activeMessage = undefined; }
    } finally {
      if (timing) {
        observeLive(liveRunnerCycle, { event_kind: timing.eventKind, outcome: timing.outcome }, (timingNow() - timing.startedAt) / 1000);
        countLive("runner", timing.outcome);
      }
    }
  }

  private async executeMessage({ messageId, payload }: StreamMessageWithSequence, timing?: LiveExecutionTiming): Promise<void> {
    // Phase 1: Missing payload — permanent failure
    if (payload.status === "missing") {
      if (timing) timing.outcome = "missing";
      if (!(await this.ack(messageId)) && timing) timing.outcome = "ack_error";
      return;
    }

    // Phase 2: Invalid JSON — discard only after the admission check
    if (payload.status !== "valid") {
      if (timing) timing.outcome = "invalid";
      console.warn(
        "[WorkflowRunner] Invalid JSON, discarding message:",
        messageId,
      );
      if (!(await this.ack(messageId)) && timing) timing.outcome = "ack_error";
      return;
    }
    const envelope = payload.envelope;

    // Phase 3: Create run record — transient failure, do NOT ack
    const runId = randomUUID();
    const admissionStartedAt = timingNow();
    let admissionOutcome = "error";
    try {
      const created = await createRunInRedis(
        this.userId,
        this.workflowId,
        runId,
        {
          nodes: this.serializedSnapshot.nodes,
          edges: this.serializedSnapshot.edges,
          node_count: this.serializedSnapshot.nodeCount,
          edge_count: this.serializedSnapshot.edgeCount,
          source: "stream",
          variable_revision: this.engine.variableRevision,
        },
        this.executionId,
      );
      admissionOutcome = created ? "success" : "command_error";
    } catch (err) {
      if (timing) timing.outcome = "pending";
      console.warn(
        "[WorkflowRunner] createRunInRedis failed (will retry):",
        (err as Error).message,
      );
      return; // No ack — message stays pending for reclaim
    } finally {
      observeStage("run_create", admissionStartedAt, admissionOutcome);
      countLive("run_create", admissionOutcome);
    }

    // Phase 4: Execute workflow — skip trigger, start from downstream
    if (timing) {
      timing.executionStartedEpoch = Date.now();
      timing.executionStartedAt = timingNow();
    }
    try {
      this.engine.resetForNextBar(true);
      // History belongs to this event's run, not the reused engine's lifetime.
      this.engine.clearNodeTiming();
      this.engine.setRunId(runId);
      this.engine.setVariableEventId(`${this.streamKey}:${messageId}`);
      if (timing) this.engine.setLiveTiming(timing);

      // Preload trigger node results with actual stream data so downstream
      // nodes can reference them (e.g. $('OnBar').json.data)
      const triggerOutput = resultSuccess(envelope.data);
      const preload: Record<string, any> = {};
      for (const triggerId of this.triggerNodeIds) {
        preload[triggerId] = triggerOutput;
      }
      this.engine.preloadResults(preload);
    } catch (error) {
      this.observeExecution(timing, messageId);
      throw error; // Preserve the existing pending-event behavior on preparation failure.
    }

    try {
      // Execute from downstream nodes only — trigger executors are skipped
      let executionResult: WorkflowExecutionResult;
      try {
        executionResult = await this.engine.executeFromEntries(
          { data: envelope.data },
          this.downstreamEntryIds,
        );
        if (timing) timing.outcome = executionResult.success ? "success" : executionResult.error?.code === "CANCELLED" ? "cancelled" : "failed";
      } catch (error) {
        if (timing) timing.outcome = this.abortController.signal.aborted && !this.engine.variableSafetyStop ? "cancelled" : "failed";
        throw error;
      } finally {
        this.observeExecution(timing, messageId);
      }

      const recorded = executionResult.success ? await this.recordSuccess(runId, executionResult) : await this.recordFailure(
        runId,
        new Error(executionResult.error?.message ?? "Workflow execution failed"),
        executionResult,
      );
      if (!recorded && timing) timing.outcome = "outcome_error";
    } catch (error) {
      // Phase 5b: Record failure (execution failed — not retryable)
      if (!(await this.recordFailure(runId, error)) && timing) timing.outcome = "outcome_error";
    }

    // Phase 6: Ack
    if (this.engine.variableSafetyStop) { if (timing) timing.outcome = "safety_stop"; this.running = false; return; }
    if (!(await this.ack(messageId)) && timing) {
      timing.outcome = timing.outcome === "outcome_error" ? "outcome_and_ack_error" : "ack_error";
    }
    if (timing?.outcome === "success" && admissionOutcome !== "success") timing.outcome = "admission_error";
  }

  private observeExecution(timing: LiveExecutionTiming | undefined, messageId: string): void {
    if (!timing) return;
    const finishedAt = timingNow();
    const finishedEpoch = Date.now();
    observeLive(liveExecution, { event_kind: timing.eventKind, outcome: timing.outcome }, (finishedAt - timing.executionStartedAt) / 1000);
    observeLive(liveStage, { stage: "runner_admission", outcome: "success" }, (timing.executionStartedAt - timing.startedAt) / 1000);
    observeEpoch(liveQueueDelay, "queue_delay", Number(messageId.split("-", 1)[0]), timing.executionStartedEpoch, timing.eventKind);
    observeEpoch(liveReceiptToDecision, "receipt_to_decision", timing.ingress?.barEligibleAt ?? timing.ingress?.gatewayReceivedAt, finishedEpoch, timing.eventKind, timing.outcome);
  }

  private parseAndSortMessages(
    messages: [string, string[]][],
    batchReceivedAt = timingNow(),
  ): StreamMessageWithSequence[] {
    const parseStartedAt = timingNow();
    // Secondary ordering safety only:
    // subscriber ingress serializes per workflow+orderingDomain before XADD.
    // This sort protects reclaimed/mixed batches and malformed edge cases.
    const parsed = messages.map(([messageId, fields], index) => {
      const rawPayload = this.extractPayload(fields);
      let seq = 0;
      let orderingDomain = "unknown";
      let payload: StreamMessageWithSequence["payload"] = { status: "missing" };

      if (rawPayload) {
        try {
          const parsedEnvelope = this.parseEnvelope(rawPayload);
          payload = { status: "valid", envelope: parsedEnvelope };
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
          payload = { status: "invalid" };
          seq = 0;
          orderingDomain = "unknown";
        }
      }

      return { messageId, fields, payload, seq, orderingDomain, index, batchReceivedAt };
    });

    parsed.sort((a, b) => {
      if (a.orderingDomain !== b.orderingDomain) {
        return a.index - b.index;
      }
      return a.seq - b.seq;
    });

    observeStage("parse_batch", parseStartedAt);
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
  ): Promise<boolean> {
    const startedAt = timingNow();
    let outcome = "error";
    try {
      await updateRunStatusInRedis(
        this.userId,
        runId,
        "success",
        executionResult,
        {
          variableRevision: this.engine.variableRevision,
          variableCheckpoint: this.engine.variableCheckpoint,
        },
      );
      outcome = "success";
    } catch (err) {
      console.warn(
        "[WorkflowRunner] recordSuccess failed:",
        (err as Error).message,
      );
    } finally {
      observeStage("outcome_write", startedAt, outcome);
      countLive("outcome_write", outcome);
    }
    return outcome === "success";
  }

  private async recordFailure(
    runId: string,
    error: unknown,
    executionResult?: WorkflowExecutionResult,
  ): Promise<boolean> {
    const startedAt = timingNow();
    let outcome = "error";
    try {
      // Prefer the finalized outcome over an abort received during indicator flushing.
      const cancelled = !this.engine.variableSafetyStop && (
        executionResult
          ? executionResult.error?.code === "CANCELLED"
          : this.abortController.signal.aborted
      );
      await updateRunStatusInRedis(
        this.userId,
        runId,
        cancelled ? "cancelled" : "failed",
        {
          result: executionResult,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        {
          variableRevision: this.engine.variableRevision,
          variableCheckpoint: this.engine.variableCheckpoint,
        },
      );
      outcome = "success";
    } catch (err) {
      console.warn(
        "[WorkflowRunner] recordFailure failed:",
        (err as Error).message,
      );
    } finally {
      observeStage("outcome_write", startedAt, outcome);
      countLive("outcome_write", outcome);
    }
    console.error("[WorkflowRunner] Execution error:", error);
    return outcome === "success";
  }

  private async ack(messageId: string): Promise<boolean> {
    const startedAt = timingNow();
    let outcome = "error";
    try {
      const acknowledged = await this.streamRedisClient.xack(
        this.streamKey,
        STRATEGY_GROUP,
        messageId,
      );
      outcome = acknowledged > 0 ? "success" : "missing";
    } catch (err) {
      console.warn(
        "[WorkflowRunner] ACK failed for",
        messageId,
        ":",
        (err as Error).message,
      );
    } finally {
      observeStage("ack", startedAt, outcome);
      countLive("ack", outcome);
    }
    return outcome === "success";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopTask = this.stopRunner().catch(error => { this.stopIncomplete = true; this.stopTask = undefined; throw error; });
    return this.stopTask;
  }

  private async stopRunner(): Promise<void> {
    const deadline = performance.now() + 10000;
    this.running = false;
    this.abortController.abort();
    if (this.activeMessage) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.activeMessage, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Strategy stop incomplete: active event has not settled")), 2000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    }
    // This drain deliberately does not use the execution abort signal.
    await this.engine.drainVariables(deadline);
    await FillSyncWorker.flushWorkflow(this.userId, this.workflowId, this.executionId);
    this.engine.destroy();
    PortfolioManager.retireInstance(this.userId, this.executionId);
    await this.cleanupRunnerKeys();
    await this.streamRedisClient.quit();
    if (this.usesVariables) {
      // A successful teardown bounds the interruption marker; incomplete stops retain it.
      await withLiveRedis(client => client.expire(RedisKeys.liveEphemeralActivation(this.userId, this.workflowId, this.executionId), 86400)).catch(() => { /* Retain the marker if expiry cannot be scheduled. */ });
    }
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

