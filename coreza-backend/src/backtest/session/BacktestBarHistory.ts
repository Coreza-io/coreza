import { randomUUID } from "crypto";
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

  constructor(
    private readonly parentRunId: string,
    private readonly workflowId: string,
    private readonly userId: string,
  ) {}

  async record(
    barIndex: number, symbol: string, barTime: string, capture: BacktestBarCapture,
    status: BarStatus, error?: WorkflowExecutionResult["error"],
  ): Promise<void> {
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
    if (this.rows.length && this.batchBytes + rowBytes > MAX_BATCH_BYTES) await this.flush();
    this.rows.push(row);
    this.batchBytes += rowBytes;
    // Send any single oversized row on its own so its output stays intact.
    if (this.rows.length >= MAX_BATCH_ROWS || this.batchBytes >= MAX_BATCH_BYTES) await this.flush();
  }

  async flush(): Promise<void> {
    if (!this.rows.length) return;
    const rows = this.rows;
    this.rows = [];
    this.batchBytes = 2;

    for (let attempt = 1; ; attempt++) {
      const { error, status } = await supabase.from("workflow_runs")
        .upsert(rows, { onConflict: "parent_run_id,bar_sequence", ignoreDuplicates: true })
        .abortSignal(AbortSignal.timeout(15_000));
      if (!error) return;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500
        || ["40001", "40P01", "55P03"].includes(error.code);
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(`Backtest bar history persistence failed: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 200 * attempt));
    }
  }
}
