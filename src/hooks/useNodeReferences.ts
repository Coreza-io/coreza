import { planReferenceTextDrop, finishReferenceTextDrop } from "@/hooks/useReferenceTextDrop";
import { useStableNodes } from "@/contexts/StableNodeContext";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useCallback, useRef } from "react";
import type { SemanticNode } from "@/contexts/canonicalGraphStore";
import { resolveReferences } from "@/utils/resolveReferences";
import { fullePreview, summarizePreview } from "@/utils/preview";
import { useExecutionStore } from "@/contexts/ExecutionStoreContext";
import { buildPreviewData } from "@/utils/previewDataResolver";
import {
  buildNodeReference,
  parseJsonReferenceDragPayload,
} from "@/utils/referencePath";

interface UseNodeReferencesProps {
  fieldState: Record<string, any>;
  previousNodes: readonly SemanticNode[];
  selectedPrevNodeId: string;
  selectedPrevNode: SemanticNode | undefined;
}

interface UseNodeReferencesReturn {
  handleDragStart: (e: React.DragEvent, keyPath: string, value: string) => void;
  handleDrop: (
    fieldKey: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
    e: React.DragEvent,
    currentValue: string,
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
}: UseNodeReferencesProps): UseNodeReferencesReturn {
  const { getNodes } = useStableNodes();
  const executionStore = useExecutionStore();
  const [sourceMap, setSourceMap] = useState<Record<string, string>>({});

  const sourceMapRef = useRef(sourceMap); sourceMapRef.current = sourceMap;

  // Handle drag start for reference expressions
  const handleDragStart = useCallback(
    (_e: React.DragEvent, _keyPath: string, _value: string) => {
      document.body.classList.add("cursor-grabbing", "select-none");
    },
    [],
  );

  // Handle drop of reference expressions
  const handleDrop = useCallback(
    (
      fieldKey: string,
      setter: React.Dispatch<React.SetStateAction<string>>,
      e: React.DragEvent,
      currentValue: string,
    ) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        const data = parseJsonReferenceDragPayload(
          e.dataTransfer.getData("application/reactflow"),
        );
        if (!data) return;
        const sourceId = data.sourceNodeId || selectedPrevNodeId;
        if (!sourceId) return;
        // Read nodes imperatively at drop time - avoids subscription re-renders
        const nodes = getNodes();
        const insert = buildNodeReference(data, nodes, selectedPrevNodeId);
        if (!insert) return;
        const insertion = planReferenceTextDrop(e, insert);
        if (!insertion) return;
        if ((setter as (value: string) => boolean | void)(insertion.value) === false) return;
        const beforeSource = sourceMapRef.current[fieldKey];
        const restoreSource = (source: string | undefined) => () => setSourceMap(sm => {
          const next = { ...sm }; if (source === undefined) delete next[fieldKey]; else next[fieldKey] = source; return next;
        });
        finishReferenceTextDrop(e, insertion, { restore: restoreSource(sourceId) }, { restore: restoreSource(beforeSource) });
        setSourceMap((sm) => ({ ...sm, [fieldKey]: sourceId }));
      } catch (err) {
        console.error("❌ Drop error:", err);
      } finally {
        document.body.classList.remove("cursor-grabbing", "select-none");
      }
    },
    [getNodes, selectedPrevNodeId],
  );

  // Get preview of resolved reference expression
  const getFieldPreview = useCallback(
    (fieldKey: string) => {
      const expr = fieldState[fieldKey] || "";
      if (!expr.includes("{{")) return null;

      const srcId = sourceMap[fieldKey] || selectedPrevNodeId;
      const srcNode =
        previousNodes.find((n) => n.id === srcId) || selectedPrevNode;

      const { allNodeData, getSourceData } = buildPreviewData(
        getNodes(),
        executionStore,
        getNodes,
      );

      const srcData = srcNode ? getSourceData(srcId) : {};

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
        return error instanceof Error ? error.message : "Reference preview failed.";
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
    ],
  );

  // Visual styling now handled via [data-node-surface="dark"] CSS rules
  // targeting [data-is-reference="true"]. Kept as no-op for backward compat.
  const referenceStyle: React.CSSProperties = {};

  return {
    handleDragStart,
    handleDrop,
    getFieldPreview,
    referenceStyle,
  };
}
