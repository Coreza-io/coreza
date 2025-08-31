import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: string;
}

interface UseWebSocketOptions {
  autoConnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export const useWebSocket = (options: UseWebSocketOptions = {}) => {
  const { session } = useAuth();
  const { 
    autoConnect = true, 
    reconnectInterval = 5000, 
    maxReconnectAttempts = 10 
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const messageHandlersRef = useRef<Map<string, (payload: any) => void>>(new Map());

  const getWebSocketURL = useCallback(() => {
    if (!session?.access_token) return null;
    
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = process.env.NODE_ENV === 'development' ? '8081' : '8081';
    const wsHost = window.location.hostname;
    
    return `${wsProtocol}//${wsHost}:${wsPort}?token=${session.access_token}`;
  }, [session?.access_token]);

  const connect = useCallback(() => {
    if (!session?.access_token) {
      console.log('🔒 No access token available for WebSocket connection');
      return;
    }

    const wsUrl = getWebSocketURL();
    if (!wsUrl) return;

    try {
      setConnectionStatus('connecting');
      setError(null);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🟢 WebSocket connected');
        setIsConnected(true);
        setConnectionStatus('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          console.log('📨 WebSocket message received:', message);
          setLastMessage(message);

          // Call registered message handlers
          const handler = messageHandlersRef.current.get(message.type);
          if (handler) {
            handler(message.payload);
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('🔴 WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        setConnectionStatus('disconnected');
        wsRef.current = null;

        // Attempt reconnection if not manually closed
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`🔄 Attempting reconnection ${reconnectAttemptsRef.current}/${maxReconnectAttempts}`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setError('WebSocket connection error');
        setConnectionStatus('error');
      };

    } catch (error) {
      console.error('❌ Failed to create WebSocket connection:', error);
      setError('Failed to create WebSocket connection');
      setConnectionStatus('error');
    }
  }, [session?.access_token, getWebSocketURL, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setConnectionStatus('disconnected');
    reconnectAttemptsRef.current = 0;
  }, []);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && isConnected) {
      try {
        wsRef.current.send(JSON.stringify(message));
        console.log('📤 WebSocket message sent:', message);
        return true;
      } catch (error) {
        console.error('❌ Failed to send WebSocket message:', error);
        setError('Failed to send message');
        return false;
      }
    }
    console.warn('⚠️ WebSocket not connected, message not sent');
    return false;
  }, [isConnected]);

  const subscribeToMessages = useCallback((messageType: string, handler: (payload: any) => void) => {
    messageHandlersRef.current.set(messageType, handler);
    
    return () => {
      messageHandlersRef.current.delete(messageType);
    };
  }, []);

  const subscribeToAlpacaStream = useCallback((symbols: string[], credentialId: string) => {
    sendMessage({
      type: 'alpaca_stream',
      payload: {
        action: 'subscribe',
        symbols,
        credential_id: credentialId
      }
    });
  }, [sendMessage]);

  const unsubscribeFromAlpacaStream = useCallback((symbols: string[]) => {
    sendMessage({
      type: 'alpaca_stream',
      payload: {
        action: 'unsubscribe',
        symbols
      }
    });
  }, [sendMessage]);

  // Auto-connect when session is available
  useEffect(() => {
    if (autoConnect && session?.access_token && !isConnected) {
      connect();
    }
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [session?.access_token, autoConnect, isConnected, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connectionStatus,
    error,
    lastMessage,
    connect,
    disconnect,
    sendMessage,
    subscribeToMessages,
    subscribeToAlpacaStream,
    unsubscribeFromAlpacaStream,
  };
};