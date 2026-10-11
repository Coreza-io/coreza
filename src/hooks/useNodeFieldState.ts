import { useExpressionCapability } from "./useExpressionCapability";
import { migrateNodeExpressionValues, normalizeExpressionRows, isExpressionContract } from "../../coreza-backend/src/nodes/logic/fieldExpression";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNodeId } from "@xyflow/react";
import {
  reconcileNodeValues,
  getSchemaSignature,
} from "@/utils/reconcileNodeValues";
import { isEditorExecutionLocked } from "@/services/editorNodeExecution";
import { useStableNodes } from "@/contexts/StableNodeContext";

interface UseNodeFieldStateProps {
  definition: any;
  data: any;
  readOnly?: boolean;
}

interface UseNodeFieldStateReturn {
  fieldState: Record<string, any>;
  migrationError?: string;
  handleChange: (key: string, value: any) => boolean;
  handleFieldStateBatch: (updates: Record<string, any>) => boolean;
}

/**
 * Custom hook to manage node field state.
 *
 * Key behaviour:
 *  - On mount (and when the definition schema changes) it reconciles the
 *    persisted values against the current JSON definition so that any
 *    newly-added fields are immediately present in both local state AND
 *    the React Flow node store (node.data.values / node.data.fieldState).
 *  - This ensures that saving the workflow will persist the new fields
 *    without requiring the user to open the node panel first.
 */
export function useNodeFieldState({
  definition,
  data,
  readOnly = false,
}: UseNodeFieldStateProps): UseNodeFieldStateReturn {
  const expressionSupported = useExpressionCapability();
  const [migrationError, setMigrationError] = useState<string>();
  const nodeId = useNodeId();
  const { updateNodeData, getNodeById } = useStableNodes();
  const live = useRef({ readOnly, data });
  live.current = { readOnly, data };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const allowed = () => mounted.current && !live.current.readOnly && !!nodeId && !!getNodeById(nodeId) &&
    live.current.data?.workflowSessionId === data?.workflowSessionId &&
    !(typeof live.current.data?.workflowSessionId === "string" && isEditorExecutionLocked(live.current.data.workflowSessionId));

  // Track the schema signature so we re-reconcile when fields change
  const lastSignatureRef = useRef<string>("");
  const ownWrite = useRef<Record<string, any> | null>(null);

  // ── Initial state ────────────────────────────────────────────────────
  const [fieldState, setFieldState] = useState<Record<string, any>>(() => {
    const { merged } = reconcileNodeValues(
      definition,
      data.values ?? {},
      data.fieldState ?? {},
    );
    return merged;
  });

  const draft = useRef(fieldState); draft.current = fieldState;

  // ── Reconcile when definition schema structurally changes ────────────
  // Uses a lightweight signature (field keys + types) to avoid running on
  // every render while still catching added/removed/retyped fields.
  useEffect(() => {
    const signature = getSchemaSignature(definition);
    if (!signature) return;
    if (signature === lastSignatureRef.current) return;

    lastSignatureRef.current = signature;

    const existingValues = data.values ?? {};
    const existingFieldState = data.fieldState ?? {};

    const { merged, hadMissingKeys } = reconcileNodeValues(
      definition,
      existingValues,
      existingFieldState,
    );

    // Always update local state to match the reconciled result
    draft.current = merged;
    setFieldState(merged);

    // If we discovered missing keys, immediately push them into the
    // React Flow store so save/live execution will see them even if the
    // user never interacts with this node's panel.
    if (hadMissingKeys && nodeId && allowed()) {
      console.log(
        "🔄 useNodeFieldState: backfilling missing fields for",
        definition?.name,
      );
      if (updateNodeData(nodeId, { values: merged, fieldState: merged })) ownWrite.current = merged;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSchemaSignature(definition), nodeId, readOnly]);

  // Writes are synchronous; a delayed mirror must not overwrite a document restore.
  useEffect(() => {
    const restored = data.values ?? data.fieldState;
    if (restored && restored !== ownWrite.current) {
      const { merged } = reconcileNodeValues(definition, restored, data.fieldState ?? {});
      draft.current = merged; setFieldState(merged);
    }
  }, [data.values, data.fieldState, data.workflowSessionId]);

  const commit = (updates: Record<string, any>): boolean => {
    if (!allowed()) return false;
    const canonical = getNodeById(nodeId!)?.data?.values as Record<string, any> | undefined;
    const base = canonical && canonical !== ownWrite.current ? { ...draft.current, ...canonical } : draft.current;
    if (!expressionSupported && isExpressionContract(base)) { setMigrationError('Expression authoring is unavailable on this backend.'); return false; }
    let next = { ...base, ...updates };
    if (expressionSupported) {
      try {
        // Normalize the original source before applying edits; a fixed literal keeps its meaning.
        next = { ...migrateNodeExpressionValues(base, definition?.fields ?? []), ...Object.fromEntries(Object.entries(updates).map(([key, value]) => [key, definition?.fields?.find((field: any) => field.key === key)?.type === 'repeater' ? normalizeExpressionRows(value, definition.fields.find((field: any) => field.key === key)) : value])) };
      } catch (error) {
        try { next = migrateNodeExpressionValues({ ...base, ...updates }, definition?.fields ?? []); }
        catch (repairError) { setMigrationError(repairError instanceof Error ? repairError.message : String(repairError)); return false; }
      }
    }
    setMigrationError(undefined);
    if (!updateNodeData(nodeId!, { values: next, fieldState: next })) return false;
    ownWrite.current = next; draft.current = next; setFieldState(next);
    return true;
  };

  const handleChange = useCallback((key: string, value: any) => {
    const updates: Record<string, any> = { [key]: value };
    for (const field of definition?.fields ?? []) {
      if (field.dynamicOptions?.dependsOn !== key) continue;
      if (typeof draft.current[field.key] === 'string' && draft.current[field.key].includes('{{')) continue;
      const options = field.dynamicOptions.optionsByValue?.[value];
      if (options?.length) updates[field.key] = options[0].value;
    }
    return commit(updates);
  }, [nodeId, updateNodeData, definition?.fields, readOnly, data?.workflowSessionId, expressionSupported]);

  const handleFieldStateBatch = useCallback((updates: Record<string, any>) => commit(updates),
    [nodeId, updateNodeData, readOnly, data?.workflowSessionId, expressionSupported]);

  return { fieldState, migrationError, handleChange, handleFieldStateBatch };
}
