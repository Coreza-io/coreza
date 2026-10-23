import { readPublicNodeResult, resultState } from "@/utils/nodeResult";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNodeId } from "@xyflow/react";
import { createWaitingNewsOutput } from "@/utils/newsStream";
import { isNewsStreamNode } from "@/utils/brokerRegistry";
import { useExecutionStore, useExecutionNodeData, useExecutionStoreNotify } from "@/contexts/ExecutionStoreContext";
import { useStableNodes } from "@/contexts/StableNodeContext";

interface UseNodeOutputProps { data: any; definition: any; enabled?: boolean; }
const owns = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function useNodeOutput({ data, definition, enabled = true }: UseNodeOutputProps) {
  const nodeId = useNodeId();
  const store = useExecutionStore();
  const notify = useExecutionStoreNotify();
  const executionData = useExecutionNodeData(enabled ? nodeId : null);
  const { updateNodeData } = useStableNodes();
  // Immediate accepted local publication remains separate from authoritative runtime/props.
  const [localOutput, setLocalOutput] = useState<{ session: unknown; value: unknown } | null>(null);
  const sessionId = data.workflowSessionId;
  const setLastOutput = useCallback((value: unknown) => setLocalOutput({ session: sessionId, value }), [sessionId]);
  const fallback = useMemo(() => isNewsStreamNode(definition) ? createWaitingNewsOutput({ nodeId: nodeId ?? undefined }) : resultState("pending", null), [definition, nodeId]);
  const pinnedOutput = useMemo(() => data.readOnly || data.pinnedOutput == null ? null : readPublicNodeResult(data.pinnedOutput, "pin"), [data.readOnly, data.pinnedOutput]);
  const isPinned = pinnedOutput !== null;
  const runtime = nodeId ? store.storeMap.get(nodeId) : undefined;
  // Explicit null/falsy output remains distinct from a missing output property.
  const unpinned = runtime && owns(runtime, "output") ? runtime.output
    : owns(data, "output") ? (!data.readOnly && ["listening", "streaming"].includes(data.output?.status) ? fallback : data.output)
    : localOutput?.session === sessionId ? localOutput.value : fallback;
  void executionData;
  const displayedData = useMemo(() => isPinned ? pinnedOutput : readPublicNodeResult(unpinned, "history"), [isPinned, pinnedOutput, unpinned]);
  useEffect(() => {
    if (localOutput && (localOutput.session !== sessionId || (!runtime && data.output === undefined))) setLocalOutput(null);
  }, [sessionId, executionData, data.output, runtime, localOutput]);

  const syncPinnedOutput = useCallback((raw: unknown | null) => {
    const value = raw === null ? null : readPublicNodeResult(raw, "pin");
    if (!nodeId || data.readOnly) return;
    if (!updateNodeData(nodeId, { pinnedOutput: value ?? undefined, ...(value !== null ? { output: value } : {}) })) return;
    store.setPinned(nodeId, value);
    notify();
  }, [nodeId, data.readOnly, store, notify, updateNodeData]);

  useEffect(() => {
    if (!nodeId || data.readOnly) return;
    // Canonical identity/session disposal owns pin retirement. Effect cleanup
    // must not unpin a replacement host or duplicate an already published edit.
    if (store.setPinned(nodeId, pinnedOutput)) notify();
  }, [nodeId, sessionId, pinnedOutput, data.readOnly, store, notify]);

  const handlePanelSave = useCallback((value: unknown) => { setLastOutput(value); syncPinnedOutput(value); }, [setLastOutput, syncPinnedOutput]);
  const handlePanelPinToggle = useCallback(() => syncPinnedOutput(isPinned ? null : displayedData), [isPinned, displayedData, syncPinnedOutput]);
  return { displayedData, isPinned, pinnedOutput, handlePanelSave, handlePanelPinToggle, setLastOutput };
}
