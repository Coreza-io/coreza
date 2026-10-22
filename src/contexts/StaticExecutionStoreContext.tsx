/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

/**
 * A lightweight, isolated ExecutionStoreProvider for viewing historical executions.
 * - No WebSocket connection (historical data is static)
 * - Completely isolated from the main editor's execution store
 * - Pre-populated with historical execution data from props
 */

import { createContext, useContext, useRef, useState, useLayoutEffect, useCallback, useMemo, ReactNode } from 'react';
import ExecutionContext from '@/utils/executionContext';

interface StaticExecutionStoreContextValue {
  store: ExecutionContext;
  version: number;
  notifyUpdate: () => void;
}

export const StaticExecutionStoreContext = createContext<StaticExecutionStoreContextValue | null>(null);

interface NodeExecutionData {
  nodeId: string;
  output?: any;
  input?: any;
  status?: string;
}

const EMPTY_EXECUTIONS: NodeExecutionData[] = [];

interface StaticExecutionStoreProviderProps {
  children: ReactNode;
  nodeExecutions?: NodeExecutionData[];
}

export const StaticExecutionStoreProvider = ({ 
  children, 
  nodeExecutions = EMPTY_EXECUTIONS 
}: StaticExecutionStoreProviderProps) => {
  const storeRef = useRef<ExecutionContext>();
  if (!storeRef.current) storeRef.current = new ExecutionContext();
  const [version, setVersion] = useState(0);
  const previousExecutions = useRef<NodeExecutionData[] | null>(null);
  
  // Pre-populate store with historical execution data
  useLayoutEffect(() => {
    const previous = previousExecutions.current;
    if (previous?.length === nodeExecutions.length && previous.every((exec, index) => {
      const next = nodeExecutions[index];
      return exec.nodeId === next.nodeId && exec.output === next.output && exec.input === next.input;
    })) return;
    previousExecutions.current = nodeExecutions;
    // ExecutionContext has no per-write subscribers; publish once after replacement.
    storeRef.current.dispose();
    nodeExecutions.forEach(exec => {
      storeRef.current.setNodeData(exec.nodeId, {
        output: exec.output,
        input: exec.input,
      });
    });
    storeRef.current.flushNotifications();
    setVersion(v => v + 1);
  }, [nodeExecutions]);
  
  const notifyUpdate = useCallback(() => setVersion(v => v + 1), []);
  const value = useMemo(() => ({ store: storeRef.current, version, notifyUpdate }), [version, notifyUpdate]);
  
  return (
    <StaticExecutionStoreContext.Provider value={value}>
      {children}
    </StaticExecutionStoreContext.Provider>
  );
};

export const useStaticExecutionStore = () => {
  const staticCtx = useContext(StaticExecutionStoreContext);
  if (!staticCtx) {
    throw new Error('useStaticExecutionStore must be used within StaticExecutionStoreProvider');
  }
  return staticCtx.store;
};

export const useStaticExecutionStoreVersion = (): number => {
  const ctx = useContext(StaticExecutionStoreContext);
  return ctx?.version ?? 0;
};

export default StaticExecutionStoreContext;
