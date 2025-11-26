import { createContext, useContext, useRef, useEffect } from 'react';
import ExecutionContext from '@/utils/executionContext';
import { useAuth } from '@/contexts/AuthContext';

const ExecutionStoreContext = createContext<ExecutionContext | null>(null);

const BACKEND_WS_URL = import.meta.env.VITE_API_URL?.replace(/^http/, 'ws').replace(/\/api$/, '') || 'ws://localhost:8081';

export const ExecutionStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const storeRef = useRef<ExecutionContext>();
  const wsRef = useRef<WebSocket | null>(null);
  const { user } = useAuth();
  
  if (!storeRef.current) {
    storeRef.current = new ExecutionContext();
  }

  // WebSocket listener for streaming market data
  useEffect(() => {
    if (!user?.id) return;

    const connectWebSocket = () => {
      const wsUrl = `${BACKEND_WS_URL}?userId=${user.id}`;
      console.log('📡 [ExecutionStore] Connecting to WebSocket:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ [ExecutionStore] WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('📨 [ExecutionStore] Received WebSocket message:', message);

          // Handle streaming market data updates
          if (message.type === 'market_data' && message.nodeId) {
            const { nodeId, data } = message;
            
            // Update execution store with streaming data
            if (storeRef.current) {
              storeRef.current.setNodeData(nodeId, {
                output: {
                  status: 'streaming',
                  data,
                  lastUpdate: new Date().toISOString()
                }
              });
              console.log('✅ [ExecutionStore] Updated node data for:', nodeId);
            }
          }

          // Handle other streaming message types
          if (message.status === 'streaming' && message.nodeId) {
            const { nodeId, data } = message;
            
            if (storeRef.current) {
              storeRef.current.setNodeData(nodeId, {
                output: {
                  status: 'streaming',
                  data,
                  receivedAt: new Date().toISOString()
                }
              });
            }
          }
        } catch (error) {
          console.error('❌ [ExecutionStore] Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ [ExecutionStore] WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('🔌 [ExecutionStore] WebSocket disconnected, reconnecting in 3s...');
        setTimeout(connectWebSocket, 3000);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        console.log('🔌 [ExecutionStore] Closing WebSocket connection');
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user?.id]);

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
