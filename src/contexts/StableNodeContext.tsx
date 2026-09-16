/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createContext, useContext, useMemo, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';

interface StableNodeContextValue {
  getNodes: () => Node[];
  getEdges: () => Edge[];
  getNodeById: (id: string) => Node | undefined;
  setCanonicalDocument: (nodes: readonly Node[], edges: readonly Edge[]) => void;
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
  const canonicalRef = useRef<{ nodes?: readonly Node[]; edges?: readonly Edge[] }>({});
  
  const value = useMemo(() => ({
    getNodes: () => [...(canonicalRef.current.nodes ?? reactFlow.getNodes())],
    getEdges: () => [...(canonicalRef.current.edges ?? reactFlow.getEdges())],
    getNodeById: (id: string) =>
      (canonicalRef.current.nodes ?? reactFlow.getNodes()).find(n => n.id === id),
    setCanonicalDocument: (nextNodes: readonly Node[], nextEdges: readonly Edge[]) => {
      canonicalRef.current = { nodes: nextNodes, edges: nextEdges };
    },
  }), [reactFlow]);
  
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
  context.setCanonicalDocument(nodes, edges);
}
