import { v5 as uuidv5 } from "uuid";
import { supabase } from "../../config/supabase";
import { stringifyNodeResult } from "../../contracts/nodeResult";
import { createNodeOutcomes, type NodeResultObserver, type WorkflowExecutionResult } from "../../engine/types";
import type { Database } from "../../types/supabase";
import { serializeWorkflowRunResult } from "../../utils/workflowRunResultContract";

const MAX_BATCH_ROWS = 200;
const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 3;

type BarRow = Database["public"]["Tables"]["workflow_runs"]["Insert"];
type BarStatus = "success" | "failed" | "cancelled";

async function writeWithRetry(
  write: () => PromiseLike<{ status: number; error: { code: string; message: string } | null }>,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const { error, status } = await write();
    if (!error) return;
    const retryable = status === 0 || status === 408 || status === 429 || status >= 500
      || ["40001", "40P01", "55P03"].includes(error.code);
    if (!retryable || attempt >= MAX_ATTEMPTS) throw new Error(error.message);
    await new Promise(resolve => setTimeout(resolve, 200 * attempt));
  }
}

export class BacktestBarCapture {
  readonly startedAt = new Date().toISOString();
  private readonly nodeResults: WorkflowExecutionResult["nodeResults"] = Object.create(null);
  private readonly executionOrder: string[] = [];
  private readonly timing: NonNullable<WorkflowExecutionResult["timing"]> = Object.create(null);

  readonly observe: NodeResultObserver = (nodeId, result, elapsedMs) => {
    // Executors can mutate and return the same object on a later invocation.
    this.nodeResults[nodeId] = JSON.parse(stringifyNodeResult(result));
    this.executionOrder.push(nodeId);
    const totalMs = (this.timing[nodeId]?.totalMs ?? 0) + elapsedMs;
    const count = (this.timing[nodeId]?.count ?? 0) + 1;
    this.timing[nodeId] = { totalMs, count, avgMs: totalMs / count };
  };

  result(status: BarStatus, error?: WorkflowExecutionResult["error"]): WorkflowExecutionResult {
    return serializeWorkflowRunResult({
      success: status === "success",
      resultFinalized: true,
      nodeResults: this.nodeResults,
      executionOrder: this.executionOrder,
      nodeOutcomes: createNodeOutcomes(Object.keys(this.nodeResults), this.nodeResults, "skipped"),
      timing: this.timing,
      error,
    });
  }
}

export class BacktestBarHistory {
  private sequence = 0;
  private rows: BarRow[] = [];
  private batchBytes = 2; // JSON array brackets
  private writeError?: Error;

  get failure(): Error | undefined {
    return this.writeError;
  }

  constructor(
    private readonly parentRunId: string,
    private readonly workflowId: string,
    private readonly userId: string,
  ) {}

  async record(
    barIndex: number, symbol: string, barTime: string, capture: BacktestBarCapture,
    status: BarStatus, error?: WorkflowExecutionResult["error"],
  ): Promise<void> {
    if (this.failure) return;
    try {
      const sequence = this.sequence++;
      const row: BarRow = {
        id: uuidv5(`backtest-bar:${sequence}`, this.parentRunId),
        workflow_id: this.workflowId,
        initiated_by: this.userId,
        scope_snapshot: {
          backtestParentRunId: this.parentRunId,
          backtestBarSequence: sequence,
          backtestBarIndex: barIndex,
          backtestBarSymbol: symbol.toUpperCase(),
          backtestBarTime: barTime,
        },
        started_at: capture.startedAt,
        completed_at: new Date().toISOString(),
        status,
        result: capture.result(status, error),
        error_message: error?.message ?? null,
      };
      const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1; // separator
      if (this.batchBytes + rowBytes > MAX_BATCH_BYTES) await this.flush();
      if (this.failure) return;
      this.rows.push(row);
      this.batchBytes += rowBytes;
      // Send an oversized result by itself through the regular execution-history write path.
      if (this.rows.length >= MAX_BATCH_ROWS || this.batchBytes >= MAX_BATCH_BYTES) await this.flush();
    } catch (error) {
      this.recordFailure(error);
    }
  }

  private recordFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.writeError ??= new Error(`Backtest bar history persistence failed: ${message}`, { cause: error });
  }

  async flush(): Promise<void> {
    if (!this.rows.length) return;
    const rows = this.rows;
    this.rows = [];
    this.batchBytes = 2;

    try {
      await writeWithRetry(() => supabase.schema("public").from("workflow_runs")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
        .abortSignal(AbortSignal.timeout(15_000)));
    } catch (error) {
      this.recordFailure(error);
    }
  }
}
