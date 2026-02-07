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

import { createContext, useContext, useMemo } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Node, Edge } from '@xyflow/react';

interface StableNodeContextValue {
  getNodes: () => Node[];
  getEdges: () => Edge[];
  getNodeById: (id: string) => Node | undefined;
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
  
  const value = useMemo(() => ({
    getNodes: () => reactFlow.getNodes(),
    getEdges: () => reactFlow.getEdges(),
    getNodeById: (id: string) => reactFlow.getNodes().find(n => n.id === id),
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
