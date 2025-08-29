import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: string;
}

export interface WebSocketStats {
  totalClients: number;
  connectedUsers: number;
  activeSessions: number;
}

export const useWebSocket = () => {
  const { session } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [stats, setStats] = useState<WebSocketStats | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const connect = useCallback(() => {
    if (!session?.access_token) {
      console.log('No access token available for WebSocket connection');
      return;
    }

    try {
      // Connect to WebSocket server with JWT token
      const wsUrl = `ws://localhost:8081?token=${session.access_token}`;
      console.log('Connecting to WebSocket:', wsUrl);
      
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected');
        setIsConnected(true);
        setReconnectAttempts(0);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('📨 WebSocket message received:', message);
          setLastMessage(message);

          // Handle specific message types
          if (message.type === 'connected') {
            console.log('🎉 WebSocket connection confirmed:', message.payload);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onclose = (event) => {
        console.log('❌ WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        
        // Attempt to reconnect if not a clean close
        if (event.code !== 1000 && reconnectAttempts < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, delay);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setIsConnected(false);
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [session?.access_token, reconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setReconnectAttempts(0);
  }, []);

  const sendMessage = useCallback((message: Omit<WebSocketMessage, 'timestamp'>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString()
      };
      console.log('📤 Sending WebSocket message:', messageWithTimestamp);
      wsRef.current.send(JSON.stringify(messageWithTimestamp));
      return true;
    }
    console.warn('⚠️ WebSocket not connected - message not sent:', message);
    return false;
  }, []);

  const ping = useCallback(() => {
    return sendMessage({ type: 'ping' });
  }, [sendMessage]);

  const subscribeToWorkflow = useCallback((workflowId: string) => {
    return sendMessage({ 
      type: 'subscribe_workflow', 
      payload: { workflowId } 
    });
  }, [sendMessage]);

  const subscribeToBroker = useCallback((broker: string) => {
    return sendMessage({ 
      type: 'broker_subscribe', 
      payload: { broker } 
    });
  }, [sendMessage]);

  const requestAlpacaStream = useCallback((symbols: string[]) => {
    return sendMessage({ 
      type: 'alpaca_stream', 
      payload: { symbols } 
    });
  }, [sendMessage]);

  // Auto-connect when session is available
  useEffect(() => {
    if (session?.access_token) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [session?.access_token, connect, disconnect]);

  // Fetch WebSocket stats periodically when connected
  useEffect(() => {
    if (!isConnected) return;

    const fetchStats = async () => {
      try {
        const response = await fetch('http://localhost:3001/websocket/status');
        if (response.ok) {
          const data = await response.json();
          setStats(data.websocket);
        }
      } catch (error) {
        console.error('Error fetching WebSocket stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000); // Every 10 seconds

    return () => clearInterval(interval);
  }, [isConnected]);

  return {
    isConnected,
    lastMessage,
    stats,
    connect,
    disconnect,
    sendMessage,
    ping,
    subscribeToWorkflow,
    subscribeToBroker,
    requestAlpacaStream,
    reconnectAttempts
  };
};