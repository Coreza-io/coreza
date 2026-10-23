import { resultSuccess, resultFailure, resultState } from "@/utils/nodeResult";
import { publishNodeResult } from "@/utils/publishNodeResult";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { createContext, useContext, useRef, useEffect, useState, useCallback, useMemo, useSyncExternalStore, startTransition } from 'react';
import ExecutionContext, { type NodeExecutionData } from '@/utils/executionContext';
import { useStableNodes } from './StableNodeContext';
import { resolveListeningFlagKey } from '@/components/nodes/listeningStop';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { StaticExecutionStoreContext } from './StaticExecutionStoreContext';

const ExecutionStoreContext = createContext<{
  store: ExecutionContext;
  version: number;
  notifyUpdate: () => void;
} | null>(null);

// Imperative readers must not subscribe to every execution-result notification.
const ExecutionStoreAccessContext = createContext<{
  store: ExecutionContext;
  notifyUpdate: () => void;
  subscribe: (listener: () => void) => () => void;
} | null>(null);
const EMPTY_NODE_DATA: NodeExecutionData = Object.freeze({});
const emptySubscribe = () => () => {};

const BACKEND_WS_URL = import.meta.env.VITE_BACKEND_WS_URL || 'ws://localhost:8081';
const STREAM_PAUSE_DEBUG = false;
const debugLog = (...args: unknown[]) => {
  if (import.meta.env.DEV && import.meta.env.VITE_DEBUG_EXECUTION === 'true') console.debug(...args);
};

export const ExecutionStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const storeRef = useRef<ExecutionContext>();
  const { user, session: authSession } = useAuth();
  const { getNodeById, updateNodeData } = useStableNodes();
  const [updateVersion, setUpdateVersion] = useState(0);
  const listenersRef = useRef(new Set<() => void>());
  const notifyUpdate = useCallback(() => {
    storeRef.current?.flushNotifications();
    startTransition(() => setUpdateVersion(v => v + 1));
    listenersRef.current.forEach(listener => listener());
  }, []);
  
  if (!storeRef.current) {
    storeRef.current = new ExecutionContext();
  }

  const access = useMemo(() => ({
    store: storeRef.current!,
    notifyUpdate,
    subscribe: (listener: () => void) => {
      listenersRef.current.add(listener);
      return () => { listenersRef.current.delete(listener); };
    },
  }), [notifyUpdate]);

  const publishSocketUpdate = useCallback((nodeId: string, patch: Partial<NodeExecutionData>) => {
    const { output, ...flags } = patch;
    publishNodeResult(output, { nodeId, isCurrent: () => !!getNodeById(nodeId),
      updateNodeData, store: storeRef.current!, notify: notifyUpdate }, flags);
  }, [getNodeById, updateNodeData, notifyUpdate]);

  // WebSocket listener for streaming market data
  useEffect(() => {
    if (!user?.id || !authSession?.access_token) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;

    const connectWebSocket = async () => {
      if (disposed) return;

      // Get JWT token from Supabase session
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (disposed) return;
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
        debugLog('📡 [ExecutionStore] Connecting to WebSocket:', BACKEND_WS_URL);

        const ws = new WebSocket(wsUrl);
        socket = ws;
        const ownsConnection = () => !disposed && socket === ws;

        ws.onopen = () => {
          if (!ownsConnection()) return;
          debugLog('✅ [ExecutionStore] WebSocket connected');

          // Start keepalive - send ping every 25 seconds
          if (keepalive) {
            clearInterval(keepalive);
          }
          keepalive = setInterval(() => {
            if (ownsConnection() && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }));
              debugLog('💓 [ExecutionStore] Sent keepalive ping');
            }
          }, 25000);
        };

        ws.onmessage = (event) => {
          if (!ownsConnection()) return;
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
              debugLog('💓 [ExecutionStore] Received pong');
              return;
            }

            debugLog('📨 [ExecutionStore] Received WebSocket message:', message);

            const webhookIsCurrent = (nodeId: string): boolean => {
              const node = getNodeById(nodeId);
              if (!node) return false;
              const runtime = storeRef.current!.getNodeData(nodeId);
              const flag = resolveListeningFlagKey(node.data.definition as Parameters<typeof resolveListeningFlagKey>[0]);
              return runtime[flag] === true && (!message.workflowId || runtime.testListenWorkflowId === message.workflowId);
            };

            // Handle webhook events (manual run mode)
            if (message.type === 'webhook_event' && Object.prototype.hasOwnProperty.call(message, 'payload')) {
              const { nodeId, payload } = message;

              if (nodeId && webhookIsCurrent(nodeId)) {
                publishSocketUpdate(nodeId, {
                  output: resultSuccess({ webhookPayload: payload, receivedAt: message.timestamp }, { meta: { timestamp: message.timestamp } })
                });
                debugLog('🪝 [ExecutionStore] Webhook data received for node:', nodeId);
              }
            }

            // Handle terminal webhook listener errors (manual run mode)
            if (message.type === 'webhook_error' && message.nodeId) {
              const { nodeId, error } = message;

              if (webhookIsCurrent(nodeId)) {
                publishSocketUpdate(nodeId, {
                  isListening: false,
                  isTestListening: false,
                  output: resultFailure(error?.message ?? 'Trigger stopped due to an error', {
                    data: { endedAt: message.timestamp }, details: { code: error?.code }, meta: { timestamp: message.timestamp },
                  }),
                });
              }

              console.warn('🪝 [ExecutionStore] Webhook error for node:', nodeId, error);
            }

            // Handle streaming market data updates (new Redis Pub/Sub format)
            if (message.type === 'market_data' && message.payload) {
              const { workflowId, nodeId, source: eventSource, data } = message.payload;

              if (nodeId && storeRef.current) {
                // Only update if this node is actively test listening
                const existingData = storeRef.current.getNodeData(nodeId);
                if (existingData?.isTestListening) {
                  if (
                    workflowId &&
                    existingData.testListenWorkflowId &&
                    workflowId !== existingData.testListenWorkflowId
                  ) {
                    debugLog('🚫 [ExecutionStore] WorkflowId mismatch, ignoring:', {
                      nodeId,
                      expected: existingData.testListenWorkflowId,
                      received: workflowId,
                    });
                    return;
                  }

                  const listenerSource = existingData.testListenSource;
                  if (listenerSource && eventSource) {
                    const listenerBroker = String(listenerSource).split('_')[0].toLowerCase();
                    const eventBroker = String(eventSource).split('_')[0].toLowerCase();
                    if (listenerBroker !== eventBroker) {
                      debugLog('🚫 [ExecutionStore] Source mismatch, ignoring:', {
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
                    debugLog(
                      `[ExecutionStore] ${isReplay ? "ACCEPT(replay)" : "DROP(paused)"}`,
                      { nodeId, type: message.type, entryId: eventEntryId },
                    );
                  }
                  if (existingData?.isStreamPaused && !isReplay) {
                    debugLog('⏸️ [ExecutionStore] Stream paused, skipping update for:', nodeId);
                    return;
                  }
                  publishSocketUpdate(nodeId, {
                    output: resultState("streaming", data, { meta: { timestamp: message.timestamp ?? new Date().toISOString() } }),
                    ...(eventEntryId ? { lastStreamEntryId: eventEntryId } : {}),
                  });
                  debugLog(
                    isReplay
                      ? '🔁 [ExecutionStore] Replayed event for:'
                      : '✅ [ExecutionStore] Updated node data for:',
                    nodeId,
                  );
                } else {
                  debugLog('⚠️ [ExecutionStore] Ignoring market_data for non-listening node:', nodeId);
                }
              }
            }



          } catch (error) {
            console.error('❌ [ExecutionStore] Failed to parse WebSocket message:', error);
          }
        };

        ws.onerror = (error) => {
          if (!ownsConnection()) return;
          console.error('❌ [ExecutionStore] WebSocket error:', error);
        };

        ws.onclose = () => {
          if (!ownsConnection()) return;
          socket = null;
          debugLog('🔌 [ExecutionStore] WebSocket disconnected');

          // Clear keepalive interval
          if (keepalive) {
            clearInterval(keepalive);
            keepalive = null;
          }

          // Only reconnect if flag allows (not during cleanup)
          if (!disposed) {
            debugLog('🔄 [ExecutionStore] Reconnecting in 3s...');
            reconnect = setTimeout(() => { reconnect = null; void connectWebSocket(); }, 3000);
          }
        };
      } catch (error) {
        if (disposed) return;
        console.error('❌ [ExecutionStore] Unexpected error while establishing WebSocket:', error);
        return;
      }
    };

    void connectWebSocket();
    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      if (keepalive) clearInterval(keepalive);
      if (socket) {
        socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close();
        socket = null;
      }
    };
  }, [user?.id, authSession?.access_token, getNodeById, publishSocketUpdate]);

  return (
    <ExecutionStoreAccessContext.Provider value={access}>
      <ExecutionStoreContext.Provider value={{ store: access.store, version: updateVersion, notifyUpdate }}>
        {children}
      </ExecutionStoreContext.Provider>
    </ExecutionStoreAccessContext.Provider>
  );
};

export const useExecutionStore = (): ExecutionContext => {
  // Check for static (historical view) context first - this provides isolation
  const staticCtx = useContext(StaticExecutionStoreContext);
  const ctx = useContext(ExecutionStoreAccessContext);
  if (staticCtx) return staticCtx.store;

  // Fall back to main editor context
  if (!ctx) {
    throw new Error('useExecutionStore must be used within an ExecutionStoreProvider');
  }
  return ctx.store;
};

export const useExecutionStoreVersion = (): number => {
  // Check for static context first
  const staticCtx = useContext(StaticExecutionStoreContext);
  const ctx = useContext(ExecutionStoreAccessContext);
  const getSnapshot = useCallback(() => staticCtx?.version ?? ctx?.store.version ?? 0, [staticCtx, ctx]);
  const version = useSyncExternalStore(staticCtx ? emptySubscribe : ctx?.subscribe ?? emptySubscribe, getSnapshot, getSnapshot);
  return staticCtx?.version ?? version;
};

export const useExecutionStoreNotify = (): (() => void) => {
  // Check for static context first
  const staticCtx = useContext(StaticExecutionStoreContext);
  const ctx = useContext(ExecutionStoreAccessContext);
  if (staticCtx) return staticCtx.notifyUpdate;

  return ctx?.notifyUpdate ?? (() => {});
};

/** Subscribe only to one node; unrelated result updates retain snapshot identity. */
export const useExecutionNodeData = (nodeId: string | null | undefined): NodeExecutionData => {
  const staticCtx = useContext(StaticExecutionStoreContext);
  const ctx = useContext(ExecutionStoreAccessContext);
  const store = staticCtx?.store ?? ctx?.store;
  const getSnapshot = useCallback(
    () => nodeId ? store?.storeMap.get(nodeId) ?? EMPTY_NODE_DATA : EMPTY_NODE_DATA,
    [nodeId, store],
  );
  const subscribe = useCallback((listener: () => void) =>
    !staticCtx && store && nodeId ? store.subscribeNode(nodeId, listener) : () => undefined, [staticCtx, store, nodeId]);
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
};

export default ExecutionStoreContext;

/** A closed card reads only control flags, never the invisible output payload. */
export function useExecutionNodeStatus(nodeId: string | null | undefined, listeningFlag = "isListening"): string {
  const staticCtx = useContext(StaticExecutionStoreContext);
  const ctx = useContext(ExecutionStoreAccessContext);
  const store = staticCtx?.store ?? ctx?.store;
  const subscribe = useCallback((listener: () => void) => !staticCtx && store && nodeId ? store.subscribeNode(nodeId, listener) : () => undefined, [staticCtx, store, nodeId]);
  const getSnapshot = useCallback(() => {
    const data = nodeId ? store?.storeMap.get(nodeId) : undefined;
    return JSON.stringify([(data as unknown as Record<string, unknown> | undefined)?.[listeningFlag], data?.isListening, data?.isTestListening, data?.isStreamingWaiting, data?.isStreamPaused, data?.isStreamStepping, !!data?.lastStreamEntryId]);
  }, [store, nodeId, listeningFlag]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** null is an intentional fallback for dynamic references; only mounted previews use it. */
export function useExecutionSourceVersions(nodeIds: readonly string[] | null): string {
  const staticCtx = useContext(StaticExecutionStoreContext);
  const ctx = useContext(ExecutionStoreAccessContext);
  const store = staticCtx?.store ?? ctx?.store;
  const subscribe = useCallback((listener: () => void) => {
    if (staticCtx || !store) return () => undefined;
    if (nodeIds === null) return ctx?.subscribe(listener) ?? (() => undefined);
    const disposers = nodeIds.map(id => store.subscribeNode(id, listener));
    return () => disposers.forEach(dispose => dispose());
  }, [staticCtx, store, ctx, nodeIds]);
  const getSnapshot = useCallback(() => staticCtx ? String(staticCtx.version)
    : nodeIds === null ? String(store?.version ?? 0) : nodeIds.map(id => store?.getNodeVersion(id) ?? 0).join(":"), [staticCtx, store, nodeIds]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
