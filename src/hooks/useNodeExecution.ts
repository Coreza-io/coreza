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

import { useState, useCallback } from "react";
import { useNodeId, useNodes, useEdges, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { useAuth } from "@/contexts/AuthContext";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";
import { resolveReferences } from "@/utils/resolveReferences";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";

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
  const { user } = useAuth();
  const executionStore = useExecutionStore();

  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  const userId = user?.id;

  // Collect support node data
  const collectNodeData = useCallback(() => {
    const supportData = edges
      .filter((e) => e.target === nodeId)
      .reduce((acc, edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        if ((sourceNode?.data as any)?.definition?.node_type === "support") {
          return { ...acc, ...((sourceNode.data as any)?.output || {}) };
        }
        return acc;
      }, {} as Record<string, any>);
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
          ])
        );
      }
      return val;
    },
    [nodes]
  );

  // Build payload for API request
  const buildPayload = useCallback(
    (
      fieldState: Record<string, any>,
      supportData: Record<string, any>,
      selectedInputData: Record<string, any>,
      userId: string
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

      const payload: Record<string, any> = {};
      for (const [key, value] of Object.entries(fieldState)) {
        payload[key] = resolveDeep(value, selectedInputData, allNodeData);
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
        // Serialize nodes and edges for backend
        payload.nodes = nodes.map((n) => ({
          id: n.id,
          name: (n.data?.definition as any)?.name || n.type,
          node_type: (n.data?.definition as any)?.node_type || "main",
          category: (n.data?.definition as any)?.category,
          values: n.data?.fieldState || n.data?.values || {},
          position: n.position,
        }));
        payload.edges = edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        }));

        console.log("🤖 AIAgent special payload with nodes/edges:", {
          nodesCount: payload.nodes.length,
          edgesCount: payload.edges.length,
        });
      }

      return {
        ...payload,
        ...(Array.isArray(supportData) ? supportData[0] || {} : supportData),
        user_id: userId,
      };
    },
    [definition, previousNodes, executionStore, resolveDeep, nodes, edges]
  );

  // Main execution handler
  const handleSubmit = useCallback(
    async (e?: React.FormEvent, inputOverride?: any) => {
      if (e) e.preventDefault();

      // Log the start of execution
      console.log(
        "🎯 [NODE EXECUTION] Starting execution for node:",
        definition?.name || "Unknown"
      );
      console.log("🎯 [NODE EXECUTION] Current field state:", fieldState);

      // Validate required fields *only if visible*
      for (const f of definition?.fields || []) {
        let shouldShow = true;
        if (f.displayOptions?.show) {
          for (const [depKey, rawAllowed] of Object.entries(
            f.displayOptions.show
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

        const payload = buildPayload(
          fieldState,
          supportData,
          effectiveInput,
          userId
        );
        payload.user_id = userId;
        payload.node_id = nodeId;
        payload.workflow_id = workflowId;

        // // Auto-include node_id and workflow_id for all streaming nodes
        // if (definition?.executionMode === "streaming" && nodeId) {
        //   payload.node_id = nodeId;
        //   if (workflowId) {
        //     payload.workflow_id = workflowId;
        //   }
        // }

        const parsedSymbols: string[] = Array.isArray(payload.symbols)
          ? payload.symbols
          : typeof payload.symbols === "string"
          ? payload.symbols
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [];

        let outputData: any;

        // Handle webhook triggers - register ALL through backend
        if (definition?.executionMode === "webhook_listening") {
          // Derive provider from node name (TelegramTrigger -> telegram, WebhookTrigger -> generic)
          const provider = definition.name === "WebhookTrigger" 
            ? "generic" 
            : definition.name.replace('Trigger', '').toLowerCase();
          
          const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';
          
          // Register webhook through backend (for ALL webhook types)
          const registerResponse = await fetch(`${backendUrl}/webhooks/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider,
              user_id: userId,
              workflow_id: workflowId,
              node_id: nodeId,
              credential_id: fieldState.credential_id,
              update_types: fieldState.updateTypes || fieldState.filterEvents,
              secret_token: fieldState.secretToken || fieldState.secret,
            }),
          });
          
          if (!registerResponse.ok) {
            const errorData = await registerResponse.json().catch(() => ({ error: 'Registration failed' }));
            throw new Error(errorData.error || `Failed to register ${provider} webhook`);
          }
          
          const registerResult = await registerResponse.json();
          
          if (!registerResult.success) {
            throw new Error(registerResult.error || `Failed to register ${provider} webhook`);
          }
          
          console.log(`✅ Registered ${provider} webhook:`, registerResult.callback_url);
          
          const listeningOutput = {
            status: "listening",
            message: registerResult.message || "Waiting for webhook event...",
            startedAt: new Date().toISOString(),
            callbackUrl: registerResult.callback_url,
            httpMethod: fieldState.httpMethod || 'POST',
            nodeId: nodeId,
            provider,
          };

          setLastOutput(listeningOutput);
          executionStore.setNodeData(nodeId!, { output: listeningOutput });
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, output: listeningOutput, isListening: true } }
                : n
            )
          );

          // Wait for webhook event via WebSocket (handled by ExecutionStoreContext)
          const timeout = 300000; // 5 minutes
          const startTime = Date.now();

          try {
            await new Promise<void>((resolve, reject) => {
              const checkInterval = setInterval(() => {
                const nodeData = executionStore.getNodeData(nodeId!);
                const output = nodeData?.output as any;

                // Check if we received webhook data
                if (output?.webhookPayload) {
                  clearInterval(checkInterval);
                  console.log("✅ Received webhook event:", output);
                  outputData = output;
                  resolve();
                  return;
                }

                // Check timeout
                if (Date.now() - startTime > timeout) {
                  clearInterval(checkInterval);
                  reject(new Error("Timeout waiting for webhook event after 5 minutes"));
                }
              }, 100);
            });

            // Clear listening state
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, isListening: false } }
                  : n
              )
            );
          } catch (error: any) {
            console.error("Webhook listening error:", error);
            setError(error.message || "Failed to receive webhook");
            outputData = {
              ...listeningOutput,
              status: "error",
              message: error.message,
            };
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, isListening: false } }
                  : n
              )
            );
          }

          // Continue with normal output handling
          setLastOutput(outputData);
          const finalOutput = overrideOutput !== null ? overrideOutput : outputData;
          data.output = finalOutput;
          executionStore.setNodeData(nodeId!, {
            input: effectiveInput,
            output: finalOutput,
          });
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, output: finalOutput } }
                : n
            )
          );
          setIsSending(false);
          return;
        }

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
              "Loop input must be an array or JSON string representing an array"
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
              edgeArrivals
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
                  : n
              )
            );
            return;
          }

          // Items mode → append emitted items and finalize to full aggregate on last batch
          const next = executionStore.advanceLoop(
            nodeId!,
            current,
            loopIndex + 1,
            finished,
            edgeArrivals
          );
          const uiOut = { data: next.output };
          setLastOutput(uiOut);
          data.output = uiOut;
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, output: uiOut } } : n
            )
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
          (f: any) => f.key === "operation"
        );
        let operationMethod = "POST";

        if (operationField) {
          const opSelected = (operationField.options || []).find(
            (opt: any) => opt.id === fieldState.operation
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
            (_, key) => fieldState[key] || ""
          );
        }

        if (method.includes("{{") && method.includes("}}")) {
          method = method.replace(/\{\{(\w+)\}\}/g, (_, key) =>
            key === "method" ? operationMethod : fieldState[key] || ""
          );
        }

        if (definition?.action?.url && definition?.action?.method) {
          let fullUrl = `${BACKEND_URL}${url}`;
          let params: URLSearchParams | undefined;

          if (method === "GET") {
            params = new URLSearchParams();
            params.append("user_id", userId);
            params.append("credential_id", fieldState.credential_id ?? "");
            fullUrl += `?${params.toString()}`;
          }

          const fetchOptions: RequestInit = { method };
          if (method !== "GET") {
            fetchOptions.headers = { "Content-Type": "application/json" };
            fetchOptions.body = JSON.stringify(payload);
          }

          // Log the payload and request details
          console.log("🚀 [BACKEND REQUEST] Sending to:", fullUrl);
          console.log("🚀 [BACKEND REQUEST] Method:", method);
          console.log(
            "🚀 [BACKEND REQUEST] Payload:",
            JSON.stringify(payload, null, 2)
          );
          if (method === "GET" && params) {
            console.log("🚀 [BACKEND REQUEST] GET params:", params.toString());
          }

          const res = await fetch(fullUrl, fetchOptions);
          const responseData = await res.json();
          if (!res.ok) throw new Error(responseData || "Action failed");

          // Handle streaming subscriptions generically
          const isStreamingSubscribe =
            definition?.executionMode === "streaming" &&
            fieldState.operation === "subscribe";

          if (isStreamingSubscribe) {
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
                  : n
              )
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
                        `Timeout waiting for ${definition?.name} data after ${timeout}ms`
                      )
                    );
                  }
                }, 100);
              });

              // Clear streaming waiting state
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? { ...n, data: { ...n.data, isStreamingWaiting: false } }
                    : n
                )
              );
            } catch (error: any) {
              console.error("Streaming wait error:", error);
              setError(error.message || "Failed to receive streaming data");
              outputData = {
                ...outputData,
                status: "error",
                message: error.message,
              };
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === nodeId
                    ? { ...n, data: { ...n.data, isStreamingWaiting: false } }
                    : n
                )
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
              : n
          )
        );
      } catch (err: any) {
        setError(err.message || "Action failed");
        setLastOutput({
          status: "error",
          message: err.message,
          timestamp: new Date().toISOString(),
        });
      } finally {
        setIsSending(false);
      }
    },
    [
      definition,
      fieldState,
      nodeId,
      nodes,
      edges,
      userId,
      selectedInputData,
      collectNodeData,
      buildPayload,
      executionStore,
      setNodes,
      setLastOutput,
      overrideOutput,
      data,
    ]
  );

  return {
    error,
    isSending,
    handleSubmit,
  };
}
