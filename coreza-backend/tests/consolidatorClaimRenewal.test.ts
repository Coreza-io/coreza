const claimEmissionBatch = jest.fn(async (..._args: unknown[]) => true);
const renewEmissionClaim = jest.fn(async (..._args: unknown[]) => true);
const markEmissionDelivered = jest.fn(async (..._args: unknown[]) => true);
const releaseEmissionClaim = jest.fn(async (..._args: unknown[]) => true);
const emission = {
  nodeId: "consolidator",
  emissionId: "execution:consolidator:SPY:2026-01-01",
  payload: { symbol: "SPY", bar: { endTimestamp: "2026-01-01T00:00:00Z" } },
  pendingCommit: {},
};
const commitConsolidatorEmissions = jest.fn();

jest.mock("../src/config/supabase", () => ({ supabase: {} }));
jest.mock("../src/engine", () => ({ WorkflowEngine: jest.fn() }));
jest.mock("../src/engine/consolidation/consolidatorDeliveryReceipt", () => ({
  claimLeaseSeconds: () => 3,
  claimEmissionBatch: (...args: unknown[]) => claimEmissionBatch(...args),
  renewEmissionClaim: (...args: unknown[]) => renewEmissionClaim(...args),
  markEmissionDelivered: (...args: unknown[]) => markEmissionDelivered(...args),
  releaseEmissionClaim: (...args: unknown[]) => releaseEmissionClaim(...args),
  findDeliveredEmissionIds: jest.fn(async () => new Set()),
}));
jest.mock("../src/engine/consolidation/consolidatorScan", () => ({
  scanConsolidators: jest.fn(() => [emission]),
  commitConsolidatorEmissions: (...args: unknown[]) => commitConsolidatorEmissions(...args),
  drainDeliveredConsolidatorEmissions: jest.fn((_context, emissions) => emissions),
}));
jest.mock("../src/utils/redisRunStorage", () => ({
  createRunInRedis: jest.fn(),
  updateRunStatusInRedis: jest.fn(),
}));
jest.mock("../src/utils/metrics", () => ({
  consolidatorDownstreamFailuresCounter: { inc: jest.fn() },
  consolidatorEmissionsCounter: { inc: jest.fn() },
  consolidatorScansCounter: { inc: jest.fn() },
  consolidatorScanLatencyHistogram: { startTimer: jest.fn(() => jest.fn()) },
}));

import { WorkflowRunner } from "../src/services/WorkflowRunner";

describe("consolidator claim renewal", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    process.env.CONSOLIDATOR_BATCH_TIMEOUT_MS = "15000";
    renewEmissionClaim.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.CONSOLIDATOR_BATCH_TIMEOUT_MS;
  });

  function runnerWithExecution(delayMs: number) {
    const abortController = new AbortController();
    const engine = {
      getDataContext: jest.fn(() => ({})),
      setRunId: jest.fn(),
      executeInjectedResults: jest.fn(async (
        emissions: readonly typeof emission[],
        onSuccess: (batch: readonly typeof emission[]) => Promise<void>,
        beforeBatch: (batch: readonly typeof emission[]) => Promise<boolean>,
      ) => {
        if (!(await beforeBatch(emissions))) return { success: true };
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delayMs);
          abortController.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
        if (!abortController.signal.aborted) await onSuccess(emissions);
        return { success: !abortController.signal.aborted };
      }),
    };
    const recordSuccess = jest.fn();
    const recordFailure = jest.fn();
    const runner = Object.create(WorkflowRunner.prototype);
    Object.assign(runner, {
      userId: "user",
      workflowId: "workflow",
      executionId: "execution",
      runnerInstanceId: "runner",
      abortController,
      engine,
      serializedSnapshot: { nodes: "[]", edges: "[]", nodeCount: 0, edgeCount: 0 },
      recordSuccess,
      recordFailure,
    });
    return { runner, abortController, recordSuccess, recordFailure };
  }

  async function processScan(runner: WorkflowRunner): Promise<void> {
    await Reflect.apply(
      Reflect.get(WorkflowRunner.prototype, "processConsolidatorScan"),
      runner,
      [new Date("2026-01-01T00:00:05Z"), 0],
    );
  }

  it("keeps a claim alive while execution exceeds the original lease", async () => {
    const { runner, recordSuccess } = runnerWithExecution(7_000);
    const processing = processScan(runner);
    await jest.advanceTimersByTimeAsync(7_000);
    await processing;

    expect(renewEmissionClaim.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(markEmissionDelivered).toHaveBeenCalledTimes(1);
    expect(commitConsolidatorEmissions).toHaveBeenCalledTimes(1);
    expect(recordSuccess).toHaveBeenCalledTimes(1);
  });

  it("aborts and never commits delivery when renewal loses ownership", async () => {
    renewEmissionClaim.mockResolvedValueOnce(false);
    const { runner, abortController, recordFailure } = runnerWithExecution(7_000);
    const processing = processScan(runner);
    await jest.advanceTimersByTimeAsync(1_000);
    await processing;

    expect(abortController.signal.aborted).toBe(true);
    expect(markEmissionDelivered).not.toHaveBeenCalled();
    expect(commitConsolidatorEmissions).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });

  it("aborts and releases the claim when the batch timeout expires", async () => {
    const { runner, abortController, recordFailure } = runnerWithExecution(20_000);
    const processing = processScan(runner);
    await jest.advanceTimersByTimeAsync(15_000);
    await processing;

    expect(abortController.signal.aborted).toBe(true);
    expect(releaseEmissionClaim).toHaveBeenCalledTimes(1);
    expect(markEmissionDelivered).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });
});
