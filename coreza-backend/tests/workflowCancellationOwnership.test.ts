jest.mock("../src/infra/jobQueue/jobQueueManager", () => ({ bullMqJobQueue: {} }));

import type { IWorkflowJobQueue } from "../src/infra/jobQueue/queueInterface";
import type { WorkflowRepository } from "../src/workflow/WorkflowRepository";
import type { WorkflowRunRepository } from "../src/workflow/WorkflowRunRepository";
import { WorkflowExecutionService } from "../src/workflow/WorkflowExecutionService";

function fixture(cancellation: Awaited<ReturnType<IWorkflowJobQueue["cancelWorkflowRun"]>>) {
  const runRepo = {
    getOwnedRun: jest.fn().mockResolvedValueOnce({
      id: "run",
      status: "running",
      scope_snapshot: { memberNodeIds: ["first", "second"] },
    }).mockResolvedValue({ id: "run", status: "cancelling", scope_snapshot: {} }),
    requestCancellation: jest.fn().mockResolvedValue(undefined),
    finalizeQueuedCancellation: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { cancelWorkflowRun: jest.fn().mockResolvedValue(cancellation) };
  const service = new WorkflowExecutionService(
    {} as WorkflowRepository,
    runRepo as unknown as WorkflowRunRepository,
    queue as unknown as IWorkflowJobQueue,
  );
  return { service, runRepo };
}

describe("workflow cancellation ownership", () => {
  it("leaves an active run cancelling for the worker to finalize", async () => {
    const { service, runRepo } = fixture({ found: true, removedQueued: false, signalledActive: true });
    await expect(service.cancelManualRun("user", "workflow", "run")).resolves.toEqual({
      run_id: "run",
      status: "cancelling",
      cancelled: false,
    });
    expect(runRepo.finalizeQueuedCancellation).not.toHaveBeenCalled();
  });

  it("atomically finalizes a removed queued run with its submitted membership", async () => {
    const { service, runRepo } = fixture({ found: true, removedQueued: true, signalledActive: false });
    await expect(service.cancelManualRun("user", "workflow", "run")).resolves.toEqual({
      run_id: "run",
      status: "cancelled",
      cancelled: true,
    });
    expect(runRepo.finalizeQueuedCancellation).toHaveBeenCalledWith("run", ["first", "second"]);
  });
});
