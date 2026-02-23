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
import { useNodeId, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { useAuth } from "@/contexts/AuthContext";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";
import { resolveReferences } from "@/utils/resolveReferences";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { apiClient } from "@/lib/apiClient";
import { createListeningHandler } from "@/hooks/useListeningHandler";
import {
  buildStreamingSubscribeListeningConfig,
  buildStreamingTriggerListeningConfig,
  buildWebhookListeningConfig,
} from "@/hooks/useListeningConfigs";

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
  const { getNodes, getEdges, setNodes } = useReactFlow();
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

  // Resolve references recursively
  const resolveDeep = useCallback(
    (val: any, selectedInputData: any, allNodeData: any): any => {
      // Read nodes imperatively when needed - avoids subscription re-renders
      const nodes = getNodes();
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
    [getNodes],
  );

  // Build payload for API request
  const buildPayload = useCallback(
    (
      fieldState: Record<string, any>,
      selectedInputData: Record<string, any>,
    ): Record<string, any> => {
      // Read nodes/edges imperatively when building payload - avoids subscription re-renders
      const nodes = getNodes();
      const edges = getEdges();

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
        //payload.inputData = allNodeData;

        console.log("🔧 If node special payload:", payload);
      }

      // Special handling for support node to include nodes and edges
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

      // For InitializeIndicators: send the full graph so backend BFS can
      // traverse through control nodes and discover downstream indicators.
      if (definition?.name === "InitializeIndicators") {
        payload.nodes = nodes.map((n) => {
          const nodeDefinition = n.data?.definition as any;
          const serializedNode: Record<string, any> = {
            id: n.id,
            name: nodeDefinition?.name,
            node_type: nodeDefinition?.node_type,
            category: nodeDefinition?.category,
          };

          if (nodeDefinition?.category === "Indicators") {
            serializedNode.values = n.data?.values || {};
          }

          return serializedNode;
        });

        payload.edges = edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        }));
      }

      if (definition?.category === "Indicators") {
        const nodeExecutionData = nodeId
          ? (executionStore.getNodeData(nodeId) as Record<string, any>)
          : null;
        const currentWorkflowId = workflowId;
        const currentRunId =
          nodeExecutionData?.run_id ||
          nodeExecutionData?.runId ||
          currentWorkflowId ||
          userId;

        payload.workflow_id = currentWorkflowId;
        payload.run_id = currentRunId;
      }

      return {
        ...payload,
      };
    },
    [
      definition,
      previousNodes,
      executionStore,
      resolveDeep,
      getNodes,
      getEdges,
      nodeId,
      workflowId,
      userId,
    ],
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

      setError("");
      setIsSending(true);

      try {
        if (!userId) {
          throw new Error("No authenticated user found");
        }

        let effectiveInput = selectedInputData;
        if (!effectiveInput || Object.keys(effectiveInput).length === 0) {
          // Root node with no prior input: default to fieldState
          effectiveInput = { ...fieldState };
        }

        const payload = buildPayload(fieldState, effectiveInput);
        payload.node_id = nodeId;
        payload.nodeName = definition.name;
        payload.node_type = definition.node_type;
        payload.workflow_id = workflowId;
        payload.category = definition.category;
        payload.subCategory = definition.subCategory;
        payload.provider = definition.provider;

        if (payload.symbols) {
          const parsedSymbols: string[] = Array.isArray(payload.symbols)
            ? payload.symbols
            : typeof payload.symbols === "string"
              ? payload.symbols
                  .split(",")
                  .map((s: string) => s.trim())
                  .filter(Boolean)
              : [];
        }

        let outputData: any;

        // NOTE: Webhook triggers now use the generic action path below (definition.action.url)
        // with listeningConfig from JSON - no special case needed here

        // Handle Loop nodes specially
        if (definition?.name === "Loop") {
          // Read edges imperatively for loop processing
          const edges = getEdges();

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
          const isLastIndex = currentIndex >= arrayLength - 1;

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
          const loopItemsOutput = Array.isArray(next.output)
            ? next.output
            : next.output == null
              ? []
              : [next.output];
          const uiOut = {
            data: {
              Item: loopItemsOutput,
              totalItem: arrayLength,
              CurrentIndex: currentIndex,
              isLastIndex,
            },
          };
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

          const listeningDeps = {
            nodeId: nodeId!,
            executionStore,
            setNodes,
            setLastOutput,
            apiClient,
            accessToken: session?.access_token,
            abortRef: pollingAbortRef,
          };

          // Handle webhook listening mode - unified with streaming pattern
          if (isWebhookListening) {
            console.log(`✅ [Webhook Listening] Response:`, responseData);

            const handler = createListeningHandler(
              buildWebhookListeningConfig({
                definition,
                fieldState,
                nodeId: nodeId!,
              }),
              listeningDeps,
            );

            outputData = await handler.start(responseData);
          } else if (isStreamingTrigger) {
            // Streaming trigger - handle listening state and recovery polling
            console.log(`✅ [Streaming Trigger] Response:`, responseData);
            const handler = createListeningHandler(
              buildStreamingTriggerListeningConfig({
                definition,
                fieldState,
                nodeId: nodeId!,
                workflowId: workflowId!,
              }),
              listeningDeps,
            );

            await handler.start(responseData);
            return;
          } else if (isStreamingSubscribe) {
            const handler = createListeningHandler(
              buildStreamingSubscribeListeningConfig({
                definition,
                fieldState,
                nodeId,
                payload,
              }),
              listeningDeps,
            );

            outputData = await handler.start(responseData);
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
      getEdges,
    ],
  );

  return {
    error,
    isSending,
    handleSubmit,
  };
}
