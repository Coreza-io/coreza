/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';
import { createCanonicalGraphStore, type CanonicalGraphSnapshot } from './canonicalGraphStore';

interface StableNodeContextValue {
  getNodes: () => Node[];
  getEdges: () => Edge[];
  getNodeById: (id: string) => Node | undefined;
  setCanonicalDocument: (nodes: readonly Node[], edges: readonly Edge[]) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => CanonicalGraphSnapshot;
  updateNodeData: (id: string, patch: Record<string, unknown>) => void;
  registerNodeDataUpdater: (updater: (id: string, patch: Record<string, unknown>) => void) => () => void;
}

const StableNodeContext = createContext<StableNodeContextValue | null>(null);

/**
 * StableNodeProvider - Provides stable node/edge access without re-renders
 * 
 * Unlike useNodes()/useEdges() which trigger re-renders on every position change,
 * this context provides imperative access methods that don't cause subscriptions.
 * 
 * Use this when you need to read nodes/edges inside callbacks or effects,
 * but don't want the component to re-render on node drag.
 */
export function StableNodeProvider({ children }: { children: React.ReactNode }) {
  const reactFlow = useReactFlow();
  const canonicalStoreRef = useRef<ReturnType<typeof createCanonicalGraphStore>>();
  const canonicalPublishedRef = useRef(false);
  const nodeDataUpdaterRef = useRef<((id: string, patch: Record<string, unknown>) => void) | null>(null);
  if (!canonicalStoreRef.current) canonicalStoreRef.current = createCanonicalGraphStore();
  const canonicalStore = canonicalStoreRef.current;
  
  const value = useMemo(() => ({
    getNodes: () => [...(canonicalPublishedRef.current
      ? canonicalStore.getSnapshot().nodes
      : reactFlow.getNodes())],
    getEdges: () => [...(canonicalPublishedRef.current
      ? canonicalStore.getSnapshot().edges
      : reactFlow.getEdges())],
    getNodeById: (id: string) =>
      (canonicalPublishedRef.current
        ? canonicalStore.getSnapshot().nodes
        : reactFlow.getNodes()).find(n => n.id === id),
    setCanonicalDocument: (nodes: readonly Node[], edges: readonly Edge[]) => {
      canonicalPublishedRef.current = true;
      canonicalStore.publish(nodes, edges);
    },
    subscribe: canonicalStore.subscribe,
    getSnapshot: canonicalStore.getSnapshot,
    updateNodeData: (id: string, patch: Record<string, unknown>) => {
      nodeDataUpdaterRef.current?.(id, patch);
    },
    registerNodeDataUpdater: (updater: (id: string, patch: Record<string, unknown>) => void) => {
      nodeDataUpdaterRef.current = updater;
      return () => {
        if (nodeDataUpdaterRef.current === updater) nodeDataUpdaterRef.current = null;
      };
    },
  }), [canonicalStore, reactFlow]);
  
  return (
    <StableNodeContext.Provider value={value}>
      {children}
    </StableNodeContext.Provider>
  );
}

export function useStableNodes() {
  const ctx = useContext(StableNodeContext);
  if (!ctx) {
    throw new Error('useStableNodes must be used within StableNodeProvider');
  }
  return ctx;
}

export function useCanonicalGraphSync(nodes: readonly Node[], edges: readonly Edge[]): void {
  const context = useStableNodes();
  useLayoutEffect(() => {
    context.setCanonicalDocument(nodes, edges);
  }, [context, nodes, edges]);
}

export function useCanonicalGraphSnapshot(): CanonicalGraphSnapshot {
  const context = useContext(StableNodeContext);
  if (!context) {
    throw new Error('useCanonicalGraphSnapshot must be used within StableNodeProvider');
  }
  return useSyncExternalStore(context.subscribe, context.getSnapshot, context.getSnapshot);
}

/** Used by dual live/history views; live consumers must require a provider. */
export function useOptionalCanonicalGraphSnapshot(): CanonicalGraphSnapshot | null {
  const context = useContext(StableNodeContext);
  const subscribe = useCallback(
    (listener: () => void) => context?.subscribe(listener) ?? (() => undefined),
    [context],
  );
  const getSnapshot = useCallback(
    () => context?.getSnapshot() ?? OPTIONAL_EMPTY_CANONICAL_GRAPH,
    [context],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return context ? snapshot : null;
}

const OPTIONAL_EMPTY_CANONICAL_GRAPH: CanonicalGraphSnapshot = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
});
