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
  // The API wrapper is unique per hook caller; getState identifies the shared store.
  const state = getState(useStoreApi().getState);
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

export const useEdgeEndpointsExpanded = (source: string, target: string): boolean => {
  const state = getState(useStoreApi().getState);
  return useSyncExternalStore(
    listener => {
      state.listeners.add(listener);
      return () => { state.listeners.delete(listener); };
    },
    () => state.nodes.has(source) || state.nodes.has(target),
    () => false,
  );
};

export const useNodeExpanded = (nodeId: string | undefined): boolean => {
  const state = getState(useStoreApi().getState);
  return useSyncExternalStore(
    listener => { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; },
    () => !!nodeId && state.nodes.has(nodeId),
    () => false,
  );
};
