import { randomUUID } from "crypto";
import { supabase } from "../../config/supabase";
import logger from "../../utils/logger";
import { stringifyNodeResult } from "../../contracts/nodeResult";
import { createNodeOutcomes, type NodeResultObserver, type WorkflowExecutionResult } from "../../engine/types";
import type { Database } from "../../types/supabase";
import { serializeWorkflowRunResult } from "../../utils/workflowRunResultContract";

const MAX_BATCH_ROWS = 200;
const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RESULT_PART_BYTES = MAX_BATCH_BYTES / 2; // Base64 expands each part by a third.

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
  private readonly emptyBatchBytes: number;
  private batchBytes: number;
  private writeError?: Error;

  get failure(): Error | undefined {
    return this.writeError;
  }

  constructor(
    private readonly parentRunId: string,
    private readonly workflowId: string,
    private readonly userId: string,
  ) {
    this.emptyBatchBytes = Buffer.byteLength(JSON.stringify({ p_run_id: parentRunId, p_rows: [] }));
    this.batchBytes = this.emptyBatchBytes;
  }

  async record(
    barIndex: number, symbol: string, barTime: string, capture: BacktestBarCapture,
    status: BarStatus, error?: WorkflowExecutionResult["error"],
  ): Promise<void> {
    if (this.failure) return;
    try {
      const row: BarRow = {
        id: randomUUID(),
        workflow_id: this.workflowId,
        initiated_by: this.userId,
        parent_run_id: this.parentRunId,
        bar_sequence: this.sequence++,
        bar_index: barIndex,
        bar_symbol: symbol.toUpperCase(),
        bar_time: barTime,
        started_at: capture.startedAt,
        completed_at: new Date().toISOString(),
        status,
        result: capture.result(status, error),
        error_message: error?.message ?? null,
      };
      const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 1; // separator
      if (this.batchBytes + rowBytes > MAX_BATCH_BYTES) await this.flush();
      if (this.failure) return;
      if (this.emptyBatchBytes + rowBytes > MAX_BATCH_BYTES) {
        await this.writeLargeResult(row);
        return;
      }
      this.rows.push(row);
      this.batchBytes += rowBytes;
      if (this.rows.length >= MAX_BATCH_ROWS) await this.flush();
    } catch (error) {
      this.recordFailure(error);
    }
  }

  private async writeLargeResult(row: BarRow): Promise<void> {
    const { result, error_message: _errorMessage, ...metadata } = row;
    const payload = Buffer.from(JSON.stringify(result));
    const writePart = (index: number, data: string | null, final: boolean) => {
      const args = { p_row: metadata, p_part_index: index, p_payload: data, p_final: final };
      if (Buffer.byteLength(JSON.stringify(args)) > MAX_BATCH_BYTES) {
        throw new Error("Backtest bar history metadata exceeds the request limit");
      }
      return supabase.schema("public").rpc("write_backtest_bar_result_part", args).abortSignal(AbortSignal.timeout(15_000));
    };

    try {
      for (let offset = 0; offset < payload.length; offset += RESULT_PART_BYTES) {
        const end = Math.min(offset + RESULT_PART_BYTES, payload.length);
        const part = payload.toString("base64", offset, end);
        await writeWithRetry(() => writePart(offset / RESULT_PART_BYTES, part, end === payload.length));
      }
    } catch (error) {
      try {
        const { error: cleanupError } = await writePart(0, null, false);
        if (cleanupError) throw new Error(cleanupError.message);
      } catch (cleanupError) {
        logger.warn({ err: cleanupError, runId: this.parentRunId }, "Could not clean up incomplete bar result");
      }
      throw error;
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
    this.batchBytes = this.emptyBatchBytes;

    try {
      await writeWithRetry(() => supabase.schema("public").rpc("write_backtest_bar_batch", {
        p_run_id: this.parentRunId, p_rows: rows,
      }).abortSignal(AbortSignal.timeout(15_000)));
    } catch (error) {
      this.recordFailure(error);
    }
  }
}
