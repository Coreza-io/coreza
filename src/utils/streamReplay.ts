import type { NodeExecutionData } from "./executionContext";

export interface StreamReplayEvent {
  entryId: string;
  source?: string;
  data: unknown;
}

export interface StreamReplayPage {
  events?: StreamReplayEvent[];
  lastEntryId?: string | null;
  hasMore?: boolean;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

/** Redis IDs are pairs of integers, not lexicographically ordered strings. */
export function isNewerStreamEntry(candidate: string, current?: string): boolean {
  if (!current) return true;
  if (!/^\d+-\d+$/.test(candidate) || !/^\d+-\d+$/.test(current)) return false;
  const [candidateTime, candidateSequence] = candidate.split("-").map(BigInt);
  const [currentTime, currentSequence] = current.split("-").map(BigInt);
  return candidateTime > currentTime || (candidateTime === currentTime && candidateSequence > currentSequence);
}

/** Shared sockets carry live updates only; replay publication is request-owned. */
export function shouldPublishLiveStreamEvent(
  current: NodeExecutionData,
  isReplay: boolean,
  entryId?: string,
): boolean {
  return current.isTestListening === true && !current.isStreamPaused && !isReplay
    && (!entryId || isNewerStreamEntry(entryId, current.lastStreamEntryId));
}

/** Response delivery keeps replay local to the requesting panel and cancellable. */
export async function replayStreamPreview(options: {
  mode: "continue" | "next" | "prev";
  afterEntryId: string;
  isCurrent: () => boolean;
  request: (cursor: string) => Promise<StreamReplayPage>;
  accepts?: (event: StreamReplayEvent) => boolean;
  apply: (event: StreamReplayEvent) => void;
}): Promise<StreamReplayPage | undefined> {
  let cursor = options.afterEntryId;
  let page: StreamReplayPage | undefined;
  while (options.isCurrent()) {
    page = await options.request(cursor);
    if (!options.isCurrent()) return;
    // Old servers publish replay over WebSocket. Fail closed rather than
    // silently accepting unscoped asynchronous updates from that protocol.
    if (!Array.isArray(page.events)) throw new Error("Stream replay requires the updated backend.");
    // The panel displays one value. Coalesce catch-up instead of rendering
    // every historical tick, while preserving the server's scan cursor.
    const accepted = page.events.filter(event => !options.accepts || options.accepts(event));
    const event = accepted[accepted.length - 1];
    if (event) options.apply(event);
    const hasMore = options.mode === "continue" ? page.hasMore
      : options.mode === "next" ? page.hasNext : page.hasPrevious;
    // A step may scan a malformed or filtered entry without displaying it.
    // Keep scanning from the server cursor instead of repeating that entry.
    if ((options.mode !== "continue" && event) || !hasMore
      || !page.lastEntryId || page.lastEntryId === cursor) return page;
    cursor = page.lastEntryId;
  }
  return page;
}

/** Owns pause/step transitions independently of React render timing. */
export function createStreamPreviewControls(options: {
  nodeId: string | null;
  workflowId?: string;
  executionStore: {
    getNodeData: (id: string) => NodeExecutionData;
    setNodeData: (id: string, data: Partial<NodeExecutionData>) => void;
  };
  replaySessionRef: { current: number };
  controlsAreCurrent: () => boolean;
  notifyStoreUpdate: () => void;
  request: (body: { workflowId: string; nodeId: string; afterEntryId: string; mode: "continue" | "next" | "prev"; delivery: "response" }) => Promise<StreamReplayPage>;
  publish: (event: StreamReplayEvent, isCurrent: () => boolean) => void;
  setCanStepNext: (value: boolean) => void;
  setCanStepPrevious: (value: boolean) => void;
  newRequestId?: () => string;
  onError?: (error: unknown) => void;
}) {
  const { nodeId, workflowId, executionStore, replaySessionRef, controlsAreCurrent,
    notifyStoreUpdate, request, publish, setCanStepNext, setCanStepPrevious,
    newRequestId = () => crypto.randomUUID(),
    onError = (error) => console.error("Failed to replay stream events:", error),
  } = options;
  // Replay results return to this panel, never through the user's shared socket.
  const runStreamReplay = async (mode: "continue" | "next" | "prev") => {
    if (!nodeId || !controlsAreCurrent()) return;
    const initial = executionStore.getNodeData(nodeId);
    const activeWorkflowId = initial.testListenWorkflowId || workflowId;
    if (!initial.isTestListening || !activeWorkflowId || !initial.lastStreamEntryId) return;

    const replaySession = ++replaySessionRef.current;
    const requestId = newRequestId();
    executionStore.setNodeData(nodeId, {
      streamReplayRequestId: requestId,
      isStreamStepping: mode !== "continue",
    });
    notifyStoreUpdate();
    const isCurrent = () => {
      const current = executionStore.getNodeData(nodeId);
      return controlsAreCurrent() && replaySessionRef.current === replaySession
        && current.isTestListening === true && current.streamReplayRequestId === requestId
        && current.isStreamPaused === (mode !== "continue");
    };
    try {
      const page = await replayStreamPreview({
        mode,
        afterEntryId: initial.lastStreamEntryId,
        isCurrent,
        request: async (cursor) => {
          return request({ workflowId: activeWorkflowId, nodeId, afterEntryId: cursor, mode, delivery: "response" });
        },
        accepts: (event) => !initial.testListenSource || !event.source
          || initial.testListenSource.split("_")[0].toLowerCase() === event.source.split("_")[0].toLowerCase(),
        apply: (event: StreamReplayEvent) => {
          const current = executionStore.getNodeData(nodeId);
          // Live events may arrive during catch-up. Never rewind behind them.
          if (mode === "continue" && !isNewerStreamEntry(event.entryId, current.lastStreamEntryId)) return;
          publish(event, isCurrent);
        },
      });
      if (!isCurrent() || !page) return;
      // Next remains available at the live tail: new events can arrive later.
      setCanStepNext(true);
      if (mode === "prev") setCanStepPrevious(page.hasPrevious !== false);
      else if (page.events?.length) setCanStepPrevious(true);
    } catch (error) {
      if (isCurrent()) onError(error);
    } finally {
      if (isCurrent()) {
        executionStore.setNodeData(nodeId, { isStreamStepping: false, streamReplayRequestId: undefined });
        notifyStoreUpdate();
      }
    }
  };

  const handleTogglePause = async () => {
    if (!nodeId || !controlsAreCurrent()) return;
    const current = executionStore.getNodeData(nodeId);
    if (!current.isTestListening) return;
    // A stepped stream is paused too. One click always resumes it.
    const resume = current.isStreamPaused === true;
    replaySessionRef.current += 1;
    executionStore.setNodeData(nodeId, {
      isStreamPaused: !resume,
      isStreamStepping: false,
      streamReplayRequestId: undefined,
    });
    setCanStepNext(true);
    setCanStepPrevious(true);
    notifyStoreUpdate();
    if (resume) await runStreamReplay("continue");
  };

  const handleStepStream = async (mode: "next" | "prev") => {
    if (!nodeId || !controlsAreCurrent()) return;
    const current = executionStore.getNodeData(nodeId);
    if (!current.isTestListening || !current.lastStreamEntryId || current.isStreamStepping) return;
    replaySessionRef.current += 1;
    executionStore.setNodeData(nodeId, { isStreamPaused: true, isStreamStepping: false, streamReplayRequestId: undefined });
    notifyStoreUpdate();
    await runStreamReplay(mode);
  };

  return { handleTogglePause, handleStepStream };
}
