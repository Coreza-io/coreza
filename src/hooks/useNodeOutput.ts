/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useEffect, useCallback } from "react";
import { useNodeId, useReactFlow } from "@xyflow/react";
import { createWaitingNewsOutput } from "@/utils/newsStream";
import { isNewsStreamNode } from "@/utils/brokerRegistry";
import {
  useExecutionStore,
  useExecutionStoreVersion,
} from "@/contexts/ExecutionStoreContext";

interface UseNodeOutputProps {
  data: any;
  definition: any;
}

interface UseNodeOutputReturn {
  displayedData: any;
  isPinned: boolean;
  pinnedOutput: any | null;
  handlePanelSave: (newData: any) => void;
  handlePanelPinToggle: () => void;
  setLastOutput: (output: any) => void;
}

/**
 * Custom hook to manage node output display and pinning
 * Handles output updates, pinning, and special cases like news stream nodes
 */

export function useNodeOutput({
  data,
  definition,
}: UseNodeOutputProps): UseNodeOutputReturn {
  const nodeId = useNodeId();
  const executionStore = useExecutionStore();
  const version = useExecutionStoreVersion();
  const { setNodes } = useReactFlow();
  const isNews = isNewsStreamNode(definition);

  const [lastOutput, setLastOutput] = useState<any>(() => {
    // In execution view (readOnly), data.output contains the actual execution result
    if (data.output !== undefined && data.output !== null) {
      // Don't restore stale "listening" or "streaming" states from previous sessions
      const status = data.output?.status;
      if (
        data.pinnedOutput == null &&
        (status === 'listening' || status === 'streaming')
      ) {
        return { status: "pending" };
      }
      return data.output;
    }
    // Default behavior for editor mode
    if (isNews) {
      return createWaitingNewsOutput({ nodeId: nodeId ?? undefined });
    }
    return { status: "pending" };
  });
  const [overrideOutput, setOverrideOutput] = useState<any | null>(
    data.pinnedOutput ?? null,
  );

  /**
   * Propagate a pinned value everywhere consumers read node output from:
   * node data (for the workflow executor), the execution store (for
   * downstream input panels) and React Flow node data.
   */
  const syncPinnedOutput = useCallback(
    (value: any | null) => {
      data.pinnedOutput = value ?? undefined;
      if (value !== null) {
        data.output = value;
      }

      if (!nodeId) return;

      executionStore.setPinned(nodeId, value);

      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  pinnedOutput: value ?? undefined,
                  ...(value !== null ? { output: value } : {}),
                },
              }
            : n,
        ),
      );
    },
    [data, nodeId, executionStore, setNodes],
  );

  useEffect(() => {
    if (!nodeId || data.pinnedOutput == null) return;

    executionStore.setPinned(nodeId, data.pinnedOutput);
    return () => executionStore.setPinned(nodeId, null);
  }, [data.pinnedOutput, executionStore, nodeId]);

  // Save output data (pins it)
  const handlePanelSave = useCallback(
    (newData: any) => {
      setOverrideOutput(newData);
      setLastOutput(newData);
      syncPinnedOutput(newData);
    },
    [syncPinnedOutput]
  );

  // Toggle output pinning
  const handlePanelPinToggle = useCallback(() => {
    if (overrideOutput == null) {
      setOverrideOutput(lastOutput);
      syncPinnedOutput(lastOutput);
    } else {
      setOverrideOutput(null);
      syncPinnedOutput(null);
      const storeOutput = nodeId
        ? executionStore.getNodeData(nodeId)?.output
        : undefined;
      setLastOutput(storeOutput ?? data.output ?? {});
    }
  }, [
    overrideOutput,
    lastOutput,
    data,
    nodeId,
    executionStore,
    syncPinnedOutput,
  ]);

  const displayedData = overrideOutput !== null ? overrideOutput : lastOutput;
  const isPinned = overrideOutput !== null;

  // Sync output from data when not pinned
  useEffect(() => {
    if (isPinned || !nodeId) return;

    // Read from execution store when version changes (WebSocket updates)
    const storeData = executionStore.getNodeData(nodeId);
    if (storeData?.output) {
      setLastOutput(storeData.output);
      return;
    }

    // Fallback to data.output for non-streaming updates
    if (isNews) {
      if (data.output) {
        setLastOutput(data.output);
      } else if (lastOutput?.status !== "waiting") {
        setLastOutput(createWaitingNewsOutput({ nodeId }));
      }
    } else if (data.output) {
      setLastOutput(data.output);
    }
  }, [
    version,
    data.output,
    isNews,
    isPinned,
    lastOutput?.status,
    nodeId,
    executionStore,
  ]);

  return {
    displayedData,
    isPinned,
    pinnedOutput: overrideOutput,
    handlePanelSave,
    handlePanelPinToggle,
    setLastOutput,
  };
}
