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
import { syncEditorNodeActionIds } from '@/services/editorNodeExecution';
import { createCanonicalGraphStore, type CanonicalGraphSnapshot, type SemanticGraphSnapshot } from './canonicalGraphStore';

export interface RenameNodeRequest {
  nodeId: string;
  requestedName: string;
}

export type RenameNodeResult =
  | { ok: true; oldId: string; newId: string; changed: boolean }
  | { ok: false; code: string; message: string };

type NodeRenamer = (request: RenameNodeRequest) => Promise<RenameNodeResult> | RenameNodeResult;

interface StableNodeContextValue {
  getNodes: () => Node[];
  getEdges: () => Edge[];
  getNodeById: (id: string) => Node | undefined;
  setCanonicalDocument: (nodes: readonly Node[], edges: readonly Edge[], sessionId?: string) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => CanonicalGraphSnapshot;
  subscribeSemantic: (listener: () => void) => () => void;
  getSemanticSnapshot: () => SemanticGraphSnapshot;
  getConfigurationSnapshot: () => SemanticGraphSnapshot;
  subscribeConfiguration: (listener: () => void) => () => void;
  getTopologySnapshot: () => SemanticGraphSnapshot;
  subscribeTopology: (listener: () => void) => () => void;
  updateNodeData: (id: string, patch: Record<string, unknown>) => boolean;
  registerNodeDataUpdater: (updater: (id: string, patch: Record<string, unknown>) => boolean | void) => () => void;
  renameNode: (request: RenameNodeRequest) => Promise<RenameNodeResult>;
  registerNodeRenamer: (renamer: NodeRenamer) => () => void;
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
  const nodeDataUpdaterRef = useRef<((id: string, patch: Record<string, unknown>) => boolean | void) | null>(null);
  const nodeRenamerRef = useRef<NodeRenamer | null>(null);
  if (!canonicalStoreRef.current) canonicalStoreRef.current = createCanonicalGraphStore();
  const canonicalStore = canonicalStoreRef.current;
  
  const value = useMemo<StableNodeContextValue>(() => ({
    getNodes: () => [...(canonicalPublishedRef.current
      ? canonicalStore.getSnapshot().nodes
      : reactFlow.getNodes())],
    getEdges: () => [...(canonicalPublishedRef.current
      ? canonicalStore.getSnapshot().edges
      : reactFlow.getEdges())],
    getNodeById: (id: string) =>
      canonicalPublishedRef.current ? canonicalStore.getNodeById(id) : reactFlow.getNode(id),
    setCanonicalDocument: (nodes: readonly Node[], edges: readonly Edge[], sessionId?: string) => {
      canonicalPublishedRef.current = true;
      if (sessionId) syncEditorNodeActionIds(sessionId, nodes);
      canonicalStore.publish(nodes, edges, sessionId);
    },
    subscribe: canonicalStore.subscribe,
    getSnapshot: canonicalStore.getSnapshot,
    subscribeSemantic: canonicalStore.subscribeSemantic,
    getSemanticSnapshot: canonicalStore.getSemanticSnapshot,
    getConfigurationSnapshot: canonicalStore.getConfigurationSnapshot,
    subscribeConfiguration: canonicalStore.subscribeConfiguration,
    getTopologySnapshot: canonicalStore.getTopologySnapshot,
    subscribeTopology: canonicalStore.subscribeTopology,
    updateNodeData: (id: string, patch: Record<string, unknown>) => {
      if (!nodeDataUpdaterRef.current) return false;
      return nodeDataUpdaterRef.current(id, patch) !== false;
    },
    registerNodeDataUpdater: (updater: (id: string, patch: Record<string, unknown>) => boolean | void) => {
      nodeDataUpdaterRef.current = updater;
      return () => {
        if (nodeDataUpdaterRef.current === updater) nodeDataUpdaterRef.current = null;
      };
    },
    renameNode: async (request: RenameNodeRequest) => {
      const renamer = nodeRenamerRef.current;
      if (!renamer) return { ok: false as const, code: "unavailable", message: "Node rename is unavailable in this view." };
      return renamer(request);
    },
    registerNodeRenamer: (renamer: NodeRenamer) => {
      nodeRenamerRef.current = renamer;
      return () => {
        if (nodeRenamerRef.current === renamer) nodeRenamerRef.current = null;
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

export function useCanonicalGraphSync(nodes: readonly Node[], edges: readonly Edge[], sessionId?: string): void {
  const context = useStableNodes();
  useLayoutEffect(() => {
    context.setCanonicalDocument(nodes, edges, sessionId);
  }, [context, edges, nodes, sessionId]);
}

export function useSemanticGraphSnapshot(): SemanticGraphSnapshot {
  const context = useContext(StableNodeContext);
  if (!context) throw new Error('useSemanticGraphSnapshot must be used within StableNodeProvider');
  return useSyncExternalStore(context.subscribeSemantic, context.getSemanticSnapshot, context.getSemanticSnapshot);
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

export function useOptionalSemanticGraphSnapshot(enabled = true): SemanticGraphSnapshot | null {
  const context = useContext(StableNodeContext);
  const subscribe = useCallback(
    (listener: () => void) => enabled && context ? context.subscribeSemantic(listener) : () => undefined,
    [context, enabled],
  );
  const getSnapshot = useCallback(
    () => enabled && context ? context.getSemanticSnapshot() : OPTIONAL_EMPTY_SEMANTIC_GRAPH,
    [context, enabled],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return enabled && context ? snapshot : null;
}

const OPTIONAL_EMPTY_CANONICAL_GRAPH: CanonicalGraphSnapshot = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
});

const OPTIONAL_EMPTY_SEMANTIC_GRAPH: SemanticGraphSnapshot = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  getUpstreamNodes: () => Object.freeze([]),
});

/** Configuration inventories retain identity across result and geometry publications. */
export function useConfigurationGraphSnapshot(enabled = true): SemanticGraphSnapshot {
  const context = useStableNodes();
  const subscribe = useCallback((listener: () => void) => enabled ? context.subscribeConfiguration(listener) : () => undefined, [context, enabled]);
  const getSnapshot = useCallback(() => enabled ? context.getConfigurationSnapshot() : OPTIONAL_EMPTY_SEMANTIC_GRAPH, [context, enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useOptionalConfigurationGraphSnapshot(enabled = true): SemanticGraphSnapshot | null {
  const context = useContext(StableNodeContext);
  const subscribe = useCallback((listener: () => void) => enabled && context ? context.subscribeConfiguration(listener) : () => undefined, [context, enabled]);
  const getSnapshot = useCallback(() => enabled && context ? context.getConfigurationSnapshot() : OPTIONAL_EMPTY_SEMANTIC_GRAPH, [context, enabled]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return enabled && context ? snapshot : null;
}

/** Topology inventories retain identity across result and geometry publications. */
export function useTopologyGraphSnapshot(enabled = true): SemanticGraphSnapshot {
  const context = useStableNodes();
  const subscribe = useCallback((listener: () => void) => enabled ? context.subscribeTopology(listener) : () => undefined, [context, enabled]);
  const getSnapshot = useCallback(() => enabled ? context.getTopologySnapshot() : OPTIONAL_EMPTY_SEMANTIC_GRAPH, [context, enabled]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useOptionalTopologyGraphSnapshot(enabled = true): SemanticGraphSnapshot | null {
  const context = useContext(StableNodeContext);
  const subscribe = useCallback((listener: () => void) => enabled && context ? context.subscribeTopology(listener) : () => undefined, [context, enabled]);
  const getSnapshot = useCallback(() => enabled && context ? context.getTopologySnapshot() : OPTIONAL_EMPTY_SEMANTIC_GRAPH, [context, enabled]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return enabled && context ? snapshot : null;
}
