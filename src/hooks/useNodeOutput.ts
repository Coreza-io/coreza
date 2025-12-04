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

import { useState, useEffect, useCallback } from "react";
import { useNodeId } from "@xyflow/react";
import { createWaitingNewsOutput } from "@/utils/alpacaNews";
import { useExecutionStore, useExecutionStoreVersion } from "@/contexts/ExecutionStoreContext";

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
  const [lastOutput, setLastOutput] = useState<any>(() =>
    definition?.name === "AlpacaNews"
      ? createWaitingNewsOutput({ nodeId: nodeId ?? undefined })
      : { status: "pending" }
  );
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
  }, [version, data.output, definition?.name, isPinned, lastOutput?.status, nodeId, executionStore]);

  return {
    displayedData,
    isPinned,
    handlePanelSave,
    handlePanelPinToggle,
    setLastOutput,
  };
}

