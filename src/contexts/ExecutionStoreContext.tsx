import { createContext, useContext, useRef } from 'react';
import ExecutionContext from '@/utils/executionContext';

const ExecutionStoreContext = createContext<ExecutionContext | null>(null);

export const ExecutionStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const storeRef = useRef<ExecutionContext>();
  if (!storeRef.current) {
    storeRef.current = new ExecutionContext();
  }
  return (
    <ExecutionStoreContext.Provider value={storeRef.current}>
      {children}
    </ExecutionStoreContext.Provider>
  );
};

export const useExecutionStore = (): ExecutionContext => {
  const ctx = useContext(ExecutionStoreContext);
  if (!ctx) {
    throw new Error('useExecutionStore must be used within an ExecutionStoreProvider');
  }
  return ctx;
};

export default ExecutionStoreContext;
