import { readNodeResult, isNodeResult, isFailedResult, toPublicNodeResult, resultFailure, resultSuccess, type ResultErrorDetails, type ResultMeta } from "@/utils/nodeResult";
import { publishNodeResult } from "@/utils/publishNodeResult";
import { snapshotTypedExpressionContext, pickTypedJsonSource } from "../../coreza-backend/src/nodes/logic/typedExpressionContext";
import { TYPED_EXPRESSION_FEATURES } from "../../coreza-backend/src/nodes/logic/safeExpression";
import { prepareExpressionTransport } from "../../coreza-backend/src/nodes/logic/expressionTransport";
import { resolveNodeIdentity } from "@/utils/referenceResolution";
import { canContinueNodeError, continuedNodeError } from "../../coreza-backend/src/nodes/errorContinuation";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useNodeId } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { useAuth } from "@/contexts/AuthContext";
import { useExecutionStore, useExecutionStoreNotify } from "@/contexts/ExecutionStoreContext";
import { useStableNodes } from "@/contexts/StableNodeContext";
import { resolveReferences } from "@/utils/resolveReferences";
import { isFixedField, parameterEntries } from "../../coreza-backend/src/utils/fieldValueModes";
import { freezeVariableSnapshot, referencesVariables, type VariableSnapshot } from "../../coreza-backend/src/variables/contract";
import { loadVariableSnapshot } from "./useVariableSnapshot";
import { supabase } from "@/integrations/supabase/client";
import { getEditorVariableSnapshot, publishEditorVariableSnapshot } from "@/services/editorNodeExecution";
import { isTypedEditFieldRow } from "../../coreza-backend/src/nodes/logic/typedEditFieldRow";
import { compileEditTemplate } from "../../coreza-backend/src/nodes/logic/editTemplate";
import { getAllUpstreamNodes } from "@/utils/getAllUpstreamNodes";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/apiClient";
import { createListeningHandler } from "@/hooks/useListeningHandler";
import {
  buildStreamingSubscribeListeningConfig,
  buildStreamingTriggerListeningConfig,
  buildWebhookListeningConfig,
} from "@/hooks/useListeningConfigs";
import {
  isFieldVisible,
  shouldIncludeFieldInPayload,
} from "@/utils/fieldVisibility";
import { buildConsolidatorConfigFingerprint } from "../../coreza-backend/src/engine/consolidation/consolidatorShared";
import {
  registerEditorNodeAction,
  executeEditorNode,
  isEditorExecutionLocked,
  getEditorConsolidatorSeries,
  setEditorConsolidatorSeries,
  type NodeExecutionOutcome,
} from "@/services/editorNodeExecution";
import { startManualAgentActivity } from "@/services/agentActivity";
import { getEditorExecutionGeneration } from "@/utils/executionGeneration";

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
  selectedInputNodeId?: string;
  selectedInputData: any;
  setLastOutput: (output: any) => void;
  overrideOutput: any | null;
  workflowId?: string;
}

interface UseNodeExecutionReturn {
  error: string;
  isSending: boolean;
  handleSubmit: (e?: React.FormEvent, inputOverride?: any) => Promise<NodeExecutionOutcome>;
}

/**
 * Custom hook to handle node execution logic
 * Manages API calls, Loop nodes, streaming, and error handling
 */
export function useNodeExecution({
  definition,
  fieldState,
  data,
  selectedInputNodeId,
  selectedInputData,
  setLastOutput,
  overrideOutput,
  workflowId,
}: UseNodeExecutionProps): UseNodeExecutionReturn {
  const nodeId = useNodeId();
  const variableQueryClient = useQueryClient();
  const { getNodes, getEdges, getNodeById, updateNodeData } = useStableNodes();
  const { user, session } = useAuth();
  const executionStore = useExecutionStore();
  const notifyExecutionStoreUpdate = useExecutionStoreNotify();

  const readOnlyRef = useRef(Boolean(data?.readOnly));
  readOnlyRef.current = Boolean(data?.readOnly);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);

  // AbortController ref for polling cleanup on unmount
  const pollingAbortRef = useRef<AbortController | null>(null);
  const activeAgentRef = useRef<Awaited<ReturnType<typeof startManualAgentActivity>>>();
  const activeAgentAbortRef = useRef<AbortController>();

  const actionScope = `${user?.id ?? ""}:${data?.workflowSessionId ?? ""}:${nodeId ?? ""}`;
  const scopeRef = useRef(actionScope); scopeRef.current = actionScope;
  const mountedRef = useRef(true);
  // A reused node ID still belongs to a new document session.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeAgentAbortRef.current?.abort();
      activeAgentRef.current?.cancel();
      activeAgentRef.current?.finish(undefined, "incomplete");
      if (pollingAbortRef.current) {
        pollingAbortRef.current.abort();
        pollingAbortRef.current = null;
      }
    };
  }, [actionScope]);

  const userId = user?.id;

  // Resolve references recursively
  // Resolve references recursively
  const resolveDeep = useCallback(
    (
      val: any,
      selectedInputData: any,
      allNodeData: any,
      editFieldsRows = false,
      variables?: Readonly<Record<string, unknown>>,
    ): any => {
      const nodes = getNodes(); // only once per call

      const _resolve = (value: any): any => {
        if (typeof value === "string") {
          // Preserve normal strings that are not templates
          if (!value.includes("{{")) {
            return value;
          }

          return resolveReferences(
            value,
            selectedInputData,
            allNodeData,
            nodes,
            variables,
          );
        }

        if (Array.isArray(value)) {
          return value.map((item) => {
            if (editFieldsRows && isTypedEditFieldRow(item)) return item;
            return _resolve(item);
          });
        }

        if (
          typeof value === "object" &&
          value !== null &&
          Object.prototype.toString.call(value) === "[object Object]"
        ) {
          return Object.fromEntries(
            parameterEntries(value).map(([k, v]) => [k, isFixedField(value, k) ? v : _resolve(v)]),
          );
        }

        return value;
      };

      return _resolve(val);
    },
    [getNodes],
  );

  // Build payload for API request
  const buildPayload = useCallback(
    (
      fieldState: Record<string, any>,
      selectedInputData: Record<string, any>,
      variableSnapshot?: VariableSnapshot,
    ): Record<string, any> => {
      // Read nodes/edges imperatively when building payload - avoids subscription re-renders
      const nodes = getNodes();
      const edges = getEdges();

      // Create a map of all upstream node data by display name
      const allNodeData: Record<string, any> = {};

      nodes.forEach((prevNode) => {
        const displayName = prevNode.id;
        // Prefer execution store
        let nodeData = executionStore.getNodeData(prevNode.id).output;
        if (nodeData === undefined) {
          // fallback to static data if not yet executed
          nodeData = prevNode.data?.pinnedOutput ?? (prevNode.data?.output !== undefined ? prevNode.data.output : prevNode.data ?? {});
        }

        allNodeData[displayName] = nodeData;
      });


      const payload: Record<string, any> = {};
      if (variableSnapshot) payload.variableRevision = variableSnapshot.revision;
      const definedFields = definition?.fields || [];

      for (const field of definedFields) {
        if (
          !shouldIncludeFieldInPayload(field, fieldState, {
            ignoreShowKeys: ["portfolio_tab"],
            ignoreHideKeys: ["portfolio_tab"],
          })
        ) {
          continue;
        }

        if (fieldState[field.key] !== undefined) {
          payload[field.key] = isFixedField(fieldState, field.key) ? fieldState[field.key] : resolveDeep(
            fieldState[field.key],
            selectedInputData,
            allNodeData,
            definition?.name === "Edit Fields" && field.key === "fields",
            variableSnapshot?.values,
          );
        }
      }

      if (definition?.name === "Edit Fields") {
        payload.data = selectedInputData;
        const snapshot = snapshotTypedExpressionContext(nodes, id => executionStore.getNodeData(id).output);
        const referencedNodes = new Set<string>();
        const expressionContexts: Record<string, unknown> = {};
        for (const [rowIndex, row] of (Array.isArray(payload.fields) ? payload.fields : []).entries()) {
          if (!isTypedEditFieldRow(row) || row.valueMode !== "expression") continue;
          const compiled = compileEditTemplate(String(row.value ?? ""), TYPED_EXPRESSION_FEATURES);
          if (compiled.hasComputedSlices) {
            // Validate evaluated arguments and selected contents before HTTP JSON can erase undefined/sparse values.
            expressionContexts[String(rowIndex)] = prepareExpressionTransport(compiled, { $json: pickTypedJsonSource(selectedInputData), $nodes: allNodeData, expressionOutputs: snapshot.nodeResults, nodes: snapshot.nodeIdentities, $vars: variableSnapshot?.values });
            continue;
          }
          for (const name of compiled.nodeReferences) {
            const identity = resolveNodeIdentity(name, snapshot.nodeIdentities);
            if (identity) referencedNodes.add(identity.id);
          }
        }
        payload.expressionContext = {
          nodeResults: Object.fromEntries(Object.entries(allNodeData).filter(([id]) => referencedNodes.has(id))),
          expressionContexts,
          nodeIdentities: snapshot.nodeIdentities,
        };
      }

      if (definition?.name === "If") {
        // Ensure logical operators array is passed through
        if (Array.isArray(fieldState.logicalOps)) {
          payload.logicalOps = fieldState.logicalOps;
        }

        // Add inputData as the current available data
        //payload.inputData = allNodeData;

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
              ((n.data?.definition as any)?.node_type === "sub" ||
                (n.data as any)?.values?.__isTool === true ||
                (n.data as any)?.fieldState?.__isTool === true),
          )
          .map((n) => n.id),
      );

      // Serialize only nodes and edges attached to this AIAgent
      payload.support_nodes = nodes
        .filter((n) => supportNodeIds.has(n.id))
        .map((n) => {
          const def = n.data?.definition as any;
          const nodeValues = n.data?.values || {};
          const allFields = def?.fields || [];
          const visibleFields = allFields.filter((f: any) =>
            isFieldVisible(f, nodeValues),
          );
          const visibleKeys = new Set(visibleFields.map((f: any) => f.key));
          const filteredValues: Record<string, any> = {};

          for (const key of Object.keys(nodeValues)) {
            if (visibleKeys.has(key) || key === "__isTool") {
              filteredValues[key] = nodeValues[key];
            }
          }

          const isToolToggled =
            (n.data as any)?.values?.__isTool === true ||
            (n.data as any)?.fieldState?.__isTool === true;
          return {
            id: n.id,
            name: def?.name,
            description: def?.description,
            node_type: isToolToggled ? "sub" : def?.node_type,
            category: def?.category,
            subCategory: def?.subCategory,
            provider: def?.provider,
            values: filteredValues,
            fields: visibleFields,
            position: n.position,
            __isTool: isToolToggled,
          };
        });
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

      // Discovery needs the graph; BacktestInit replay also needs every node's
      // raw configuration so conditions and expressions resolve against each bar.
      if (
        definition?.name === "InitializeIndicators" ||
        definition?.name === "BacktestInit"
      ) {
        payload.nodes = nodes.map((n) => {
          const nodeDefinition = n.data?.definition as any;
          const serializedNode: Record<string, any> = {
            id: n.id,
            name: nodeDefinition?.name,
            node_type: nodeDefinition?.node_type,
            category: nodeDefinition?.category,
          };

          if (
            definition?.name === "BacktestInit" ||
            nodeDefinition?.category === "Indicators" ||
            nodeDefinition?.name === "RollingWindow" ||
            nodeDefinition?.name === "Consolidator"
          ) {
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

      return {
        ...payload,
      };
    },
    [
      definition,
      executionStore,
      resolveDeep,
      getNodes,
      getEdges,
      nodeId,
    ],
  );

  const publishFailure = useCallback((message: string, executionIsCurrent: () => boolean, code?: string, details?: ResultErrorDetails, partialData?: unknown, meta?: ResultMeta): NodeExecutionOutcome => {
    const outcomeNodeId = nodeId ?? "unknown";
    if (!executionIsCurrent()) return { nodeId: outcomeNodeId, status: "cancelled", reason: "The editor execution changed." };
    if (overrideOutput !== null && overrideOutput !== undefined) {
      return { nodeId: outcomeNodeId, status: "pinned", output: toPublicNodeResult(readNodeResult(overrideOutput)) };
    }
    const continued = canContinueNodeError(definition?.name, fieldState);
    const continuation = continued ? continuedNodeError(definition?.name, fieldState, message, code) : undefined;
    const output = toPublicNodeResult(resultFailure(message, {
      data: partialData === undefined ? continuation?.data : partialData,
      details: { ...details, ...(code !== undefined ? { code } : {}) },
      ...(meta ? { meta } : {}),
      ...(continuation ? { control: continuation.control } : {}),
    }));
    setError(message);
    if (nodeId) publishNodeResult(output, {
      nodeId, isCurrent: executionIsCurrent, updateNodeData, store: executionStore,
      notify: notifyExecutionStoreUpdate, setLastOutput,
    }, continued && definition?.name === "Loop" ? { done: true, aggregated: output } : {});
    return { nodeId: outcomeNodeId, status: continued ? "success" : "failed", error: { message, ...(code !== undefined ? { code } : {}) }, output,
      ...(continuation?.control?.sourceHandle ? { selectedContinuation: continuation.control?.sourceHandle } : {}),
    };
  }, [nodeId, overrideOutput, definition?.name, fieldState, setLastOutput, executionStore, updateNodeData, notifyExecutionStoreUpdate]);

  // Main execution handler
  const executeAction = useCallback(
    async (e?: React.FormEvent, inputOverride?: any, signal?: AbortSignal, executionGeneration?: number, allowedNodeIds?: ReadonlySet<string>, lockToken?: symbol): Promise<NodeExecutionOutcome> => {
      if (e) e.preventDefault();
      const outcomeNodeId = nodeId ?? "unknown";
      if (readOnlyRef.current) {
        return { nodeId: outcomeNodeId, status: "cancelled", reason: "Execution history is read-only." };
      }
      if (allowedNodeIds && !allowedNodeIds.has(outcomeNodeId)) {
        return { nodeId: outcomeNodeId, status: "failed", error: { message: `Node ${outcomeNodeId} is outside the allowed execution scope.` } };
      }
      let agentController: AbortController | undefined;
      const abortAgent = () => agentController?.abort();
      const sessionIsCurrent = () => mountedRef.current && scopeRef.current === actionScope && !readOnlyRef.current
        && getNodeById(outcomeNodeId)?.data?.workflowSessionId === data?.workflowSessionId;
      const executionIsCurrent = () => sessionIsCurrent() && !signal?.aborted && !agentController?.signal.aborted &&
        (executionGeneration === undefined || getEditorExecutionGeneration() === executionGeneration) &&
        (!lockToken || isEditorExecutionLocked(String(data?.workflowSessionId ?? ""), lockToken));
      if (!executionIsCurrent()) return { nodeId: outcomeNodeId, status: "cancelled", reason: "The editor execution changed." };
      // An async function alone does not yield to input/paint before building its payload.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (!executionIsCurrent()) {
        return { nodeId: outcomeNodeId, status: "cancelled", reason: "The editor execution changed." };
      }
      const storedSelectedInput = selectedInputNodeId
        ? executionStore.getNodeData(selectedInputNodeId).output
        : undefined;
      const currentSelectedInput = selectedInputNodeId && storedSelectedInput !== undefined
        ? storedSelectedInput
        : selectedInputData;

      // Pinned / manually edited output wins: skip the request entirely and
      // report the pinned value as this node's output.
      if (overrideOutput !== null && overrideOutput !== undefined) {
        if (import.meta.env.DEV) console.log(
          "📌 [NODE EXECUTION] Pinned output active — skipping execution for node:",
          definition?.name || "Unknown",
        );
        setError("");
        const output = toPublicNodeResult(readNodeResult(overrideOutput));
        if (nodeId) publishNodeResult(output, {
          nodeId, isCurrent: executionIsCurrent, updateNodeData, store: executionStore,
          notify: notifyExecutionStoreUpdate, setLastOutput,
        }, { input: inputOverride ?? currentSelectedInput });
        setIsSending(false);
        return { nodeId: outcomeNodeId, status: "pinned", output };
      }

      if (import.meta.env.DEV) {
        console.log(
          "🎯 [NODE EXECUTION] Starting execution for node:",
          definition?.name || "Unknown",
        );
      }

      // Validate required fields using payload inclusion rules.
      // Tabs are UI-only groupings, so hidden tab fields still validate when relevant.
      for (const f of definition?.fields || []) {
        if (
          !shouldIncludeFieldInPayload(f, fieldState, {
            ignoreShowKeys: ["portfolio_tab"],
            ignoreHideKeys: ["portfolio_tab"],
          })
        ) {
          continue;
        }

        const value = fieldState[f.key];
        const isEmptyArray = Array.isArray(value) && value.length === 0;
        const isMissingValue =
          value === undefined || value === null || value === "" || isEmptyArray;

        if (f.required && isMissingValue) {
          return publishFailure(`${f.label || f.key} is required`, executionIsCurrent);
        }
      }

      setError("");
      setIsSending(true);
      let agentActivity: Awaited<ReturnType<typeof startManualAgentActivity>>;
      try {
        if (!userId) {
          throw new Error("No authenticated user found");
        }

        let effectiveInput = inputOverride ?? currentSelectedInput;
        if (!selectedInputNodeId) {
          // A true root node has no canonical upstream source.
          effectiveInput = { ...fieldState };
        }

        let variables: VariableSnapshot | undefined;
        if (referencesVariables(fieldState) || (definition?.name === "Edit Fields" && fieldState.persistent === true && fieldState.fields?.some(isTypedEditFieldRow))) {
          const { data: { session } } = await supabase.auth.getSession();
          variables = await getEditorVariableSnapshot(lockToken, userId, () => loadVariableSnapshot(userId, session?.access_token, workflowId), workflowId);
          if (!executionIsCurrent()) return { nodeId: outcomeNodeId, status: "cancelled", reason: "Execution changed during variable initialization" };
        }
        let payload = buildPayload(fieldState, effectiveInput, variables);
        let consolidatorSeriesSignature: string | undefined;
        payload.node_id = nodeId;
        payload.nodeName = definition.name;
        payload.node_type = definition.node_type;
        payload.workflowId = workflowId;
        if (definition?.name === "Edit Fields" && payload.persistent === true) payload.variableInvocationId = crypto.randomUUID();
        payload.workflowSessionId = data?.workflowSessionId;
        payload.category = definition.category;
        payload.subCategory = definition.subCategory;
        payload.provider = definition.provider;

        if (definition?.name === "Consolidator") {
          payload.contextMode = "editor";
          payload.nodeId = nodeId;
          payload.operationId = globalThis.crypto.randomUUID();
          payload.configFingerprint = buildConsolidatorConfigFingerprint({
            symbol: String(payload.symbol ?? ""),
            sourceTimeframe: String(payload.source_timeframe ?? ""),
            targetTimeframe: String(payload.target_timeframe ?? ""),
            timezone: String(payload.timezone ?? "UTC"),
            anchorTime: String(payload.anchor_time ?? ""),
          });
          const sourceRunId = selectedInputNodeId
            ? executionStore.getNodeData(selectedInputNodeId).sourceRunId
            : undefined;
          consolidatorSeriesSignature = [
            payload.configFingerprint,
            selectedInputNodeId ?? "",
            sourceRunId ?? "",
          ].join("|");
          payload.seriesAction =
            getEditorConsolidatorSeries(String(data?.workflowSessionId ?? ""), outcomeNodeId) === consolidatorSeriesSignature
              ? "continue"
              : "start";
          payload.sourceProvenance = {
            sourceNodeId: selectedInputNodeId,
            sourceRunId,
          };
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
          const isLastBatch = currentIndex >= arrayLength - 1;

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
            const finalOut = resultSuccess(next.aggregated ?? edgeArrivals ?? []);
            publishNodeResult(finalOut, {
              nodeId: nodeId!, isCurrent: executionIsCurrent, updateNodeData, store: executionStore,
              notify: notifyExecutionStoreUpdate, setLastOutput,
            }, { loopItems: undefined, loopIndex: 0, loopItem: undefined, finishedByLoop: true, done: true, _edgeBuf: {} });
            return { nodeId: outcomeNodeId, status: "success", output: finalOut, selectedContinuation: "done" };
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
          const uiOut = resultSuccess({
              Item: loopItemsOutput,
              totalItem: arrayLength,
              CurrentIndex: currentIndex,
              isLastBatch,
          });
          publishNodeResult(uiOut, {
            nodeId: nodeId!, isCurrent: executionIsCurrent, updateNodeData, store: executionStore,
            notify: notifyExecutionStoreUpdate, setLastOutput,
          }, { input: effectiveInput, _edgeBuf: {} });
          return { nodeId: outcomeNodeId, status: "success", output: uiOut, selectedContinuation: "loop" };
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

          if (definition?.name === "AIAgent" && session?.access_token) {
            // Freeze the same JSON payload that will be sent before awaiting telemetry.
            payload = JSON.parse(JSON.stringify(payload));
            agentController = new AbortController();
            activeAgentAbortRef.current = agentController;
            signal?.addEventListener("abort", abortAgent, { once: true });
            if (signal?.aborted) agentController.abort();
            try { agentActivity = await startManualAgentActivity(payload, session.access_token,
              agentController.signal, executionIsCurrent, abortAgent); }
            catch { /* optional observer setup cannot fail the action */ }
            activeAgentRef.current = agentActivity;
            if (!executionIsCurrent()) return { nodeId: outcomeNodeId, status: "cancelled", reason: "Execution changed during Agent activity setup" };
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

          if (import.meta.env.DEV) {
            console.log("🚀 [BACKEND REQUEST] Sending to:", fullUrl);
            console.log("🚀 [BACKEND REQUEST] Method:", method);
            if (definition?.name === "Consolidator") {
              console.log("🚀 [CONSOLIDATOR REQUEST]", {
                contextMode: payload.contextMode,
                workflowId: payload.workflowId,
                workflowSessionId: payload.workflowSessionId,
                nodeId: payload.nodeId,
                operationId: payload.operationId,
                seriesAction: payload.seriesAction,
              });
            }
            if (method === "GET" && params && !variables) {
              console.log("🚀 [BACKEND REQUEST] GET params:", params.toString());
            }
          }

          const res = await apiClient.request(fullUrl, {
            ...fetchOptions,
            token: session?.access_token,
            signal: agentController?.signal ?? signal,
          });
          const { variableSnapshot: committedVariables, ...responseData } = await res.json();
          const activitySummary = definition?.name === "AIAgent" ? responseData.agentActivity : undefined;
          if (definition?.name === "AIAgent") delete responseData.agentActivity;
          const responseResult = readNodeResult(responseData);
          if (responseResult.status === "cancelled") {
            agentActivity?.finish(activitySummary, "cancelled");
            publishNodeResult(responseResult, { nodeId: nodeId!, isCurrent: executionIsCurrent,
              updateNodeData, store: executionStore, notify: notifyExecutionStoreUpdate, setLastOutput });
            return { nodeId: outcomeNodeId, status: "cancelled", reason: responseResult.error ?? "Node execution cancelled" };
          }
          agentActivity?.finish(activitySummary, !executionIsCurrent() ? "cancelled"
            : res.ok && responseResult.status === "success" ? "completed" : "failed");
          if (!executionIsCurrent()) return { nodeId: outcomeNodeId, status: "cancelled", reason: "The editor execution changed." };
          if (res.ok && committedVariables) {
            const committed = freezeVariableSnapshot(committedVariables, userId, workflowId);
            await variableQueryClient.cancelQueries({ queryKey: ["workflow-variables", userId, workflowId] });
            if (!executionIsCurrent()) return { nodeId: outcomeNodeId, status: "cancelled", reason: "The editor execution changed." };
            publishEditorVariableSnapshot(lockToken, userId, committed);
            variableQueryClient.setQueryData(["workflow-variables", userId, workflowId], committed);
          }
          if (!executionIsCurrent()) {
            return { nodeId: outcomeNodeId, status: "cancelled", reason: "The editor execution changed." };
          }
          if (!res.ok || isFailedResult(responseResult))
            throw new Error(JSON.stringify(responseResult) || "Action failed");
          if (consolidatorSeriesSignature) {
            setEditorConsolidatorSeries(String(data?.workflowSessionId ?? ""), outcomeNodeId, consolidatorSeriesSignature);
          }

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
            isCurrent: sessionIsCurrent,
            publishOutput: (output: unknown, patch: Record<string, any>) => {
              publishNodeResult(output, { nodeId: nodeId!, isCurrent: sessionIsCurrent,
                updateNodeData, store: executionStore, notify: notifyExecutionStoreUpdate, setLastOutput }, patch);
            },
            signal,
            setNodes: (updater) => {
              if (!sessionIsCurrent()) return;
              const current = getNodeById(nodeId!);
              if (!current) return;
              const next = updater([current]).find(candidate => candidate.id === nodeId);
              if (next) {
                const patch = Object.fromEntries(Object.entries(next.data).filter(([key, value]) => !Object.is(current.data[key], value)));
                if (Object.keys(patch).length) updateNodeData(nodeId!, patch);
                notifyExecutionStoreUpdate();
              }
            },
            apiClient,
            accessToken: session?.access_token,
            abortRef: pollingAbortRef,
          };

          // Handle webhook listening mode - unified with streaming pattern
          if (isWebhookListening) {
            if (import.meta.env.DEV) console.log(`✅ [Webhook Listening] Response:`, responseData);

            const handler = createListeningHandler(
              buildWebhookListeningConfig({
                definition,
                fieldState,
                nodeId: nodeId!,
                workflowId,
              }),
              listeningDeps,
            );

            void handler.start(responseResult.data);
            return {
              nodeId: outcomeNodeId,
              status: "listener-started",
              output: executionStore.getNodeData(nodeId!).output,
            };
          } else if (isStreamingTrigger) {
            // Streaming trigger - handle listening state and recovery polling
            if (import.meta.env.DEV) console.log(`✅ [Streaming Trigger] Response:`, responseData);
            const handler = createListeningHandler(
              buildStreamingTriggerListeningConfig({
                definition,
                fieldState,
                nodeId: nodeId!,
                workflowId: workflowId!,
              }),
              listeningDeps,
            );

            void handler.start(responseResult.data);
            return {
              nodeId: outcomeNodeId,
              status: "listener-started",
              output: executionStore.getNodeData(nodeId!).output,
            };
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

            void handler.start(responseResult.data);
            return {
              nodeId: outcomeNodeId,
              status: "listener-started",
              output: executionStore.getNodeData(nodeId!).output,
            };
          } else {
            outputData = responseResult;
          }
        } else {
          outputData = resultSuccess(payload);
        }

        const finalOutput = toPublicNodeResult(overrideOutput != null ? readNodeResult(overrideOutput) : outputData);
        publishNodeResult(finalOutput, {
          nodeId: nodeId!, isCurrent: executionIsCurrent, updateNodeData, store: executionStore,
          notify: notifyExecutionStoreUpdate, setLastOutput,
        }, { input: effectiveInput });
        return { nodeId: outcomeNodeId, status: "success", output: finalOutput };
      } catch (err: any) {
        agentActivity?.finish(undefined, !executionIsCurrent() ? "cancelled" : "incomplete");
        if (err?.name === "AbortError" || !executionIsCurrent()) {
          return { nodeId: outcomeNodeId, status: "cancelled", reason: "Execution was cancelled." };
        }
        // Preserve structured server diagnostics, including non-Error throws.
        let message = typeof err === "string" ? err : typeof err?.message === "string" ? err.message : "Action failed";
        let code: string | undefined;
        let parsed = err;
        try { parsed = JSON.parse(message); } catch { /* plain message or structured exception */ }
        if (isNodeResult(parsed)) {
          message = parsed.error ?? message;
          code = parsed.details?.code;
        } else {
          code = typeof err?.code === "string" ? err.code : undefined;
        }
        if (definition?.name === "Consolidator" && code === "EDITOR_CONTEXT_EXPIRED") {
          setEditorConsolidatorSeries(String(data?.workflowSessionId ?? ""), outcomeNodeId);
        }
        return publishFailure(message, executionIsCurrent, code, parsed?.details, parsed?.data, parsed?.meta);
      } finally {
        agentActivity?.finish(undefined, !executionIsCurrent() ? "cancelled" : "incomplete");
        if (activeAgentRef.current === agentActivity) activeAgentRef.current = undefined;
        if (activeAgentAbortRef.current === agentController) activeAgentAbortRef.current = undefined;
        signal?.removeEventListener("abort", abortAgent);
        if (sessionIsCurrent()) setIsSending(false);
      }
    },
    [
      definition,
      fieldState,
      userId,
      selectedInputData,
      selectedInputNodeId,
      buildPayload,
      publishFailure,
      nodeId,
      workflowId,
      variableQueryClient,
      setLastOutput,
      overrideOutput,
      data,
      executionStore,
      updateNodeData,
      notifyExecutionStoreUpdate,
      session?.access_token,
      getEdges,
      getNodeById,
      actionScope,
    ],
  );

  useEffect(() => {
    const sessionId = data?.workflowSessionId;
    if (data?.readOnly || !sessionId || !nodeId) return;
    return registerEditorNodeAction(sessionId, nodeId, ({ input, signal, executionGeneration, allowedNodeIds, lockToken } = {}) => {
      if (signal?.aborted) return Promise.resolve({ nodeId, status: "cancelled", reason: "Execution was cancelled." });
      return executeAction(undefined, input, signal, executionGeneration, allowedNodeIds, lockToken);
    });
  }, [data?.workflowSessionId, data?.readOnly, executeAction, nodeId]);

  const handleSubmit = useCallback(async (e?: React.FormEvent, inputOverride?: any) => {
    e?.preventDefault();
    if (readOnlyRef.current) {
      return { nodeId: nodeId ?? "unknown", status: "cancelled", reason: "Execution history is read-only." } as NodeExecutionOutcome;
    }
    const sessionId = data?.workflowSessionId;
    if (!sessionId || !nodeId) {
      return { nodeId: nodeId ?? "unknown", status: "failed", error: { message: "Node execution is not available." } } as NodeExecutionOutcome;
    }
    const outcome = await executeEditorNode(sessionId, nodeId, { input: inputOverride });
    if (outcome.status === "failed") setError(outcome.error?.message ?? outcome.reason ?? "Node execution failed.");
    return outcome;
  }, [data?.workflowSessionId, nodeId]);

  return {
    error,
    isSending,
    handleSubmit,
  };
}
