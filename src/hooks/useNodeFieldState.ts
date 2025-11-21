import { useState, useEffect, useCallback } from "react";
import { useNodeId, useNodes, useReactFlow } from "@xyflow/react";
import type { Node } from "@xyflow/react";

interface UseNodeFieldStateProps {
  definition: any;
  data: any;
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
}: UseNodeFieldStateProps): UseNodeFieldStateReturn {
  const nodeId = useNodeId();
  const nodes = useNodes();
  const { setNodes } = useReactFlow();

  // Initialize fieldState from definition, saved data, or defaults
  const [fieldState, setFieldState] = useState<Record<string, any>>(() => {
    if (!definition?.fields) return {};

    // Load defined fields from node definition
    const definedFields = Object.fromEntries(
      definition.fields.map((f: any) => [
        f.key,
        f.type === "repeater"
          ? data.fieldState?.[f.key] || data.values?.[f.key] || f.default || []
          : data.fieldState?.[f.key] || data.values?.[f.key] || f.default || "",
      ])
    );

    // Preserve additional dynamic fields (like logicalOps) from saved data
    const existingValues = data.fieldState || data.values || {};
    const definedKeys = new Set(definition.fields.map((f: any) => f.key));
    const dynamicFields = Object.fromEntries(
      Object.entries(existingValues).filter(([key]) => !definedKeys.has(key))
    );

    return { ...definedFields, ...dynamicFields };
  });

  // Initialize fieldState when definition changes
  useEffect(() => {
    if (!definition?.fields) return;

    // Load defined fields from node definition
    const definedFields = Object.fromEntries(
      definition.fields.map((f: any) => [
        f.key,
        f.type === "repeater"
          ? data.fieldState?.[f.key] || data.values?.[f.key] || f.default || []
          : data.fieldState?.[f.key] || data.values?.[f.key] || f.default || "",
      ])
    );

    // Preserve additional dynamic fields (like logicalOps) from saved data
    const existingValues = data.fieldState || data.values || {};
    const definedKeys = new Set(definition.fields.map((f: any) => f.key));
    const dynamicFields = Object.fromEntries(
      Object.entries(existingValues).filter(([key]) => !definedKeys.has(key))
    );

    const newFieldState = { ...definedFields, ...dynamicFields };

    // Only update if we don't have fieldState initialized yet or if field definitions actually changed
    const isInitializing = Object.keys(fieldState).length === 0;
    const fieldKeysChanged =
      definition.fields.length !== Object.keys(fieldState).length ||
      definition.fields.some((f: any) => !(f.key in fieldState));

    if (isInitializing || fieldKeysChanged) {
      console.log("🔄 BaseNode initializing fieldState for", definition.name);
      setFieldState(newFieldState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition?.fields?.length, definition?.name, data.fieldState, data.values]);

  // Sync fieldState changes to node data.values for proper persistence
  useEffect(() => {
    if (Object.keys(fieldState).length > 0 && nodeId) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  values: { ...fieldState },
                },
              }
            : n
        )
      );
    }
  }, [fieldState, nodeId, setNodes]);

  // Handle single field change
  const handleChange = useCallback(
    (key: string, value: any) => {
      const newFieldState = { ...fieldState, [key]: value };
      setFieldState(newFieldState);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  values: { ...((n.data as any)?.values || {}), [key]: value },
                  fieldState: newFieldState,
                },
              }
            : n
        )
      );
    },
    [fieldState, nodeId, setNodes]
  );

  // Handle batch field updates
  const handleFieldStateBatch = useCallback(
    (updates: Record<string, any>) => {
      const newFS = { ...fieldState, ...updates };
      setFieldState(newFS);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, values: newFS, fieldState: newFS } }
            : n
        )
      );
    },
    [fieldState, nodeId, setNodes]
  );

  return {
    fieldState,
    handleChange,
    handleFieldStateBatch,
  };
}

