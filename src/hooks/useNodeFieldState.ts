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

import { useState, useEffect, useCallback, useRef } from "react";
import { useNodeId, useReactFlow } from "@xyflow/react";
import {
  reconcileNodeValues,
  getSchemaSignature,
} from "@/utils/reconcileNodeValues";

interface UseNodeFieldStateProps {
  definition: any;
  data: any;
  readOnly?: boolean;
}

interface UseNodeFieldStateReturn {
  fieldState: Record<string, any>;
  handleChange: (key: string, value: any) => void;
  handleFieldStateBatch: (updates: Record<string, any>) => void;
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
  const nodeId = useNodeId();
  const { setNodes } = useReactFlow();

  // Track the schema signature so we re-reconcile when fields change
  const lastSignatureRef = useRef<string>("");
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ── Initial state ────────────────────────────────────────────────────
  const [fieldState, setFieldState] = useState<Record<string, any>>(() => {
    const { merged } = reconcileNodeValues(
      definition,
      data.values ?? {},
      data.fieldState ?? {},
    );
    return merged;
  });

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
    setFieldState(merged);

    // If we discovered missing keys, immediately push them into the
    // React Flow store so save/live execution will see them even if the
    // user never interacts with this node's panel.
    if (hadMissingKeys && nodeId && !readOnly) {
      console.log(
        "🔄 useNodeFieldState: backfilling missing fields for",
        definition?.name,
      );
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  values: { ...merged },
                  fieldState: { ...merged },
                },
              }
            : n,
        ),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSchemaSignature(definition), nodeId, readOnly]);

  // ── Debounced sync: local fieldState → React Flow node.data.values ──
  // Keeps the store up-to-date as the user types / selects values.
  useEffect(() => {
    if (readOnly) return;
    if (Object.keys(fieldState).length === 0 || !nodeId) return;

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    syncTimeoutRef.current = setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;
          const currentValues = (n.data as any)?.values || {};
          if (JSON.stringify(currentValues) === JSON.stringify(fieldState))
            return n;
          return {
            ...n,
            data: { ...n.data, values: { ...fieldState } },
          };
        }),
      );
    }, 50);

    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [fieldState, nodeId, setNodes, readOnly]);

  // ── Single field change ──────────────────────────────────────────────
  const handleChange = useCallback(
    (key: string, value: any) => {
      if (readOnly) return;

      const normalizedValue =
        typeof value === "string" && value.trim() === "" ? null : value;
      const newFieldState = { ...fieldState, [key]: normalizedValue };

      // Handle dynamicOptions dependencies
      if (definition?.fields) {
        for (const field of definition.fields) {
          if (field.dynamicOptions?.dependsOn === key) {
            const options = field.dynamicOptions.optionsByValue?.[value];
            if (options && options.length > 0) {
              newFieldState[field.key] = options[0].value;
            }
          }
        }
      }

      setFieldState(newFieldState);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  values: newFieldState,
                  fieldState: newFieldState,
                },
              }
            : n,
        ),
      );
    },
    [fieldState, nodeId, setNodes, definition?.fields, readOnly],
  );

  // ── Batch field update ───────────────────────────────────────────────
  const handleFieldStateBatch = useCallback(
    (updates: Record<string, any>) => {
      if (readOnly) return;

      const newFS = { ...fieldState, ...updates };
      setFieldState(newFS);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, values: newFS, fieldState: newFS } }
            : n,
        ),
      );
    },
    [fieldState, nodeId, setNodes, readOnly],
  );

  return { fieldState, handleChange, handleFieldStateBatch };
}
