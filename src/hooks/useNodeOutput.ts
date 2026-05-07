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
import { useNodeId } from "@xyflow/react";
import { createWaitingNewsOutput } from "@/utils/alpacaNews";
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
  handlePanelSave: (newData: any) => void;
  handlePanelPinToggle: () => void;
  setLastOutput: (output: any) => void;
}

/**
 * Custom hook to manage node output display and pinning
 * Handles output updates, pinning, and special cases like AlpacaNews
 */

export function useNodeOutput({
  data,
  definition,
}: UseNodeOutputProps): UseNodeOutputReturn {
  const nodeId = useNodeId();
  const executionStore = useExecutionStore();
  const version = useExecutionStoreVersion();
  const [lastOutput, setLastOutput] = useState<any>(() => {
    // In execution view (readOnly), data.output contains the actual execution result
    if (data.output !== undefined && data.output !== null) {
      // Don't restore stale "listening" or "streaming" states from previous sessions
      const status = data.output?.status;
      if (status === 'listening' || status === 'streaming') {
        return { status: "pending" };
      }
      return data.output;
    }
    // Default behavior for editor mode
    if (definition?.name === "AlpacaNews") {
      return createWaitingNewsOutput({ nodeId: nodeId ?? undefined });
    }
    return { status: "pending" };
  });
  const [overrideOutput, setOverrideOutput] = useState<any | null>(null);

  // Save output data (pins it)
  const handlePanelSave = useCallback(
    (newData: any) => {
      setOverrideOutput(newData);
      setLastOutput(newData);
      data.output = newData;
    },
    [data]
  );

  // Toggle output pinning
  const handlePanelPinToggle = useCallback(() => {
    if (overrideOutput == null) {
      setOverrideOutput(lastOutput);
    } else {
      setOverrideOutput(null);
      setLastOutput(data.output || {});
    }
  }, [overrideOutput, lastOutput, data]);

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
    if (definition?.name === "AlpacaNews") {
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
    definition?.name,
    isPinned,
    lastOutput?.status,
    nodeId,
    executionStore,
  ]);

  return {
    displayedData,
    isPinned,
    handlePanelSave,
    handlePanelPinToggle,
    setLastOutput,
  };
}
