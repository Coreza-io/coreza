import {
  acquireEditorExecutionLock,
  captureEditorNodeActions,
  clearEditorNodeActions,
  executeEditorNode,
  registerEditorNodeAction,
  releaseEditorExecutionLock,
} from "@/services/editorNodeExecution";

describe("editor node execution service", () => {
  const sessionId = "editor-session";

  afterEach(() => clearEditorNodeActions(sessionId));

  it("retains the latest draft-backed action when its visual host unmounts", async () => {
    registerEditorNodeAction(sessionId, "node", async () => ({
      nodeId: "node",
      status: "success",
      output: { draft: "latest" },
    }))();

    await expect(executeEditorNode(sessionId, "node")).resolves.toMatchObject({
      status: "success",
      output: { draft: "latest" },
    });
  });

  it("captures actions atomically and rejects conflicting individual execution", async () => {
    registerEditorNodeAction(sessionId, "node", async () => ({ nodeId: "node", status: "success" }));
    const snapshot = captureEditorNodeActions(sessionId, ["node"]);
    const lock = acquireEditorExecutionLock(sessionId);
    expect(lock).not.toBeNull();
    if (!lock) throw new Error("Expected the editor lock to be acquired");

    await expect(executeEditorNode(sessionId, "node")).resolves.toMatchObject({
      status: "failed",
      reason: "Another editor execution is active.",
    });
    await expect(snapshot.execute("node", { lockToken: lock })).resolves.toMatchObject({ status: "success" });
    releaseEditorExecutionLock(sessionId, lock);
  });

  it("rejects a missing action while capturing, before execution can begin", () => {
    expect(() => captureEditorNodeActions(sessionId, ["missing"])).toThrow("not available");
  });

  it("rejects execution outside the allowed member scope", async () => {
    registerEditorNodeAction(sessionId, "node", async () => ({ nodeId: "node", status: "success" }));
    await expect(executeEditorNode(sessionId, "node", { allowedNodeIds: new Set(["other"]) })).resolves.toMatchObject({
      status: "failed",
      error: { message: expect.stringContaining("outside the allowed execution scope") },
    });
  });

  it("acquires the session lock for individual execution and rejects overlap", async () => {
    let release!: () => void;
    registerEditorNodeAction(sessionId, "node", () => new Promise((resolve) => {
      release = () => resolve({ nodeId: "node", status: "success" });
    }));

    const running = executeEditorNode(sessionId, "node");
    expect(acquireEditorExecutionLock(sessionId)).toBeNull();
    release();
    await expect(running).resolves.toMatchObject({ status: "success" });
    expect(acquireEditorExecutionLock(sessionId)).not.toBeNull();
  });

  it("fences captured actions after their owner lock is released", async () => {
    registerEditorNodeAction(sessionId, "node", async () => ({ nodeId: "node", status: "success" }));
    const snapshot = captureEditorNodeActions(sessionId, ["node"]);
    const lock = acquireEditorExecutionLock(sessionId);
    if (!lock) throw new Error("Expected lock");
    releaseEditorExecutionLock(sessionId, lock);
    await expect(snapshot.execute("node", { lockToken: lock })).resolves.toMatchObject({ status: "failed" });
  });
});
