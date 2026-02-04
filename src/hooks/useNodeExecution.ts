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

import { useState, useCallback, useRef, useEffect } from "react";
import { useNodeId, useNodes, useEdges, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { useAuth } from "@/contexts/AuthContext";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";
import { resolveReferences } from "@/utils/resolveReferences";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { apiClient } from "@/lib/apiClient";
import { Provider } from "@radix-ui/react-toast";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

// Generate array signature for loop tracking
const makeArraySignature = (arr: any[]): string => {
  try {
    const first = arr.length ? JSON.stringify(arr[0]) : "";
    const last = arr.length ? JSON.stringify(arr[arr.length - 1]) : "";
    return `${arr.length}|${first}|${last}`;
  } catch {
    return `${arr.length}`;
  }
};

const isFieldVisible = (
  field: any,
  currentFieldState: Record<string, any>,
): boolean => {
  if (!field.displayOptions?.show) return true;

  return Object.entries(field.displayOptions.show).every(
    ([depKey, rawAllowed]) => {
      const allowedValues = Array.isArray(rawAllowed)
        ? rawAllowed
        : [rawAllowed];
      return allowedValues.includes(currentFieldState[depKey]);
    },
  );
};

interface UseNodeExecutionProps {
  definition: any;
  fieldState: Record<string, any>;
  data: any;
  previousNodes: Node[];
  selectedInputData: any;
  setLastOutput: (output: any) => void;
  overrideOutput: any | null;
  workflowId?: string;
}

interface UseNodeExecutionReturn {
  error: string;
  isSending: boolean;
  handleSubmit: (e?: React.FormEvent, inputOverride?: any) => Promise<void>;
}

/**
 * Custom hook to handle node execution logic
 * Manages API calls, Loop nodes, streaming, and error handling
 */
export function useNodeExecution({
  definition,
  fieldState,
  data,
  previousNodes,
  selectedInputData,
  setLastOutput,
  overrideOutput,
  workflowId,
}: UseNodeExecutionProps): UseNodeExecutionReturn {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const edges = useEdges();
  const { setNodes } = useReactFlow();
  const { user, session } = useAuth();
  const executionStore = useExecutionStore();

  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  // AbortController ref for polling cleanup on unmount
  const pollingAbortRef = useRef<AbortController | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingAbortRef.current) {
        pollingAbortRef.current.abort();
        pollingAbortRef.current = null;
      }
    };
  }, []);

  const userId = user?.id;

  // Collect support node data
  const collectNodeData = useCallback(() => {
    const supportData = edges
      .filter((e) => e.target === nodeId)
      .reduce(
        (acc, edge) => {
          const sourceNode = nodes.find((n) => n.id === edge.source);
          if ((sourceNode?.data as any)?.definition?.node_type === "support") {
            return { ...acc, ...((sourceNode.data as any)?.output || {}) };
          }
          return acc;
        },
        {} as Record<string, any>,
      );
    return { supportData };
  }, [edges, nodeId, nodes]);

  // Resolve references recursively
  const resolveDeep = useCallback(
    (val: any, selectedInputData: any, allNodeData: any): any => {
      if (typeof val === "string") {
        return resolveReferences(val, selectedInputData, allNodeData, nodes);
      }
      if (Array.isArray(val)) {
        return val.map((v) => resolveDeep(v, selectedInputData, allNodeData));
      }
      if (typeof val === "object" && val !== null) {
        return Object.fromEntries(
          Object.entries(val).map(([k, v]) => [
            k,
            resolveDeep(v, selectedInputData, allNodeData),
          ]),
        );
      }
      return val;
    },
    [nodes],
  );

  // Build payload for API request
  const buildPayload = useCallback(
    (
      fieldState: Record<string, any>,
      supportData: Record<string, any>,
      selectedInputData: Record<string, any>,
    ): Record<string, any> => {
      // Create a map of all upstream node data by display name
      const allNodeData: Record<string, any> = {};

      previousNodes.forEach((prevNode) => {
        const displayName = prevNode.id;
        // Prefer execution store
        let nodeData = executionStore.getNodeData(prevNode.id).output;
        if (nodeData === undefined) {
          // fallback to static data if not yet executed
          nodeData = prevNode.data?.output || prevNode.data || {};
        }

        allNodeData[displayName] = nodeData;
      });

      console.log("🔧 All node data map:", allNodeData);

      const visibleFieldKeys = new Set<string>();
      const definedFields = definition?.fields || [];

      for (const field of definedFields) {
        if (isFieldVisible(field, fieldState)) {
          visibleFieldKeys.add(field.key);
        }
      }

      const payload: Record<string, any> = {};
      for (const [key, value] of Object.entries(fieldState)) {
        if (visibleFieldKeys.has(key)) {
          payload[key] = resolveDeep(value, selectedInputData, allNodeData);
        }
      }

      if (definition?.name === "If") {
        // Ensure logical operators array is passed through
        if (Array.isArray(fieldState.logicalOps)) {
          payload.logicalOps = fieldState.logicalOps;
        }

        // Add inputData as the current available data
        payload.inputData = allNodeData;

        console.log("🔧 If node special payload:", payload);
      }

      // Special handling for AIAgent node to include nodes and edges for tool discovery
      if (definition?.name === "AIAgent") {
        const attachedEdges = nodeId
          ? edges.filter((e) => e.source === nodeId || e.target === nodeId)
          : [];
        const attachedNodeIds = new Set<string>(
          nodeId
            ? [nodeId, ...attachedEdges.flatMap((e) => [e.source, e.target])]
            : [],
        );
        const supportNodeIds = new Set<string>(
          nodes
            .filter(
              (n) =>
                attachedNodeIds.has(n.id) &&
                (n.data?.definition as any)?.node_type === "sub",
            )
            .map((n) => n.id),
        );

        // Serialize only nodes and edges attached to this AIAgent
        payload.support_nodes = nodes
          .filter((n) => supportNodeIds.has(n.id))
          .map((n) => ({
            id: n.id,
            name: (n.data?.definition as any)?.name,
            node_type: (n.data?.definition as any)?.node_type,
            category: (n.data?.definition as any)?.category,
            subCategory: (n.data?.definition as any)?.subCategory,
            provider: (n.data?.definition as any)?.provider,
            values: n.data?.values || {},
            position: n.position,
          }));
        payload.edges = attachedEdges
          .filter(
            (e) =>
              (e.source === nodeId && supportNodeIds.has(e.target)) ||
              (e.target === nodeId && supportNodeIds.has(e.source)),
          )
          .map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          }));

        console.log("🤖 AIAgent special payload with nodes/edges:", {
          nodesCount: payload.support_nodes.length,
          edgesCount: payload.edges.length,
        });
      }

      return {
        ...payload,
        ...(Array.isArray(supportData) ? supportData[0] || {} : supportData),
      };
    },
    [definition, previousNodes, executionStore, resolveDeep, nodes, edges],
  );

  // Main execution handler
  const handleSubmit = useCallback(
    async (e?: React.FormEvent, inputOverride?: any) => {
      if (e) e.preventDefault();

      // Log the start of execution
      console.log(
        "🎯 [NODE EXECUTION] Starting execution for node:",
        definition?.name || "Unknown",
      );
      console.log("🎯 [NODE EXECUTION] Current field state:", fieldState);

      // Validate required fields *only if visible*
      for (const f of definition?.fields || []) {
        let shouldShow = true;
        if (f.displayOptions?.show) {
          for (const [depKey, rawAllowed] of Object.entries(
            f.displayOptions.show,
          )) {
            const allowedValues = Array.isArray(rawAllowed)
              ? (rawAllowed as string[])
              : [];
            if (!allowedValues.includes(fieldState[depKey])) {
              shouldShow = false;
              break;
            }
          }
        }
        if (!shouldShow) continue;

        if (f.required && !fieldState[f.key]) {
          setError(`${f.label || f.key} is required`);
          return;
        }
      }

      // Guard for GoogleWebSearch: require query field
      if (
        definition?.name === "GoogleWebSearch" &&
        !fieldState.query?.toString().trim()
      ) {
        setError("Search Query is required");
        return;
      }

      setError("");
      setIsSending(true);

      try {
        if (!userId) {
          throw new Error("No authenticated user found");
        }

        const { supportData } = collectNodeData();
        let effectiveInput = selectedInputData;
        if (!effectiveInput || Object.keys(effectiveInput).length === 0) {
          // Root node with no prior input: default to fieldState
          effectiveInput = { ...fieldState };
        }

        const payload = buildPayload(fieldState, supportData, effectiveInput);
        payload.node_id = nodeId;
        payload.nodeName = definition.name;
        payload.node_type = definition.node_type;
        payload.workflow_id = workflowId;
        payload.category = definition.category;
        payload.subCategory = definition.subCategory;
        
        // Set provider from listeningConfig (for webhook triggers) or definition
        if (definition?.listeningConfig?.provider) {
          payload.provider = definition.listeningConfig.provider;
        } else {
          payload.provider = definition.provider;
        }
        
        // Map webhook-specific fields for backend compatibility
        if (definition?.executionMode === "webhook_listening") {
          payload.update_types = fieldState.updateTypes;
          payload.secret_token = fieldState.secretToken || fieldState.secret;
        }

        const parsedSymbols: string[] = Array.isArray(payload.symbols)
          ? payload.symbols
          : typeof payload.symbols === "string"
            ? payload.symbols
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean)
            : [];

        let outputData: any;

        // NOTE: Webhook triggers now use the generic action path below (definition.action.url)
        // with listeningConfig from JSON - no special case needed here

        // Handle Loop nodes specially
        if (definition?.name === "Loop") {
          const batchSize = parseInt(fieldState.batchSize) || 1;
          const parallel = !!fieldState.parallel;
          const aggregateMode = !!fieldState.aggregate;
          const continueOnError = !!fieldState.continueOnError;
          const throttleMs = parseInt(fieldState.throttleMs) || 200;

          // Normalize input → loopItems
          let loopItems: any[];
          if (Array.isArray(payload.inputArray)) loopItems = payload.inputArray;
          else if (typeof payload.inputArray === "string") {
            const parsed = JSON.parse(payload.inputArray as any);
            loopItems = Array.isArray(parsed) ? parsed : [parsed];
          } else if (payload.inputArray == null) loopItems = [];
          else if (typeof payload.inputArray === "object")
            loopItems = [payload.inputArray];
          else
            throw new Error(
              "Loop input must be an array or JSON string representing an array",
            );

          // Init / resume state
          const loopSig = makeArraySignature(loopItems);
          const prev = executionStore.getNodeData(nodeId!) || {};
          const inputChanged =
            !Array.isArray(prev.loopItems) || (prev.loopSig ?? "") !== loopSig;

          if (inputChanged) {
            executionStore.startLoop(nodeId!, loopItems, {
              batchSize,
              parallel,
              continueOnError,
              throttleMs,
              loopSig,
              aggregateMode,
            });
          } else {
            executionStore.setNodeData(nodeId!, {
              batchSize,
              parallel,
              continueOnError,
              throttleMs,
              aggregateMode,
            });
          }

          const st = executionStore.getNodeData(nodeId!);
          const items = st.loopItems || loopItems;

          // Next batch & state update
          const arrayLength = items.length;
          const maxLoopIndex = Math.ceil(arrayLength / batchSize) - 1;
          const loopIndex = st.loopIndex ?? 0;
          let finished = false;
          let startIndex = loopIndex;
          const currentIndex = loopIndex;
          if (aggregateMode) {
            startIndex = 0;
          }
          const endIndex = currentIndex + batchSize;
          const batch = items.slice(startIndex, endIndex);
          let current = batchSize === 1 ? batch[0] : batch;
          current = !aggregateMode ? batch[0] : batch;

          const incomingToLoop = edges.filter((e) => e.target === nodeId!);
          const loopDataNow = executionStore.getNodeData(nodeId!) || {};
          const edgeBuf: Record<string, any> = loopDataNow._edgeBuf ?? {};
          const edgeArrivals = incomingToLoop
            .map((e) => edgeBuf[e.id])
            .filter((v) => v != null);

          if (loopIndex > maxLoopIndex) {
            finished = true;
            const next = executionStore.advanceLoop(
              nodeId!,
              current,
              loopIndex + 1,
              finished,
              edgeArrivals,
            );
            const finalOut = next.aggregated ?? edgeArrivals ?? [];
            executionStore.setNodeData(nodeId!, {
              output: finalOut,
              loopItems: undefined,
              loopIndex: 0,
              loopItem: undefined,
              finishedByLoop: true,
              done: true,
              _edgeBuf: {},
            });
            setLastOutput(finalOut);
            data.output = finalOut;
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, output: finalOut } }
                  : n,
              ),
            );
            return;
          }

          // Items mode → append emitted items and finalize to full aggregate on last batch
          const next = executionStore.advanceLoop(
            nodeId!,
            current,
            loopIndex + 1,
            finished,
            edgeArrivals,
          );
          const uiOut = { data: next.output };
          setLastOutput(uiOut);
          data.output = uiOut;
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, output: uiOut } }
                : n,
            ),
          );

          executionStore.setNodeData(nodeId!, {
            input: effectiveInput,
            output: uiOut,
            _edgeBuf: {},
          });

          return;
        }

        // Regular backend processing for non-Loop nodes
        const operationField = (definition?.fields || []).find(
          (f: any) => f.key === "operation",
        );
        let operationMethod = "POST";

        if (operationField) {
          const opSelected = (operationField.options || []).find(
            (opt: any) => opt.id === fieldState.operation,
          );
          if (opSelected && opSelected.method) {
            operationMethod = opSelected.method;
          }
        }

        let url = definition?.action?.url || "";
        let method = definition?.action?.method || "POST";

        if (url.includes("{{") && url.includes("}}")) {
          url = url.replace(
            /\{\{(\w+)\}\}/g,
            (_, key) => fieldState[key] || "",
          );
        }

        if (method.includes("{{") && method.includes("}}")) {
          method = method.replace(/\{\{(\w+)\}\}/g, (_, key) =>
            key === "method" ? operationMethod : fieldState[key] || "",
          );
        }

        if (definition?.action?.url && definition?.action?.method) {
          let fullUrl = `${BACKEND_URL}${url}`;
          let params: URLSearchParams | undefined;

          if (method === "GET") {
            params = new URLSearchParams();
            params.append("credential_id", fieldState.credential_id ?? "");
            fullUrl += `?${params.toString()}`;
          }

          const fetchOptions: RequestInit = {
            method,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session?.access_token}`,
            },
          };
          if (method !== "GET") {
            fetchOptions.body = JSON.stringify(payload);
          } else if (fetchOptions.headers) {
            delete (fetchOptions.headers as Record<string, string>)[
              "Content-Type"
            ];
          }

          // Log the payload and request details
          console.log("🚀 [BACKEND REQUEST] Sending to:", fullUrl);
          console.log("🚀 [BACKEND REQUEST] Method:", method);
          console.log(
            "🚀 [BACKEND REQUEST] Payload:",
            JSON.stringify(payload, null, 2),
          );
          if (method === "GET" && params) {
            console.log("🚀 [BACKEND REQUEST] GET params:", params.toString());
          }

          const res = await apiClient.request(fullUrl, {
            ...fetchOptions,
            token: session?.access_token,
          });
          const responseData = await res.json();
          if (!res.ok || responseData.status === "error")
            throw new Error(JSON.stringify(responseData) || "Action failed");

          // Handle listening modes (streaming and webhook)
          const isStreamingSubscribe =
            definition?.executionMode === "streaming" &&
            (fieldState.operation ?? fieldState.mode) === "subscribe";

          const isStreamingTrigger =
            definition?.executionMode === "streaming" &&
            definition?.node_type === "trigger";

          const isWebhookListening =
            definition?.executionMode === "webhook_listening";

          // Handle webhook listening mode - unified with streaming pattern
          if (isWebhookListening) {
            console.log(`✅ [Webhook Listening] Response:`, responseData);

            // Get config from JSON definition
            const listeningConfig = definition?.listeningConfig || {};
            const listeningFlag = listeningConfig.listeningFlag || "isListening";
            const timeout = listeningConfig.timeout || 300000;
            const waitField = listeningConfig.waitField || "webhookPayload";
            const provider = listeningConfig.provider || definition.name.replace("Trigger", "").toLowerCase();

            const listeningOutput = {
              status: "listening",
              message: responseData.message || "Waiting for webhook event...",
              startedAt: new Date().toISOString(),
              callbackUrl: responseData.callback_url,
              httpMethod: fieldState.httpMethod || "POST",
              nodeId,
              provider,
            };

            setLastOutput(listeningOutput);
            executionStore.setNodeData(nodeId!, { 
              output: listeningOutput,
              [listeningFlag]: true,
            });
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        output: listeningOutput,
                        [listeningFlag]: true,
                      },
                    }
                  : n,
              ),
            );

            // Wait for webhook event via WebSocket (handled by ExecutionStoreContext)
            const startTime = Date.now();

            try {
              await new Promise<void>((resolve, reject) => {
                const checkInterval = setInterval(() => {
                  const nodeData = executionStore.getNodeData(nodeId!);
                  const output = nodeData?.output as any;

                  // Check if we received webhook data using waitField from config
                  if (output?.[waitField]) {
                    clearInterval(checkInterval);
                    console.log("✅ Received webhook event:", output);
                    outputData = output;
                    resolve();
                    return;
                  }

                  // Check timeout
                  if (Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    reject(
                      new Error(
                        `Timeout waiting for webhook event after ${timeout / 60000} minutes`,
                      ),
                    );
                  }
                }, 100);
              });

              // Clear listening state
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? { ...n, data: { ...n.data, [listeningFlag]: false } }
                    : n,
                ),
              );
            } catch (error: any) {
              console.error("Webhook listening error:", error);
              outputData = {
                ...listeningOutput,
                status: "error",
                message: error.message,
              };
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? { ...n, data: { ...n.data, [listeningFlag]: false } }
                    : n,
                ),
              );
            }

            // Continue with normal output handling
            setLastOutput(outputData);
            const finalOutput =
              overrideOutput !== null ? overrideOutput : outputData;
            data.output = finalOutput;
            executionStore.setNodeData(nodeId!, {
              input: effectiveInput,
              output: finalOutput,
            });
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, output: finalOutput } }
                  : n,
              ),
            );
            setIsSending(false);
            return;
          } else if (isStreamingTrigger) {
            // Streaming trigger - handle listening state and recovery polling
            console.log(`✅ [Streaming Trigger] Response:`, responseData);

            const listeningOutput = {
              status: "listening",
              message: `Listening for ${
                definition?.name || "streaming"
              } data...`,
              startedAt: new Date().toISOString(),
              mode: fieldState.mode || "listen",
              source: responseData.source,
              nodeId,
              filterSymbols: responseData.symbols || [],
              filterTypes:
                fieldState.filter_types || fieldState.stream_types || [],
              subscriptionMode: fieldState.subscriptionMode || "workflow",
            };

            outputData = listeningOutput;
            setLastOutput(outputData);
            executionStore.setNodeData(nodeId!, {
              output: outputData,
              isTestListening: true,
              testListenWorkflowId: workflowId,
              testListenNodeId: nodeId,
            });
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        output: outputData,
                        isTestListening: true,
                        testListenWorkflowId: workflowId,
                        testListenNodeId: nodeId,
                      },
                    }
                  : n,
              ),
            );

            // Recovery polling (WebSocket push is primary path)
            const recoveryPollInterval = 10000;
            const maxPollTime = 300000;
            const startTime = Date.now();

            pollingAbortRef.current?.abort();
            const abortController = new AbortController();
            pollingAbortRef.current = abortController;

            const pollForResult = async (): Promise<void> => {
              while (Date.now() - startTime < maxPollTime) {
                if (abortController.signal.aborted) {
                  console.log(
                    `[Streaming Trigger] Recovery polling aborted for node ${nodeId}`,
                  );
                  return;
                }

                const currentNodeData = executionStore.getNodeData(nodeId!);
                if (
                  currentNodeData?.streamDataReceived ||
                  currentNodeData?.output?.status === "success"
                ) {
                  console.log(
                    `✅ [Streaming Trigger] Data received via WebSocket`,
                  );
                  setIsSending(false);
                  return;
                }

                if (
                  currentNodeData?.isTestListening === false &&
                  !currentNodeData?.streamDataReceived
                ) {
                  console.log(`[Streaming Trigger] Test listening stopped`);
                  setIsSending(false);
                  return;
                }

                try {
                  const resultResponse = await apiClient.get(
                    `/market/stream-test-result/${workflowId}/${nodeId}`,
                    session?.access_token,
                  );

                  if (resultResponse.ok) {
                    const result = await resultResponse.json();

                    if (result.status === "data_received") {
                      const receivedOutput = {
                        status: "success",
                        symbol: result.data.symbol,
                        type: result.data.type,
                        data: result.data.data,
                        receivedAt: result.data.receivedAt,
                        source: result.data.source,
                        [result.data.type]:
                          result.data.data?.[result.data.type] ||
                          result.data.data,
                      };

                      setLastOutput(receivedOutput);
                      executionStore.setNodeData(nodeId!, {
                        output: receivedOutput,
                        isTestListening: false,
                        streamDataReceived: true,
                      });
                      setNodes((nds) =>
                        nds.map((n) =>
                          n.id === nodeId
                            ? {
                                ...n,
                                data: {
                                  ...n.data,
                                  output: receivedOutput,
                                  isTestListening: false,
                                  streamDataReceived: true,
                                },
                              }
                            : n,
                        ),
                      );

                      setTimeout(() => {
                        setNodes((nds) =>
                          nds.map((n) =>
                            n.id === nodeId
                              ? {
                                  ...n,
                                  data: {
                                    ...n.data,
                                    streamDataReceived: false,
                                  },
                                }
                              : n,
                          ),
                        );
                      }, 700);

                      setIsSending(false);
                      return;
                    } else if (result.status === "expired") {
                      const expiredOutput = {
                        status: "expired",
                        message: "Test listener expired",
                      };
                      setLastOutput(expiredOutput);
                      executionStore.setNodeData(nodeId!, {
                        output: expiredOutput,
                        isTestListening: false,
                      });
                      setNodes((nds) =>
                        nds.map((n) =>
                          n.id === nodeId
                            ? {
                                ...n,
                                data: {
                                  ...n.data,
                                  output: expiredOutput,
                                  isTestListening: false,
                                },
                              }
                            : n,
                        ),
                      );
                      setIsSending(false);
                      return;
                    }
                  }
                } catch (pollError) {
                  console.warn(
                    `[Streaming Trigger] Recovery poll error:`,
                    pollError,
                  );
                }

                await new Promise((resolve) => {
                  const timeoutId = setTimeout(resolve, recoveryPollInterval);
                  abortController.signal.addEventListener(
                    "abort",
                    () => {
                      clearTimeout(timeoutId);
                      resolve(undefined);
                    },
                    { once: true },
                  );
                });
              }

              if (abortController.signal.aborted) return;

              const timeoutOutput = {
                status: "timeout",
                message: "No stream data received within timeout",
              };
              setLastOutput(timeoutOutput);
              executionStore.setNodeData(nodeId!, {
                output: timeoutOutput,
                isTestListening: false,
              });
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          output: timeoutOutput,
                          isTestListening: false,
                        },
                      }
                    : n,
                ),
              );
              setIsSending(false);
            };

            pollForResult();
            return;
          } else if (isStreamingSubscribe) {
            const waitingOutput = {
              status: "waiting",
              message: `Listening for ${definition?.name} data...`,
              subscribedAt: new Date().toISOString(),
              symbols: parsedSymbols,
              streamTypes: fieldState.stream_types || [],
              nodeId: nodeId ?? undefined,
              news: {},
            } as any;

            outputData = {
              ...waitingOutput,
              subscriptions: responseData?.subscriptions,
              lastActionMessage: responseData?.message,
            };

            // Set initial waiting output
            setLastOutput(outputData);
            executionStore.setNodeData(nodeId!, { output: outputData });
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        output: outputData,
                        isStreamingWaiting: true,
                      },
                    }
                  : n,
              ),
            );

            // Wait for first streaming data
            const timeout = definition?.streamingConfig?.timeout || 30000;
            const startTime = Date.now();

            try {
              await new Promise<void>((resolve, reject) => {
                const checkInterval = setInterval(() => {
                  const nodeData = executionStore.getNodeData(nodeId!);
                  const output = nodeData?.output as any;

                  // Check if we received actual streaming data
                  const hasStreamingData =
                    output &&
                    output.status === "streaming" &&
                    (output.news ||
                      output.data ||
                      output.trade ||
                      output.quote ||
                      output.bar ||
                      output.dailyBar);

                  if (hasStreamingData) {
                    clearInterval(checkInterval);
                    console.log("✅ Received first streaming data:", output);
                    outputData = output;
                    resolve();
                    return;
                  }

                  // Check timeout
                  if (Date.now() - startTime > timeout) {
                    clearInterval(checkInterval);
                    reject(
                      new Error(
                        `Timeout waiting for ${definition?.name} data after ${timeout}ms`,
                      ),
                    );
                  }
                }, 100);
              });

              // Clear streaming waiting state
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? { ...n, data: { ...n.data, isStreamingWaiting: false } }
                    : n,
                ),
              );
            } catch (error: any) {
              console.error("Streaming wait error:", error);
              outputData = {
                ...outputData,
                status: "error",
                message: error.message,
              };
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? { ...n, data: { ...n.data, isStreamingWaiting: false } }
                    : n,
                ),
              );
            }
          } else {
            outputData = responseData;
          }
        } else {
          outputData = payload;
        }

        setLastOutput(outputData);
        const finalOutput =
          overrideOutput !== null ? overrideOutput : outputData;
        data.output = finalOutput;
        executionStore.setNodeData(nodeId!, {
          input: effectiveInput,
          output: finalOutput,
        });
        setNodes((nds) =>
          nds.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, output: finalOutput } }
              : n,
          ),
        );
      } catch (err: any) {
        let errOutput;
        try {
          const parsed = JSON.parse(err.message);
          errOutput = {
            status: "error",
            success: false,
            error: parsed.data || parsed.details || parsed.error || err.message,
            timestamp: new Date().toISOString(),
          };
        } catch {
          // If message isn't JSON, use it directly
          errOutput = {
            status: "error",
            success: false,
            error: err.message || "Action failed",
            timestamp: new Date().toISOString(),
          };
        }

        setLastOutput(errOutput);
        data.output = errOutput;

        if (nodeId) {
          executionStore.setNodeData(nodeId, { output: errOutput });
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, output: errOutput } }
                : n,
            ),
          );
        }
      } finally {
        setIsSending(false);
      }
    },
    [
      definition.name,
      definition?.fields,
      definition?.executionMode,
      definition?.action?.url,
      definition?.action?.method,
      definition?.node_type,
      definition?.streamingConfig?.timeout,
      definition?.streamingConfig?.sourceId,
      fieldState,
      userId,
      collectNodeData,
      selectedInputData,
      buildPayload,
      nodeId,
      workflowId,
      setLastOutput,
      overrideOutput,
      data,
      executionStore,
      setNodes,
      session?.access_token,
      edges,
    ],
  );

  return {
    error,
    isSending,
    handleSubmit,
  };
}
