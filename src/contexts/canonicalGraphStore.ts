import type { Edge, Node } from "@xyflow/react";

export interface CanonicalGraphSnapshot {
  nodes: readonly Node[];
  edges: readonly Edge[];
}

const EMPTY_CANONICAL_GRAPH: CanonicalGraphSnapshot = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
});

export interface CanonicalGraphStore {
  getSnapshot: () => CanonicalGraphSnapshot;
  publish: (nodes: readonly Node[], edges: readonly Edge[]) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createCanonicalGraphStore(): CanonicalGraphStore {
  let snapshot = EMPTY_CANONICAL_GRAPH;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    publish: (nodes, edges) => {
      if (snapshot.nodes === nodes && snapshot.edges === edges) return;
      snapshot = { nodes, edges };
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
