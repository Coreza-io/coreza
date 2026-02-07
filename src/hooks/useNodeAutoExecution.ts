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

import { useEffect, useRef } from "react";
import { useNodeId, useReactFlow } from "@xyflow/react";

interface UseNodeAutoExecutionProps {
  nodeId: string | null;
  definition: any;
  handleSubmit: (e?: React.FormEvent, inputOverride?: any) => Promise<void>;
  executionStore: any;
}

/**
 * Custom hook to handle auto-execution events
 * Listens for 'auto-execute-node' custom events and triggers node execution
 * This hook doesn't return anything, it just sets up event listeners
 */
export function useNodeAutoExecution({
  nodeId,
  definition,
  handleSubmit,
  executionStore,
}: UseNodeAutoExecutionProps): void {
  const { getNodes } = useReactFlow();
  const isMounted = useRef(true);

  // Refs for stashing callbacks
  const onSuccessRef = useRef<null | ((result: any) => void)>(null);
  const onErrorRef = useRef<null | ((error: any) => void)>(null);

  // Listen for auto-execution events
  useEffect(() => {
    const handleAutoExecute = async (event: CustomEvent) => {
      if (event.detail?.nodeId === nodeId) {
        console.log(`🚀 Auto-executing node: ${nodeId}`);

        // Check if this node is a conditional target (should only execute when explicitly triggered)
        if (event.detail.allEdges && event.detail.allNodes) {
          const incomingEdges = event.detail.allEdges.filter(
            (edge: any) => edge.target === nodeId
          );
          const isConditionalTarget = incomingEdges.some((edge: any) => {
            const sourceNode = event.detail.allNodes.find(
              (n: any) => n.id === edge.source
            );
            return (
              sourceNode &&
              (sourceNode.data?.definition as any)?.name === "If" &&
              (edge.sourceHandle === "true" || edge.sourceHandle === "false")
            );
          });

          // If this is a conditional target and wasn't explicitly triggered by the If node, skip execution
          //if (isConditionalTarget && !event.detail.explicitlyTriggered) {
          //  console.log(`🚫 Node ${nodeId} is a conditional target, skipping auto-execution (waiting for explicit trigger)`);
          //  return;
          //}
        }

        // === Stash callbacks for use in [nodes] effect ===
        onSuccessRef.current = event.detail.onSuccess ?? null;
        onErrorRef.current = event.detail.onError ?? null;

        try {
          const inputData = nodeId
            ? executionStore.getNodeData(nodeId).input
            : undefined;
          await handleSubmit(undefined, inputData);
          // Don't access nodes/output or call callback here!
        } catch (executionError) {
          onErrorRef.current?.(executionError);
          onSuccessRef.current = onErrorRef.current = null;
        }
      }
    };

    window.addEventListener(
      "auto-execute-node",
      handleAutoExecute as EventListener
    );
    return () => {
      isMounted.current = false;
      window.removeEventListener(
        "auto-execute-node",
        handleAutoExecute as EventListener
      );
    };
  }, [nodeId, handleSubmit, executionStore]);

  // Watch for output changes and call success/error callback
  // Use polling with getNodes() instead of subscribing to all node changes
  useEffect(() => {
    // Only poll when we have pending callbacks
    if (!onSuccessRef.current && !onErrorRef.current) return;

    const pollInterval = setInterval(() => {
      const nodes = getNodes();
      const currentNode = nodes.find((n) => n.id === nodeId);
      if (!currentNode) return;

      const output = currentNode.data?.output as { status?: string; success?: boolean; error?: any } | undefined;
      if (output === undefined) return;

      // CHECK FOR ERROR STATUS - call onError and stop execution chain
      if (output?.status === "error" || output?.success === false) {
        console.log(`❌ Node ${nodeId} execution failed:`, output);
        onErrorRef.current?.(output?.error || output);
        onSuccessRef.current = onErrorRef.current = null;
        clearInterval(pollInterval);
        return;
      }

      // Normalize result as needed
      let resultToPass = output;

      // Only normalize for Switch nodes that need special handling
      if (
        definition?.name === "Switch" &&
        resultToPass &&
        typeof resultToPass === "object" &&
        "result" in resultToPass
      ) {
        resultToPass = resultToPass.result;
      }

      // Call the stashed success callback
      onSuccessRef.current?.(resultToPass);
      onSuccessRef.current = onErrorRef.current = null;
      clearInterval(pollInterval);
    }, 100); // Poll every 100ms

    return () => clearInterval(pollInterval);
  }, [nodeId, definition, getNodes]);
}

