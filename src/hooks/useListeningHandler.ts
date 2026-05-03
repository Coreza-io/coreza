/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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
  setLastOutput: (output: any) => void;
  apiClient: typeof apiClient;
  accessToken?: string;
  abortRef: MutableRefObject<AbortController | null>;
}

const sleepWithAbort = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
      { once: true },
    );
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
    setLastOutput,
    apiClient: api,
    accessToken,
    abortRef,
  } = deps;

  const setNodeOutput = (output: TOutput, patch: Record<string, any>) => {
    setLastOutput(output);
    executionStore.setNodeData(nodeId, { output, ...patch });
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                output,
                ...patch,
              },
            }
          : n,
      ),
    );
  };

  const updateNodeData = (patch: Record<string, any>) => {
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
    abortRef.current?.abort();
  };

  const start = async (responseData: any): Promise<TOutput> => {
    if (!nodeId) {
      const missingOutput =
        buildErrorOutput?.(new Error("Missing node ID")) ??
        buildTimeoutOutput();
      return missingOutput;
    }

    const listeningOutput = buildListeningOutput(responseData);
    const listeningNodeData = buildListeningNodeData
      ? buildListeningNodeData(responseData)
      : {};

    setNodeOutput(listeningOutput, {
      [listeningFlag]: true,
      isStreamPaused: false,
      isStreamStepping: false,
      ...listeningNodeData,
    });

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;

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
        abortController.abort();
        setNodeOutput(output, flags);
        if (receivedFlag && !options?.suppressReceivedFlag) {
          setTimeout(clearReceivedFlag, 700);
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
        updateNodeData({
          [listeningFlag]: false,
          ...(receivedFlag ? { [receivedFlag]: false } : {}),
        });
        const currentOutput = executionStore.getNodeData(nodeId)?.output;
        resolve((currentOutput ?? listeningOutput) as TOutput);
      };

      abortController.signal.addEventListener("abort", handleAbort, {
        once: true,
      });

      intervalId = setInterval(() => {
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
              const response = await api.get(endpoint, accessToken);
              if (response.ok) {
                const result = await response.json();
                const processed = processResult(result);
                if (processed.done) {
                  const output =
                    processed.output ?? buildTimeoutOutput(listeningOutput);
                  finish(
                    output,
                    {
                      [listeningFlag]: false,
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
