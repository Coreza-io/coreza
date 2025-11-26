import { useState, useEffect, useCallback } from "react";
import { useNodeId } from "@xyflow/react";
import { createWaitingNewsOutput } from "@/utils/alpacaNews";

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
    if (isPinned) return;

    if (definition?.name === "AlpacaNews") {
      if (data.output) {
        setLastOutput(data.output);
      } else if (nodeId && lastOutput?.status !== "waiting") {
        setLastOutput(createWaitingNewsOutput({ nodeId }));
      }
    } else if (data.output) {
      setLastOutput(data.output);
    }
  }, [data.output, definition?.name, isPinned, lastOutput?.status, nodeId]);

  return {
    displayedData,
    isPinned,
    handlePanelSave,
    handlePanelPinToggle,
    setLastOutput,
  };
}

