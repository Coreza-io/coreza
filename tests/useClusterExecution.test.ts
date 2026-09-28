import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

const mockExecutionStore = { setNodeData: jest.fn() };
const mockNotifyStoreUpdate = jest.fn();
jest.mock("@/contexts/ExecutionStoreContext", () => ({
  useExecutionStore: () => mockExecutionStore,
  useExecutionStoreNotify: () => mockNotifyStoreUpdate,
}));
const mockApiClient = { post: jest.fn(), request: jest.fn() };
jest.mock("@/lib/apiClient", () => ({ apiClient: mockApiClient }));

import { useClusterExecution, type ClusterRunState } from "@/hooks/useClusterExecution";

const currentNodeIds = new Set(["member"]);

function response(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("useClusterExecution polling ownership", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });
    if (!globalThis.crypto?.randomUUID) {
      Object.defineProperty(globalThis, "crypto", {
        value: { randomUUID: () => "idempotency" },
        configurable: true,
      });
    }
  });

  afterEach(() => jest.useRealTimers());

  it("waits for an in-flight response and a full interval before polling again", async () => {
    const firstStatus = deferred<Response>();
    mockApiClient.post.mockResolvedValue(response({ run_id: "run", status: "queued" }));
    const request = mockApiClient.request
      .mockImplementationOnce(() => firstStatus.promise)
      .mockResolvedValue(response({
        run: {
          id: "run",
          workflow_id: "workflow",
          status: "running",
          source_workflow_revision: 1,
          scope_cluster_id: "cluster",
          scope_snapshot: { memberNodeIds: ["member"] },
        },
      }));

    let execute!: (clusterId: string) => Promise<void>;
    let getState!: (clusterId: string) => ClusterRunState;
    function Harness() {
      const hook = useClusterExecution({
        workflowSessionId: "session",
        currentNodeIds,
        prepare: async () => ({ workflowId: "workflow", revision: 1, memberNodeIds: ["member"] }),
      });
      execute = hook.executeCluster;
      getState = hook.getState;
      return null;
    }

    let renderer!: ReactTestRenderer;
    act(() => { renderer = create(React.createElement(Harness)); });
    await act(async () => { await execute("cluster"); });
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(5_000); });
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstStatus.resolve(response({
        run: {
          id: "run",
          workflow_id: "workflow",
          status: "running",
          source_workflow_revision: 1,
          scope_cluster_id: "cluster",
          scope_snapshot: { memberNodeIds: ["member"] },
        },
      }));
      await Promise.resolve();
    });
    expect(getState("cluster").phase).toBe("running");

    await act(async () => { jest.advanceTimersByTime(999); });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(1); });
    expect(request).toHaveBeenCalledTimes(2);

    act(() => renderer.unmount());
  });
});
