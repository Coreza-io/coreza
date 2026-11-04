/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import type { MutableRefObject } from "react";
import type { Node } from "@xyflow/react";
import ExecutionContext from "@/utils/executionContext";
import { apiClient } from "@/lib/apiClient";

export interface ListeningConfig<TOutput = any> {
  buildListeningOutput: (responseData: any) => TOutput;
  buildSuccessOutput: (nodeData: any) => TOutput;
  buildTimeoutOutput: (listeningOutput?: TOutput) => TOutput;
  buildErrorOutput?: (error: Error, listeningOutput?: TOutput) => TOutput;
  buildListeningNodeData?: (responseData: any) => Record<string, any>;
  isDataReceived: (nodeData: any) => boolean;
  shouldStop?: (nodeData: any) => boolean;
  timeout: number;
  pollInterval?: number;
  listeningFlag: string;
  receivedFlag?: string;
  recoveryPolling?: {
    endpoint: string;
    interval: number;
    processResult: (result: any) => {
      done: boolean;
      output?: TOutput;
      expired?: boolean;
    };
  };
}

export interface ListeningHandlerDeps {
  nodeId: string;
  executionStore: ExecutionContext;
  setNodes: (updater: (nodes: Node[]) => Node[]) => void;
  apiClient: typeof apiClient;
  accessToken?: string;
  abortRef: MutableRefObject<AbortController | null>;
  publishOutput: (output: unknown, patch: Record<string, any>) => void;
  isCurrent?: () => boolean;
  signal?: AbortSignal;
}

const sleepWithAbort = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });

export function createListeningHandler<TOutput = any>(
  config: ListeningConfig<TOutput>,
  deps: ListeningHandlerDeps,
): { start: (responseData: any) => Promise<TOutput>; abort: () => void } {
  const {
    buildListeningOutput,
    buildSuccessOutput,
    buildTimeoutOutput,
    buildErrorOutput,
    buildListeningNodeData,
    isDataReceived,
    timeout,
    pollInterval = 100,
    listeningFlag,
    receivedFlag,
    recoveryPolling,
  } = config;

  const {
    nodeId,
    executionStore,
    setNodes,
    apiClient: api,
    accessToken,
    abortRef,
    isCurrent = () => true,
    signal: runSignal,
  } = deps;
  let ownedController: AbortController | undefined;
  let receivedTimer: ReturnType<typeof setTimeout> | undefined;
  let published = false;
  let streamAttemptId: string | undefined;
  const canPublish = () => (!streamAttemptId || executionStore.getNodeData(nodeId).streamAttemptId === streamAttemptId) && isCurrent() && (!ownedController || abortRef.current === ownedController)
    && (!published || Object.prototype.hasOwnProperty.call(executionStore.storeMap.get(nodeId) ?? {}, listeningFlag));

  const setNodeOutput = (output: TOutput, patch: Record<string, any>) => {
    if (!canPublish()) return;
    deps.publishOutput(output, patch);
  };

  const updateNodeData = (patch: Record<string, any>) => {
    if (!canPublish()) return;
    executionStore.setNodeData(nodeId, patch);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    );
  };

  const clearReceivedFlag = () => {
    if (!receivedFlag) return;
    updateNodeData({ [receivedFlag]: false });
  };

  const abort = () => {
    if (receivedTimer !== undefined) clearTimeout(receivedTimer);
    ownedController?.abort();
  };

  const start = async (responseData: any): Promise<TOutput> => {
    if (!nodeId || !isCurrent() || runSignal?.aborted) {
      const missingOutput =
        buildErrorOutput?.(new Error("Missing node ID")) ??
        buildTimeoutOutput();
      return missingOutput;
    }

    const current = executionStore.getNodeData(nodeId);
    streamAttemptId = responseData?.attemptId;
    if (responseData?.attemptId) {
      if (current.streamAttemptId !== responseData.attemptId || current.streamLifecycleStatus === "failed" || current.streamLifecycleStatus === "stopped") return current.output as TOutput;
      if (current.streamLifecycleTimestamp && (!responseData.lifecycle?.timestamp || current.streamLifecycleTimestamp > responseData.lifecycle.timestamp)) {
        responseData = { ...responseData, lifecycle: { status: current.streamLifecycleStatus } };
      }
    }
    if (responseData?.lifecycle?.status === "failed" || responseData?.lifecycle?.status === "stopped") {
      const output = buildListeningOutput(responseData);
      setNodeOutput(output, { [listeningFlag]: false, streamLifecycleStatus: responseData.lifecycle.status });
      return output;
    }
    const listeningOutput = buildListeningOutput(responseData);
    const listeningNodeData = buildListeningNodeData
      ? buildListeningNodeData(responseData)
      : {};

    // Finish the previous listener before publishing the replacement flags.
    abortRef.current?.abort();
    const abortController = new AbortController();
    ownedController = abortController;
    abortRef.current = abortController;
    setNodeOutput(listeningOutput, {
      [listeningFlag]: true,
      isStreamPaused: false,
      isStreamStepping: false,
      streamReplayRequestId: undefined,
      lastStreamEntryId: undefined,
      ...listeningNodeData,
    });

    published = true;
    const startTime = Date.now();
    let resolved = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    return new Promise<TOutput>((resolve) => {
      const finish = (
        output: TOutput,
        flags: Record<string, any>,
        options?: { suppressReceivedFlag?: boolean },
      ) => {
        if (resolved) return;
        resolved = true;
        if (intervalId) clearInterval(intervalId);
        runSignal?.removeEventListener("abort", abortForRun);
        abortController.abort();
        setNodeOutput(output, flags);
        if (receivedFlag && !options?.suppressReceivedFlag) {
          receivedTimer = setTimeout(clearReceivedFlag, 700);
        }
        resolve(output);
      };

      const handleTimeout = () => {
        finish(buildTimeoutOutput(listeningOutput), { [listeningFlag]: false }, {
          suppressReceivedFlag: true,
        });
      };

      const handleAbort = () => {
        if (resolved) return;
        resolved = true;
        if (intervalId) clearInterval(intervalId);
        runSignal?.removeEventListener("abort", abortForRun);
        updateNodeData({
          [listeningFlag]: false,
          ...(receivedFlag ? { [receivedFlag]: false } : {}),
        });
        const currentOutput = executionStore.getNodeData(nodeId)?.output;
        resolve((currentOutput ?? listeningOutput) as TOutput);
      };

      const abortForRun = () => abortController.abort();
      runSignal?.addEventListener("abort", abortForRun, { once: true });
      abortController.signal.addEventListener("abort", handleAbort, {
        once: true,
      });

      intervalId = setInterval(() => {
        if (!canPublish()) { abortController.abort(); return; }
        if (abortController.signal.aborted) {
          if (intervalId) clearInterval(intervalId);
          return;
        }

        const nodeData = executionStore.getNodeData(nodeId);

        if (isDataReceived(nodeData)) {
          const successOutput = buildSuccessOutput(nodeData);
          finish(successOutput, {
            [listeningFlag]: false,
            ...(receivedFlag ? { [receivedFlag]: true } : {}),
          });
          return;
        }

        if (config.shouldStop?.(nodeData)) {
          const currentOutput =
            (executionStore.getNodeData(nodeId)?.output as TOutput) ??
            listeningOutput;
          finish(
            currentOutput,
            {
              [listeningFlag]: false,
              ...(receivedFlag ? { [receivedFlag]: false } : {}),
            },
            { suppressReceivedFlag: true },
          );
          return;
        }

        if (Date.now() - startTime > timeout) {
          handleTimeout();
        }
      }, pollInterval);

      if (recoveryPolling) {
        const { endpoint, interval, processResult } = recoveryPolling;
        const runRecoveryPolling = async () => {
          while (!resolved && !abortController.signal.aborted) {
            try {
              const response = await api.request(endpoint, { method: "GET", token: accessToken, signal: abortController.signal });
              if (resolved || abortController.signal.aborted || !canPublish()) { abortController.abort(); return; }
              if (response.ok) {
                const result = await response.json();
                if (resolved || abortController.signal.aborted || !canPublish()) { abortController.abort(); return; }
                const currentState = executionStore.getNodeData(nodeId);
                if (config.shouldStop?.(currentState)) return;
                if (currentState.streamLifecycleTimestamp && result.timestamp && currentState.streamLifecycleTimestamp > result.timestamp) {
                  await sleepWithAbort(interval, abortController.signal);
                  continue;
                }
                const processed = processResult(result);
                if (!processed.done && processed.output) {
                  const current = executionStore.getNodeData(nodeId);
                  // Do not replace delivered data with a repeated readiness acknowledgment.
                  if ((processed.output as any).status !== "listening" || (current.output as any)?.status !== "streaming") {
                    setNodeOutput(processed.output, current.streamAttemptId ? {
                      streamLifecycleStatus: result.status, streamLifecycleTimestamp: result.timestamp,
                    } : {});
                  } else if (current.streamAttemptId) {
                    updateNodeData({ streamLifecycleStatus: result.status, streamLifecycleTimestamp: result.timestamp });
                  }
                }
                if (processed.done) {
                  const output =
                    processed.output ?? buildTimeoutOutput(listeningOutput);
                  finish(
                    output,
                    {
                      [listeningFlag]: false,
                      ...(currentState.streamAttemptId ? { streamLifecycleStatus: result.status === "expired" ? "failed" : result.status } : {}),
                      ...(receivedFlag && !processed.expired
                        ? { [receivedFlag]: true }
                        : {}),
                    },
                    { suppressReceivedFlag: processed.expired },
                  );
                  return;
                }
              }
            } catch (pollError) {
              if (resolved || abortController.signal.aborted || !canPublish()) return;
              console.warn("[Listening Handler] Recovery poll error:", pollError);
            }

            await sleepWithAbort(interval, abortController.signal);
          }
        };

        void runRecoveryPolling();
      }
    });
  };

  return { start, abort };
}

