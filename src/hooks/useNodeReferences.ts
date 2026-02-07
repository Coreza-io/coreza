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
import { useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { resolveReferences } from "@/utils/resolveReferences";
import { fullePreview, summarizePreview } from "@/utils/preview";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";

interface UseNodeReferencesProps {
  fieldState: Record<string, any>;
  previousNodes: Node[];
  selectedPrevNodeId: string;
  selectedPrevNode: Node | undefined;
  handleChange: (key: string, value: any) => void;
}

interface UseNodeReferencesReturn {
  handleDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  handleDrop: (
    fieldKey: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    e: React.DragEvent,
    currentValue: string
  ) => void;
  getFieldPreview: (fieldKey: string) => string | null;
  referenceStyle: React.CSSProperties;
}

/**
 * Custom hook to handle drag-drop references and field previews
 * Manages reference expressions like {{ $('NodeName').json.path }}
 */
export function useNodeReferences({
  fieldState,
  previousNodes,
  selectedPrevNodeId,
  selectedPrevNode,
  handleChange,
}: UseNodeReferencesProps): UseNodeReferencesReturn {
  const { getNodes } = useReactFlow();
  const executionStore = useExecutionStore();
  const [sourceMap, setSourceMap] = useState<Record<string, string>>({});

  // Handle drag start for reference expressions
  const handleDragStart = useCallback(
    (e: React.DragEvent, keyPath: string, value: string) => {
      e.dataTransfer.setData(
        "application/reactflow",
        JSON.stringify({ type: "jsonReference", keyPath, value })
      );
      e.dataTransfer.effectAllowed = "copy";
      document.body.classList.add("cursor-grabbing", "select-none");
    },
    []
  );

  // Handle drop of reference expressions
  const handleDrop = useCallback(
    (
      fieldKey: string,
      setter: React.Dispatch<React.SetStateAction<string>>,
      e: React.DragEvent,
      currentValue: string
    ) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        const raw = e.dataTransfer.getData("application/reactflow");

        if (!raw) {
          // Try alternative data types
          for (const type of e.dataTransfer.types) {
            e.dataTransfer.getData(type);
          }
          return;
        }

        const data = JSON.parse(raw);

        // Handle both old format (direct keyPath) and new format (structured object)
        let keyPath: string;
        let displayValue: any;

        if (data.type === "jsonReference") {
          keyPath = data.keyPath;
          displayValue = data.value; // Use the actual value for display
        } else {
          keyPath = data.keyPath || data;
          displayValue = data;
        }

        // Read nodes imperatively at drop time - avoids subscription re-renders
        const nodes = getNodes();
        const sourceNode = nodes.find((n) => n.id === selectedPrevNodeId);
        const sourceDisplayName =
          sourceNode?.data?.displayName || sourceNode?.id;
        const kp = (keyPath ?? "").trim();
        const suffix = kp ? `.${kp}` : "";
        const insert = `{{ $('${sourceDisplayName}').json${suffix} }}`;
        const newValue = currentValue + insert;

        setter(newValue);
        handleChange(fieldKey, newValue);
        setSourceMap((sm) => ({ ...sm, [fieldKey]: selectedPrevNodeId }));
      } catch (err) {
        console.error("❌ Drop error:", err);
      }

      document.body.classList.remove("cursor-grabbing", "select-none");
    },
    [getNodes, selectedPrevNodeId, handleChange]
  );

  // Get preview of resolved reference expression
  const getFieldPreview = useCallback(
    (fieldKey: string) => {
      const expr = fieldState[fieldKey] || "";
      if (!expr.includes("{{")) return null;

      const srcId = sourceMap[fieldKey] || selectedPrevNodeId;
      const srcNode =
        previousNodes.find((n) => n.id === srcId) || selectedPrevNode;

      // Extract the actual data from the node structure
      const srcData = srcNode?.data?.output || srcNode?.data || {};

      // Build allNodeData for cross-node references
      const allNodeData: Record<string, any> = {};
      previousNodes.forEach((prevNode) => {
        const displayName = prevNode.data?.displayName || prevNode.id;
        // Prefer execution store
        let nodeData = executionStore.getNodeData(prevNode.id).output;
        if (nodeData === undefined) {
          // fallback to static data if not yet executed
          nodeData = prevNode.data?.output || prevNode.data || {};
        }

        if (typeof displayName === "string") {
          allNodeData[displayName] = nodeData;
        }
      });

      try {
        // Read nodes imperatively for reference resolution - avoids subscription re-renders
        const nodes = getNodes();
        const resolved = resolveReferences(expr, srcData, allNodeData, nodes);

        // For very large arrays, use quick summarized preview to avoid performance issues
        if (Array.isArray(resolved) && resolved.length > 100) {
          return summarizePreview(resolved, 5, 200);
        }

        return fullePreview(resolved);
      } catch (error) {
        // Silently fail for preview errors
        return "";
      }
    },
    [
      fieldState,
      sourceMap,
      selectedPrevNodeId,
      previousNodes,
      selectedPrevNode,
      executionStore,
      getNodes,
    ]
  );

  const referenceStyle: React.CSSProperties = {
    backgroundColor: "hsl(var(--muted))",
    borderBottom: "1px dashed hsl(var(--primary))",
  };

  return {
    handleDragStart,
    handleDrop,
    getFieldPreview,
    referenceStyle,
  };
}
