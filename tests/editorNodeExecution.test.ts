import {
  acquireEditorExecutionLock,
  canRenameEditorNodeAction,
  captureEditorNodeActions,
  clearEditorNodeActions,
  executeEditorNode,
  registerEditorNodeAction,
  releaseEditorExecutionLock,
  retireEditorNodeAction,
  syncEditorNodeActionIds,
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

  it("removes stale rename destinations and ignores late effects for retired cluster member IDs", async () => {
    registerEditorNodeAction(sessionId, "hh", async () => ({ nodeId: "hh", status: "success", output: "stale" }));
    registerEditorNodeAction(sessionId, "member", async () => ({ nodeId: "member", status: "success" }));
    syncEditorNodeActionIds(sessionId, [{ id: "member" }]);
    expect(canRenameEditorNodeAction(sessionId, "member", "hh")).toBe(true);
    await expect(executeEditorNode(sessionId, "hh")).resolves.toMatchObject({ status: "failed" });

    syncEditorNodeActionIds(sessionId, [{ id: "hh" }]);
    registerEditorNodeAction(sessionId, "member", async () => ({ nodeId: "member", status: "success", output: "late" }));
    registerEditorNodeAction(sessionId, "hh", async () => ({ nodeId: "hh", status: "success", output: "current" }));
    expect(canRenameEditorNodeAction(sessionId, "hh", "member")).toBe(true);
    await expect(executeEditorNode(sessionId, "member")).resolves.toMatchObject({ status: "failed" });
    await expect(executeEditorNode(sessionId, "hh")).resolves.toMatchObject({ output: "current" });

    // Undo restores the old canonical identity and accepts its new draft-backed action.
    syncEditorNodeActionIds(sessionId, [{ id: "member" }]);
    registerEditorNodeAction(sessionId, "member", async () => ({ nodeId: "member", status: "success", output: "restored" }));
    await expect(executeEditorNode(sessionId, "member")).resolves.toMatchObject({ output: "restored" });
  });

  it("retains unmounted canonical members and still rejects real action collisions", async () => {
    syncEditorNodeActionIds(sessionId, [{ id: "visible" }, { id: "hidden" }]);
    registerEditorNodeAction(sessionId, "hidden", async () => ({ nodeId: "hidden", status: "success", output: "draft" }))();
    syncEditorNodeActionIds(sessionId, [{ id: "hidden" }, { id: "visible" }]);
    expect(canRenameEditorNodeAction(sessionId, "visible", "hidden")).toBe(false);
    expect(captureEditorNodeActions(sessionId, ["hidden"]).actions.has("hidden")).toBe(true);
    await expect(executeEditorNode(sessionId, "hidden")).resolves.toMatchObject({ output: "draft" });
  });

  it("clears canonical membership restrictions with their editor session", async () => {
    syncEditorNodeActionIds(sessionId, [{ id: "before" }]);
    clearEditorNodeActions(sessionId);
    registerEditorNodeAction(sessionId, "after", async () => ({ nodeId: "after", status: "success" }));
    await expect(executeEditorNode(sessionId, "after")).resolves.toMatchObject({ status: "success" });
  });

  it("retires only the old identity during a node rename", async () => {
    registerEditorNodeAction(sessionId, "OnBar", async () => ({ nodeId: "OnBar", status: "success" }));
    expect(canRenameEditorNodeAction(sessionId, "OnBar", "Test")).toBe(true);
    registerEditorNodeAction(sessionId, "Test", async () => ({ nodeId: "Test", status: "success" }));
    retireEditorNodeAction(sessionId, "OnBar");
    await expect(executeEditorNode(sessionId, "OnBar")).resolves.toMatchObject({ status: "failed" });
    await expect(executeEditorNode(sessionId, "Test")).resolves.toMatchObject({ status: "success" });
  });
});
