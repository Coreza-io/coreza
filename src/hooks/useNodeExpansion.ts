import { useEffect, useSyncExternalStore } from "react";
import { useStoreApi } from "@xyflow/react";

// Presentation state belongs to each canvas, never to saved node/edge data.
type ExpansionState = { nodes: Set<string>; listeners: Set<() => void> };
const canvases = new WeakMap<object, ExpansionState>();

const getState = (canvas: object): ExpansionState => {
  let state = canvases.get(canvas);
  if (!state) {
    state = { nodes: new Set(), listeners: new Set() };
    canvases.set(canvas, state);
  }
  return state;
};

export const useNodeExpansion = (nodeId: string | undefined, expanded: boolean) => {
  const state = getState(useStoreApi());
  useEffect(() => {
    if (!nodeId || !expanded) return;
    state.nodes.add(nodeId);
    state.listeners.forEach(listener => listener());
    return () => {
      state.nodes.delete(nodeId);
      state.listeners.forEach(listener => listener());
    };
  }, [state, nodeId, expanded]);
};

export const useSourceNodeExpanded = (nodeId: string): boolean => {
  const state = getState(useStoreApi());
  return useSyncExternalStore(
    listener => {
      state.listeners.add(listener);
      return () => { state.listeners.delete(listener); };
    },
    () => state.nodes.has(nodeId),
    () => false,
  );
};
