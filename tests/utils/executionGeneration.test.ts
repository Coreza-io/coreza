import {
  acceptEditorExecution,
  getEditorExecutionGeneration,
} from "@/utils/executionGeneration";

describe("editor execution generation", () => {
  it("invalidates every previously accepted execution", () => {
    const before = getEditorExecutionGeneration();
    const first = acceptEditorExecution();
    const second = acceptEditorExecution();

    expect(first).toBe(before + 1);
    expect(second).toBe(first + 1);
    expect(getEditorExecutionGeneration()).toBe(second);
  });
});
