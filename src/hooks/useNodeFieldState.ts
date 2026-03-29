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
 * Custom hook to manage node field state
 * Handles initialization, updates, and synchronization with node data
 */
export function useNodeFieldState({
  definition,
  data,
  readOnly = false,
}: UseNodeFieldStateProps): UseNodeFieldStateReturn {
  const nodeId = useNodeId();
  const { setNodes } = useReactFlow();
  const hasInitialized = useRef(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize fieldState from definition, saved data, or defaults
  const [fieldState, setFieldState] = useState<Record<string, any>>(() => {
    if (!definition?.fields) return {};

    // Load defined fields from node definition
    const definedFields = Object.fromEntries(
      definition.fields.map((f: any) => {
        const savedValue = data.fieldState?.[f.key] ?? data.values?.[f.key];

        // For select fields, ensure we use default if saved value is empty/undefined
        if (
          f.type === "select" &&
          (savedValue === undefined || savedValue === null || savedValue === "")
        ) {
          return [f.key, f.default || undefined];
        }

        // For repeater fields
        if (f.type === "repeater") {
          return [f.key, savedValue || f.default || undefined];
        }

        // For all other fields
        return [f.key, savedValue ?? f.default ?? undefined];
      }),
    );

    return definedFields;
  });

  // Initialize fieldState when definition changes
  useEffect(() => {
    if (!definition?.fields) return;

    // Only initialize once when component mounts or definition actually changes
    if (hasInitialized.current) return;

    // Load defined fields from node definition
    const definedFields = Object.fromEntries(
      definition.fields.map((f: any) => {
        const savedValue = data.fieldState?.[f.key] ?? data.values?.[f.key];

        // For select fields, ensure we use default if saved value is empty/undefined
        if (
          f.type === "select" &&
          (savedValue === undefined || savedValue === null || savedValue === "")
        ) {
          return [f.key, f.default || undefined];
        }

        // For repeater fields
        if (f.type === "repeater") {
          return [f.key, savedValue || f.default || undefined];
        }

        // For all other fields
        return [f.key, savedValue ?? f.default ?? undefined];
      }),
    );

    const newFieldState = definedFields;

    // Only set if we actually have fields to initialize
    if (Object.keys(newFieldState).length > 0) {
      console.log("🔄 BaseNode initializing fieldState for", definition.name);
      setFieldState(newFieldState);
      hasInitialized.current = true;
    }
  }, [definition?.fields?.length, definition?.name]);

  // Reset initialization flag if definition fundamentally changes
  useEffect(() => {
    hasInitialized.current = false;
  }, [definition?.name]);

  // Sync fieldState changes to node data.values for proper persistence
  // Skip in readOnly mode to prevent execution view from mutating nodes
  // Debounced to prevent rapid updates during typing
  useEffect(() => {
    if (readOnly) return; // Don't sync in read-only/execution view mode
    if (
      Object.keys(fieldState).length === 0 ||
      !nodeId ||
      !hasInitialized.current
    )
      return;

    // Clear any pending sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    // Debounce the sync to batch rapid updates
    syncTimeoutRef.current = setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== nodeId) return n;

          // Check if values actually changed to prevent redundant updates
          const currentValues = (n.data as any)?.values || {};
          const valuesChanged =
            JSON.stringify(currentValues) !== JSON.stringify(fieldState);

          if (!valuesChanged) return n;

          return {
            ...n,
            data: {
              ...n.data,
              values: { ...fieldState },
            },
          };
        }),
      );
    }, 50); // 50ms debounce

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [fieldState, nodeId, setNodes, readOnly]);

  // Handle single field change with dynamic options support
  const handleChange = useCallback(
    (key: string, value: any) => {
      // Don't allow changes in readOnly mode
      if (readOnly) return;

      const newFieldState = { ...fieldState, [key]: value };

      // Check if any field has dynamicOptions that depends on this key
      if (definition?.fields) {
        for (const field of definition.fields) {
          if (field.dynamicOptions?.dependsOn === key) {
            // Reset the dependent field to first option of new dataType
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

  // Handle batch field updates
  const handleFieldStateBatch = useCallback(
    (updates: Record<string, any>) => {
      // Don't allow changes in readOnly mode
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

  return {
    fieldState,
    handleChange,
    handleFieldStateBatch,
  };
}
