const from = jest.fn();
jest.mock("../src/config/supabase", () => ({ supabase: { from } }));

import { WorkflowRunRepository } from "../src/workflow/WorkflowRunRepository";

describe("retired per-node SQL history", () => {
  beforeEach(() => from.mockReset());

  it("checks the requested run before returning empty execution history", async () => {
    const repository = new WorkflowRunRepository();
    const status = jest.spyOn(repository, "getRunStatus").mockResolvedValue({ id: "run-1" } as any);

    await expect(repository.getNodeExecutions("workflow-1", "run-1")).resolves.toEqual([]);
    expect(status).toHaveBeenCalledWith("workflow-1", "run-1");
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps inaccessible or mismatched runs rejected", async () => {
    const repository = new WorkflowRunRepository();
    jest.spyOn(repository, "getRunStatus").mockRejectedValue(new Error("Workflow run not found"));

    await expect(repository.getNodeExecutions("workflow-1", "foreign-run")).rejects.toThrow("Workflow run not found");
    expect(from).not.toHaveBeenCalled();
  });

  it("returns a zero count without accessing the retired table", async () => {
    await expect(new WorkflowRunRepository().getNodeExecutionCount("run-1")).resolves.toBe(0);
    expect(from).not.toHaveBeenCalled();
  });
});
