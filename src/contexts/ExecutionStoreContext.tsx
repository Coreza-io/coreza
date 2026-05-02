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

import { createContext, useContext, useRef, useEffect, useState } from 'react';
import ExecutionContext from '@/utils/executionContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { StaticExecutionStoreContext } from './StaticExecutionStoreContext';

const ExecutionStoreContext = createContext<{
  store: ExecutionContext;
  version: number;
  notifyUpdate: () => void;
} | null>(null);

const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8081';
const STREAM_PAUSE_DEBUG = false;

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
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          if ((error as { code?: string }).code === 'refresh_token_not_found') {
            console.warn('⚠️ [ExecutionStore] Missing refresh token. Skipping WebSocket connection until user re-authenticates.');
          } else {
            console.error('❌ [ExecutionStore] Failed to retrieve session for WebSocket:', error);
          }
          return;
        }

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
            const extractReplayFlag = (d: any): boolean =>
              d?._replay === true ||
              d?.data?._replay === true ||
              d?.data?.data?._replay === true;
            const extractEntryId = (d: any): string | undefined =>
              d?._entryId ||
              d?.data?._entryId ||
              d?.data?.data?._entryId;

            // Ignore pong messages (keepalive response)
            if (message.type === 'pong') {
              console.log('💓 [ExecutionStore] Received pong');
              return;
            }

            console.log('📨 [ExecutionStore] Received WebSocket message:', message);

            // Handle webhook events (manual run mode)
            if (message.type === 'webhook_event' && message.payload) {
              const { nodeId, payload } = message;

              if (nodeId && storeRef.current) {
                storeRef.current.setNodeData(nodeId, {
                  output: {
                    webhookPayload: payload,
                    receivedAt: message.timestamp
                  }
                });
                setUpdateVersion(v => v + 1); // Trigger React re-render
                console.log('🪝 [ExecutionStore] Webhook data received for node:', nodeId);
              }
            }

            // Handle streaming market data updates (new Redis Pub/Sub format)
            if (message.type === 'market_data' && message.payload) {
              const { nodeId, source: eventSource, data } = message.payload;

              if (nodeId && storeRef.current) {
                // Only update if this node is actively test listening
                const existingData = storeRef.current.getNodeData(nodeId);
                if (existingData?.isTestListening) {
                  const listenerSource = existingData.testListenSource;
                  if (listenerSource && eventSource) {
                    const listenerBroker = String(listenerSource).split('_')[0].toLowerCase();
                    const eventBroker = String(eventSource).split('_')[0].toLowerCase();
                    if (listenerBroker !== eventBroker) {
                      console.log('🚫 [ExecutionStore] Source mismatch, ignoring:', {
                        nodeId,
                        listenerSource,
                        eventSource,
                      });
                      return;
                    }
                  }

                  // Skip live updates while paused, but allow replayed events through.
                  const eventEntryId =
                    extractEntryId(data) || extractEntryId(message.payload);
                  const isReplay =
                    extractReplayFlag(data) || extractReplayFlag(message.payload);
                  if (STREAM_PAUSE_DEBUG && existingData?.isStreamPaused) {
                    console.log(
                      `[ExecutionStore] ${isReplay ? "ACCEPT(replay)" : "DROP(paused)"}`,
                      { nodeId, type: message.type, entryId: eventEntryId },
                    );
                  }
                  if (existingData?.isStreamPaused && !isReplay) {
                    console.log('⏸️ [ExecutionStore] Stream paused, skipping update for:', nodeId);
                    return;
                  }
                  storeRef.current.setNodeData(nodeId, {
                    output: {
                      status: 'streaming',
                      data,
                      lastUpdate: new Date().toISOString()
                    },
                    ...(eventEntryId ? { lastStreamEntryId: eventEntryId } : {}),
                  });
                  setUpdateVersion(v => v + 1); // Trigger React re-render
                  console.log(
                    isReplay
                      ? '🔁 [ExecutionStore] Replayed event for:'
                      : '✅ [ExecutionStore] Updated node data for:',
                    nodeId,
                  );
                } else {
                  console.log('⚠️ [ExecutionStore] Ignoring market_data for non-listening node:', nodeId);
                }
              }
            }



            // Handle legacy streaming format (WebSocketClient broadcasts)
            if (message.status === 'streaming' && message.payload?.nodeId) {
              const { nodeId, data } = message.payload;

              if (storeRef.current) {
                // Only update if this node is actively test listening
                const existingData = storeRef.current.getNodeData(nodeId);
                if (existingData?.isTestListening) {
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
                } else {
                  console.log('⚠️ [ExecutionStore] Ignoring legacy streaming for non-listening node:', nodeId);
                }
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
      } catch (error) {
        console.error('❌ [ExecutionStore] Unexpected error while establishing WebSocket:', error);
        return;
      }
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

  const notifyUpdate = () => setUpdateVersion(v => v + 1);

  return (
    <ExecutionStoreContext.Provider value={{ store: storeRef.current, version: updateVersion, notifyUpdate }}>
      {children}
    </ExecutionStoreContext.Provider>
  );
};

export const useExecutionStore = (): ExecutionContext => {
  // Check for static (historical view) context first - this provides isolation
  const staticCtx = useContext(StaticExecutionStoreContext);
  if (staticCtx) return staticCtx.store;
  
  // Fall back to main editor context
  const ctx = useContext(ExecutionStoreContext);
  if (!ctx) {
    throw new Error('useExecutionStore must be used within an ExecutionStoreProvider');
  }
  return ctx.store;
};

export const useExecutionStoreVersion = (): number => {
  // Check for static context first
  const staticCtx = useContext(StaticExecutionStoreContext);
  if (staticCtx) return staticCtx.version;
  
  const ctx = useContext(ExecutionStoreContext);
  return ctx?.version ?? 0;
};

export const useExecutionStoreNotify = (): (() => void) => {
  // Check for static context first
  const staticCtx = useContext(StaticExecutionStoreContext);
  if (staticCtx) return staticCtx.notifyUpdate;
  
  const ctx = useContext(ExecutionStoreContext);
  return ctx?.notifyUpdate ?? (() => {});
};

export default ExecutionStoreContext;
