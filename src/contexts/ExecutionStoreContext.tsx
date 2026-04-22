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
const MANUAL_STREAM_DELAY_MS = Number(import.meta.env.VITE_MANUAL_STREAM_DELAY_MS ?? 800);
const MAX_STREAM_HISTORY = 50;
const ORDER_UPDATE_EVENT_TYPE = 'order_update';

type StreamQueueItem = {
  output: Record<string, any>;
  historyEntry: {
    type?: string;
    status?: string;
    time: string;
    data: any;
    seq?: number;
  };
};

export const ExecutionStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const storeRef = useRef<ExecutionContext>();
  const wsRef = useRef<WebSocket | null>(null);
  const keepaliveRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  const streamQueueRef = useRef<Map<string, { queue: StreamQueueItem[]; timer: NodeJS.Timeout | null }>>(new Map());
  const { user } = useAuth();
  const [updateVersion, setUpdateVersion] = useState(0);
  
  if (!storeRef.current) {
    storeRef.current = new ExecutionContext();
  }

  const appendStreamHistory = (nodeId: string, entry: StreamQueueItem['historyEntry']) => {
    if (!storeRef.current) return;
    const existingData = storeRef.current.getNodeData(nodeId);
    const history = existingData?.streamEventHistory || [];
    const nextHistory = [...history, entry].slice(-MAX_STREAM_HISTORY);
    storeRef.current.setNodeData(nodeId, { streamEventHistory: nextHistory });
  };

  const applyStreamOutput = (nodeId: string, item: StreamQueueItem) => {
    if (!storeRef.current) return;
    appendStreamHistory(nodeId, item.historyEntry);
    storeRef.current.setNodeData(nodeId, {
      output: item.output,
      streamDataReceived: true,
    });
    setUpdateVersion(v => v + 1);
  };

  const clearNodeQueue = (nodeId: string) => {
    const state = streamQueueRef.current.get(nodeId);
    if (!state) return;
    if (state.timer) {
      clearTimeout(state.timer);
    }
    streamQueueRef.current.delete(nodeId);
  };

  const drainNodeQueue = (nodeId: string) => {
    const state = streamQueueRef.current.get(nodeId);
    if (!state || state.queue.length === 0) {
      clearNodeQueue(nodeId);
      return;
    }

    const nextItem = state.queue.shift();
    if (!nextItem) {
      clearNodeQueue(nodeId);
      return;
    }

    applyStreamOutput(nodeId, nextItem);

    if (state.queue.length === 0) {
      clearNodeQueue(nodeId);
      return;
    }

    const nodeData = storeRef.current?.getNodeData(nodeId);
    const nodeDelay = Number(nodeData?.manualStreamDelayMs ?? MANUAL_STREAM_DELAY_MS);
    state.timer = setTimeout(
      () => drainNodeQueue(nodeId),
      Number.isFinite(nodeDelay) ? Math.max(0, nodeDelay) : MANUAL_STREAM_DELAY_MS,
    );
  };

  const enqueueOrderUpdate = (nodeId: string, item: StreamQueueItem) => {
    const existing = streamQueueRef.current.get(nodeId);
    if (existing) {
      existing.queue.push(item);
      if (!existing.timer) {
        drainNodeQueue(nodeId);
      }
      return;
    }
    streamQueueRef.current.set(nodeId, { queue: [item], timer: null });
    drainNodeQueue(nodeId);
  };

  const flushAllQueues = () => {
    for (const [nodeId, state] of streamQueueRef.current.entries()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      while (state.queue.length > 0) {
        const nextItem = state.queue.shift();
        if (nextItem) {
          applyStreamOutput(nodeId, nextItem);
        }
      }
      streamQueueRef.current.delete(nodeId);
    }
  };

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
              const { nodeId, data } = message.payload;

              if (nodeId && storeRef.current) {
                // Only update if this node is actively test listening
                const existingData = storeRef.current.getNodeData(nodeId);
                if (existingData?.isTestListening) {
                  // Skip UI update if stream is paused (stream stays alive on backend)
                  if (existingData?.isStreamPaused) {
                    appendStreamHistory(nodeId, {
                      type: data?.type || 'market_data',
                      status: data?.status,
                      time: data?.event_time || new Date().toISOString(),
                      data,
                      seq: data?._seq,
                    });
                    console.log('⏸️ [ExecutionStore] Stream paused, skipping update for:', nodeId);
                    return;
                  }
                  clearNodeQueue(nodeId);
                  const output = {
                      status: 'streaming',
                      data,
                      lastUpdate: new Date().toISOString()
                    };
                  appendStreamHistory(nodeId, {
                    type: data?.type || 'market_data',
                    status: data?.status,
                    time: output.lastUpdate,
                    data,
                    seq: data?._seq,
                  });
                  storeRef.current.setNodeData(nodeId, { output, streamDataReceived: true });
                  setUpdateVersion(v => v + 1);
                  console.log('✅ [ExecutionStore] Updated node data for:', nodeId);
                } else {
                  console.log('⚠️ [ExecutionStore] Ignoring market_data for non-listening node:', nodeId);
                }
              }
            }

            // Handle test listener data (WebSocket push instead of polling)
            // KEEP isTestListening: true so the Stop button remains visible
            if (message.type === 'test_data_received' && message.payload) {
              const { nodeId, data } = message.payload;

              if (nodeId && storeRef.current) {
                // Skip UI update if stream is paused
                const existingData2 = storeRef.current.getNodeData(nodeId);
                if (existingData2?.isStreamPaused) {
                  appendStreamHistory(nodeId, {
                    type: data.type,
                    status: data.data?.status || data.status,
                    time: data.event_time || data.receivedAt || new Date().toISOString(),
                    data: data.data,
                    seq: data._seq,
                  });
                  console.log('⏸️ [ExecutionStore] Stream paused, skipping test_data for:', nodeId);
                  return;
                }

                const receivedOutput = {
                  status: 'streaming',
                  symbol: data.symbol,
                  type: data.type,
                  data: data.data,
                  receivedAt: data.receivedAt,
                  source: data.source,
                  event_time: data.event_time,
                  _seq: data._seq,
                  [data.type]: data.data?.[data.type] || data.data,
                };

                const historyEntry = {
                  type: data.type,
                  status: data.data?.status || data.status,
                  time: data.event_time || data.receivedAt || new Date().toISOString(),
                  data: data.data,
                  seq: data._seq,
                };

                if (data.type === ORDER_UPDATE_EVENT_TYPE) {
                  enqueueOrderUpdate(nodeId, {
                    output: receivedOutput,
                    historyEntry,
                  });
                } else {
                  clearNodeQueue(nodeId);
                  applyStreamOutput(nodeId, {
                    output: receivedOutput,
                    historyEntry,
                  });
                }
                console.log('🎯 [ExecutionStore] Test data received via WebSocket for node:', nodeId);
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
      flushAllQueues();
      
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

  useEffect(() => {
    if (!storeRef.current) return;
    for (const nodeId of streamQueueRef.current.keys()) {
      const nodeData = storeRef.current.getNodeData(nodeId);
      if (nodeData?.isTestListening === false) {
        const queueState = streamQueueRef.current.get(nodeId);
        if (!queueState) continue;
        if (queueState.timer) {
          clearTimeout(queueState.timer);
        }
        while (queueState.queue.length > 0) {
          const nextItem = queueState.queue.shift();
          if (nextItem) {
            applyStreamOutput(nodeId, nextItem);
          }
        }
        streamQueueRef.current.delete(nodeId);
      }
    }
  }, [updateVersion]);

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
