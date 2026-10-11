import { isExpressionContract, previewFieldValue, type FieldPreviewScope } from "../../coreza-backend/src/nodes/logic/fieldExpression";
import { snapshotTypedExpressionContext, pickTypedJsonSource } from "../../coreza-backend/src/nodes/logic/typedExpressionContext";
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
  definition?: any;
  nodeId?: string;
  previousNodes: readonly SemanticNode[];
  selectedPrevNodeId: string;
  selectedInputData?: unknown;
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
  getFieldPreviewResult: (fieldKey: string, raw?: unknown, scope?: FieldPreviewScope) => { value?: unknown; error?: string } | null;
  referenceStyle: React.CSSProperties;
}

/**
 * Custom hook to handle drag-drop references and field previews
 * Manages reference expressions like {{ $('NodeName').json.path }}
 */
export function useNodeReferences({
  fieldState,
  definition,
  nodeId,
  previousNodes,
  selectedPrevNodeId,
  selectedInputData,
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

  const getFieldPreviewResult = useCallback((fieldKey: string, raw?: unknown, scope?: FieldPreviewScope) => {
    const expr = raw === undefined ? (scope?.values ?? fieldState)[fieldKey] : raw;
    const fields = scope?.fields ?? definition?.fields ?? [];
    const field = fields.find((field: any) => field.key === fieldKey);
    if (!field) return null;
    if (!isExpressionContract(fieldState) && (typeof expr !== 'string' || !expr.includes('{{'))) return null;
    if (field?.type === 'password') return null;
    const srcId = sourceMap[fieldKey] ?? selectedPrevNodeId;
    const { getSourceData, allNodeData } = buildPreviewData(previousNodes, executionStore, getNodes);
    try {
      const nodes = getNodes();
      const snapshot = snapshotTypedExpressionContext(nodes, id => executionStore.getNodeData(id).output);
      const value = isExpressionContract(fieldState)
        ? previewFieldValue(fieldKey, { ...scope, fields, values: { ...(scope?.values ?? fieldState), [fieldKey]: expr } }, { $json: pickTypedJsonSource(snapshot.nodeResults[selectedPrevNodeId] !== undefined ? snapshot.nodeResults[selectedPrevNodeId] : selectedInputData), $nodes: snapshot.nodeResults, expressionOutputs: snapshot.nodeResults, nodes: snapshot.nodeIdentities }, nodeId)
        : resolveReferences(expr, getSourceData(srcId), allNodeData, nodes);
      return { value };
    } catch (error) { return { error: error instanceof Error ? error.message : 'Reference preview failed.' }; }
  }, [fieldState, definition, nodeId, sourceMap, selectedPrevNodeId, selectedInputData, previousNodes, executionStore, getNodes]);
  const getFieldPreview = useCallback((fieldKey: string) => {
    const result = getFieldPreviewResult(fieldKey);
    if (!result) return null;
    if (result.error) return result.error;
    return Array.isArray(result.value) && result.value.length > 100 ? summarizePreview(result.value, 5, 200) : fullePreview(result.value);
  }, [getFieldPreviewResult]);

  // Visual styling now handled via [data-node-surface="dark"] CSS rules
  // targeting [data-is-reference="true"]. Kept as no-op for backward compat.
  const referenceStyle: React.CSSProperties = {};

  return {
    handleDragStart,
    handleDrop,
    getFieldPreview,
    getFieldPreviewResult,
    referenceStyle,
  };
}
