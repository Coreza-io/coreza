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

/**
 * A lightweight, isolated ExecutionStoreProvider for viewing historical executions.
 * - No WebSocket connection (historical data is static)
 * - Completely isolated from the main editor's execution store
 * - Pre-populated with historical execution data from props
 */

import { createContext, useContext, useRef, useState, useEffect, ReactNode } from 'react';
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

interface StaticExecutionStoreProviderProps {
  children: ReactNode;
  nodeExecutions?: NodeExecutionData[];
}

export const StaticExecutionStoreProvider = ({ 
  children, 
  nodeExecutions = [] 
}: StaticExecutionStoreProviderProps) => {
  const storeRef = useRef<ExecutionContext>(new ExecutionContext());
  const [version, setVersion] = useState(0);
  
  // Pre-populate store with historical execution data
  useEffect(() => {
    storeRef.current.clear();
    nodeExecutions.forEach(exec => {
      storeRef.current.setNodeData(exec.nodeId, {
        output: exec.output,
        input: exec.input,
      });
    });
    setVersion(v => v + 1);
  }, [nodeExecutions]);
  
  const notifyUpdate = () => setVersion(v => v + 1);
  
  return (
    <StaticExecutionStoreContext.Provider value={{ 
      store: storeRef.current, 
      version, 
      notifyUpdate 
    }}>
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
