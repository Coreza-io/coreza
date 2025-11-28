import { createContext, useContext, useRef, useEffect, useState } from 'react';
import ExecutionContext from '@/utils/executionContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

const ExecutionStoreContext = createContext<{
  store: ExecutionContext;
  version: number;
} | null>(null);

const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8081';

export const ExecutionStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const storeRef = useRef<ExecutionContext>();
  const wsRef = useRef<WebSocket | null>(null);
  const keepaliveRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  const { user } = useAuth();
  const [updateVersion, setUpdateVersion] = useState(0);
  
  if (!storeRef.current) {
    storeRef.current = new ExecutionContext();
  }

  // WebSocket listener for streaming market data
  useEffect(() => {
    if (!user?.id) return;

    const connectWebSocket = async () => {
      if (!shouldReconnectRef.current) return;
      
      // Get JWT token from Supabase session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        console.error('❌ [ExecutionStore] No access token found');
        return;
      }

      const wsUrl = `${BACKEND_WS_URL}?token=${session.access_token}`;
      console.log('📡 [ExecutionStore] Connecting to WebSocket:', BACKEND_WS_URL);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ [ExecutionStore] WebSocket connected');
        
        // Start keepalive - send ping every 25 seconds
        if (keepaliveRef.current) {
          clearInterval(keepaliveRef.current);
        }
        keepaliveRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
            console.log('💓 [ExecutionStore] Sent keepalive ping');
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Ignore pong messages (keepalive response)
          if (message.type === 'pong') {
            console.log('💓 [ExecutionStore] Received pong');
            return;
          }
          
          console.log('📨 [ExecutionStore] Received WebSocket message:', message);

          // Handle streaming market data updates (new Redis Pub/Sub format)
          if (message.type === 'market_data' && message.payload) {
            const { nodeId, data } = message.payload;
            
            if (nodeId && storeRef.current) {
              storeRef.current.setNodeData(nodeId, {
                output: {
                  status: 'streaming',
                  data,
                  lastUpdate: new Date().toISOString()
                }
              });
              setUpdateVersion(v => v + 1); // Trigger React re-render
              console.log('✅ [ExecutionStore] Updated node data for:', nodeId);
            }
          }

          // Handle legacy streaming format (WebSocketClient broadcasts)
          if (message.status === 'streaming' && message.payload?.nodeId) {
            const { nodeId, data } = message.payload;
            
            if (storeRef.current) {
              storeRef.current.setNodeData(nodeId, {
                output: {
                  status: 'streaming',
                  data,
                  streamType: message.type,
                  receivedAt: new Date().toISOString()
                }
              });
              setUpdateVersion(v => v + 1); // Trigger React re-render
              console.log('✅ [ExecutionStore] Updated node data (legacy) for:', nodeId);
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
        console.log('🔌 [ExecutionStore] WebSocket disconnected');
        
        // Clear keepalive interval
        if (keepaliveRef.current) {
          clearInterval(keepaliveRef.current);
          keepaliveRef.current = null;
        }
        
        // Only reconnect if flag allows (not during cleanup)
        if (shouldReconnectRef.current) {
          console.log('🔄 [ExecutionStore] Reconnecting in 3s...');
          setTimeout(() => connectWebSocket(), 3000);
        }
      };
    };

    shouldReconnectRef.current = true;
    connectWebSocket();

    return () => {
      shouldReconnectRef.current = false;
      
      // Clear keepalive interval
      if (keepaliveRef.current) {
        clearInterval(keepaliveRef.current);
        keepaliveRef.current = null;
      }
      
      // Close WebSocket
      if (wsRef.current) {
        console.log('🔌 [ExecutionStore] Closing WebSocket connection');
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user?.id]);

  return (
    <ExecutionStoreContext.Provider value={{ store: storeRef.current, version: updateVersion }}>
      {children}
    </ExecutionStoreContext.Provider>
  );
};

export const useExecutionStore = (): ExecutionContext => {
  const ctx = useContext(ExecutionStoreContext);
  if (!ctx) {
    throw new Error('useExecutionStore must be used within an ExecutionStoreProvider');
  }
  return ctx.store;
};

export const useExecutionStoreVersion = (): number => {
  const ctx = useContext(ExecutionStoreContext);
  return ctx?.version ?? 0;
};

export default ExecutionStoreContext;
