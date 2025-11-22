import { useState, useEffect, useCallback, useRef } from "react";
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
  const hasInitialized = useRef(false);

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
    
    // Only initialize once when component mounts or definition actually changes
    if (hasInitialized.current) return;

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
  useEffect(() => {
    if (Object.keys(fieldState).length === 0 || !nodeId || !hasInitialized.current) return;
    
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== nodeId) return n;
        
        // Check if values actually changed to prevent redundant updates
        const currentValues = (n.data as any)?.values || {};
        const valuesChanged = JSON.stringify(currentValues) !== JSON.stringify(fieldState);
        
        if (!valuesChanged) return n;
        
        return {
          ...n,
          data: {
            ...n.data,
            values: { ...fieldState },
          },
        };
      })
    );
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

