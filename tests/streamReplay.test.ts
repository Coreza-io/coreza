import { createStreamPreviewControls, isNewerStreamEntry, replayStreamPreview, shouldPublishLiveStreamEvent } from "../src/utils/streamReplay";
import ExecutionContext from "../src/utils/executionContext";

const event = (entryId: string, source = "alpaca_crypto") => ({ entryId, source, data: { value: entryId } });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function harness(paused = false) {
  const store = new ExecutionContext();
  store.setNodeData("stream", { isTestListening: true, isStreamPaused: paused,
    testListenWorkflowId: "workflow", testListenSource: "alpaca_crypto", lastStreamEntryId: "100-1" });
  const request = jest.fn().mockResolvedValue({ events: [], hasMore: false });
  const onError = jest.fn();
  const publish = jest.fn((value) => store.setNodeData("stream", { output: value.data, lastStreamEntryId: value.entryId }));
  const boundaries = { next: true, previous: true };
  let mounted = true;
  let sequence = 0;
  const controls = createStreamPreviewControls({ nodeId: "stream", executionStore: store,
    replaySessionRef: { current: 0 }, controlsAreCurrent: () => mounted,
    notifyStoreUpdate: jest.fn(), request, publish, onError,
    newRequestId: () => String(++sequence),
    setCanStepNext: value => { boundaries.next = value; },
    setCanStepPrevious: value => { boundaries.previous = value; },
  });
  return { store, request, publish, onError, boundaries, controls, unmount: () => { mounted = false; } };
}

describe("stream preview controls", () => {
  it("freezes paused output and rejects shared-socket replay, duplicates and older live events", () => {
    const current = { isTestListening: true, lastStreamEntryId: "100-10" };
    expect(shouldPublishLiveStreamEvent(current, false, "100-11")).toBe(true);
    expect(shouldPublishLiveStreamEvent({ ...current, isStreamPaused: true }, false, "100-11")).toBe(false);
    expect(shouldPublishLiveStreamEvent(current, true, "100-11")).toBe(false);
    expect(shouldPublishLiveStreamEvent(current, false, "100-10")).toBe(false);
    expect(shouldPublishLiveStreamEvent(current, false, "100-9")).toBe(false);
    expect(shouldPublishLiveStreamEvent({ ...current, isTestListening: false }, false, "100-11")).toBe(false);
  });
  it("pauses immediately without calling the backend", async () => {
    const h = harness();
    await h.controls.handleTogglePause();
    expect(h.store.getNodeData("stream").isStreamPaused).toBe(true);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("resumes in one click after stepping, and clears the stepping flag", async () => {
    const h = harness(true);
    h.request.mockResolvedValueOnce({ events: [event("100-0")], hasPrevious: false });
    await h.controls.handleStepStream("prev");
    expect(h.store.getNodeData("stream")).toMatchObject({ isStreamPaused: true, isStreamStepping: false, lastStreamEntryId: "100-0" });
    expect(h.boundaries.previous).toBe(false);
    h.request.mockResolvedValueOnce({ events: [event("100-2")], hasMore: false });
    await h.controls.handleTogglePause();
    expect(h.store.getNodeData("stream")).toMatchObject({ isStreamPaused: false, lastStreamEntryId: "100-2" });
    expect(h.request).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "continue", delivery: "response" }));
  });

  it("ignores a delayed resume response after pausing again", async () => {
    const h = harness(true);
    const pending = deferred<any>();
    h.request.mockReturnValueOnce(pending.promise);
    const resume = h.controls.handleTogglePause();
    await h.controls.handleTogglePause();
    pending.resolve({ events: [event("100-2")], hasMore: true, lastEntryId: "100-2" });
    await resume;
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.store.getNodeData("stream").isStreamPaused).toBe(true);
  });

  it("ignores an old step response when Resume supersedes it", async () => {
    const h = harness(true);
    const pending = deferred<any>();
    h.request.mockReturnValueOnce(pending.promise);
    const step = h.controls.handleStepStream("prev");
    await h.controls.handleTogglePause();
    pending.resolve({ events: [event("99-1")], hasPrevious: false });
    await step;
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.store.getNodeData("stream").isStreamPaused).toBe(false);
  });

  it.each(["stop", "clear", "replacement", "unmount"])("rejects replay after %s", async kind => {
    const h = harness(true);
    const pending = deferred<any>();
    h.request.mockReturnValueOnce(pending.promise);
    const step = h.controls.handleStepStream("next");
    if (kind === "stop") h.store.setNodeData("stream", { isTestListening: false });
    if (kind === "clear") h.store.clear();
    if (kind === "replacement") h.store.setNodeData("stream", { streamReplayRequestId: undefined, isStreamStepping: false });
    if (kind === "unmount") h.unmount();
    pending.resolve({ events: [event("100-2")] });
    await step;
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("does not rewind behind live data received during catch-up", async () => {
    const h = harness(true);
    const pending = deferred<any>();
    h.request.mockReturnValueOnce(pending.promise);
    const resume = h.controls.handleTogglePause();
    h.store.setNodeData("stream", { lastStreamEntryId: "200-1", output: "new live value" });
    pending.resolve({ events: [event("100-2")] });
    await resume;
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.store.getNodeData("stream").output).toBe("new live value");
  });

  it("serializes rapid step clicks and allows retry after failure", async () => {
    const h = harness(true);
    const pending = deferred<any>();
    h.request.mockReturnValueOnce(pending.promise);
    const first = h.controls.handleStepStream("next");
    await h.controls.handleStepStream("next");
    expect(h.request).toHaveBeenCalledTimes(1);
    pending.reject(new Error("Network error"));
    await first;
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.store.getNodeData("stream").isStreamStepping).toBe(false);
    await h.controls.handleStepStream("next");
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it("leaves Next available at the tail for future events", async () => {
    const h = harness(true);
    h.request.mockResolvedValueOnce({ events: [], hasNext: false });
    await h.controls.handleStepStream("next");
    expect(h.boundaries.next).toBe(true);
  });

  it("does not replay before receiving the first cursor", async () => {
    const h = harness(true);
    h.store.setNodeData("stream", { lastStreamEntryId: undefined });
    await h.controls.handleTogglePause();
    expect(h.request).not.toHaveBeenCalled();
    expect(h.store.getNodeData("stream").isStreamPaused).toBe(false);
  });
});

describe("stream replay paging", () => {
  it("drains more than five pages and renders only the latest matching event per page", async () => {
    const request = jest.fn(async (cursor: string) => {
      const n = Number(cursor.split("-")[1]) + 1;
      return { events: [event(`100-${n}`, "binance_spot"), event(`100-${n}`, "alpaca_trading")], lastEntryId: `100-${n}`, hasMore: n < 7 };
    });
    const apply = jest.fn();
    await replayStreamPreview({ mode: "continue", afterEntryId: "100-0", isCurrent: () => true, request, apply,
      accepts: value => value.source === "alpaca_trading" });
    expect(request).toHaveBeenCalledTimes(7);
    expect(apply).toHaveBeenCalledTimes(7);
    expect(apply).toHaveBeenLastCalledWith(event("100-7", "alpaca_trading"));
  });

  it("stops when a page does not advance its cursor", async () => {
    const request = jest.fn().mockResolvedValue({ events: [], lastEntryId: "100-0", hasMore: true });
    await replayStreamPreview({ mode: "continue", afterEntryId: "100-0", isCurrent: () => true, request, apply: jest.fn() });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects the old socket-only replay response", async () => {
    await expect(replayStreamPreview({ mode: "next", afterEntryId: "100-0", isCurrent: () => true,
      request: async () => ({ replayed: 1 } as any), apply: jest.fn() })).rejects.toThrow("updated backend");
  });

  it("compares integer Redis ID components without string or floating-point errors", () => {
    expect(isNewerStreamEntry("100-10", "100-9")).toBe(true);
    expect(isNewerStreamEntry("100-2", "100-10")).toBe(false);
    expect(isNewerStreamEntry("100-10", "100-10")).toBe(false);
    expect(isNewerStreamEntry("9007199254740993-0", "9007199254740992-0")).toBe(true);
  });
});
