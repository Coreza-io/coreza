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

import WebSocket from "ws";
import { IncomingMessage } from "http";
import { URL } from "url";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { Server } from "net";
import { createRedisQueuePubSub } from "../config/redis";
import type Redis from "ioredis";
import { matchesEventFilters } from "../utils/streamFilters";
import {
  redisSMembersBreaker,
  redisGetBreaker,
  redisEvalBreaker,
  redisSRemBreaker,
} from "../utils/redisCircuitBreaker";
import {
  MAX_CONNECTIONS_PER_USER,
  WS_HEARTBEAT_INTERVAL_MS,
  TEST_RESULT_TTL_SECONDS,
  LISTENER_TTL_SECONDS,
  LUA_ATOMIC_LISTENER,
  LUA_DECREMENT_LISTENER_COUNT,
} from "../config/streaming";
import { REDIS_CHANNELS } from "../config/redisChannels";

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  sessionId?: string;
  isAlive?: boolean;
}

interface WebSocketMessage {
  type: string;
  payload?: any;
  timestamp?: string;
}

export class WebSocketManager {
  private static instance: WebSocketManager;
  private wss: WebSocket.Server | null = null;
  private clients = new Map<string, Set<AuthenticatedWebSocket>>();
  private sessions = new Map<string, AuthenticatedWebSocket>();
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  // Redis pub/sub for receiving market data from market-stream-service
  private redisSub: Redis | null = null;

  private constructor() {
    // Initialize JWKS for JWT verification with extended timeout and caching
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseAnonKey) {
      const jwksUrl = new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
      console.log(`🔐 Initializing JWKS from: ${jwksUrl.toString()}`);

      // Create JWKS with extended timeout, caching, and API key header
      this.jwks = createRemoteJWKSet(jwksUrl, {
        timeoutDuration: 15000, // 15 seconds timeout (default is 5s)
        cooldownDuration: 30000, // 30 seconds between refetches on error
        cacheMaxAge: 600000, // Cache JWKS for 10 minutes
        headers: {
          apikey: supabaseAnonKey, // Required by Supabase
        },
      });
    } else {
      if (!supabaseUrl)
        console.warn(
          "⚠️ SUPABASE_URL not set - JWT verification will be disabled",
        );
      if (!supabaseAnonKey)
        console.warn(
          "⚠️ SUPABASE_ANON_KEY not set - JWT verification will be disabled",
        );
    }
  }

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  /**
   * Test JWKS endpoint connectivity before starting server
   */
  private async testJwksEndpoint(): Promise<boolean> {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl) {
      console.warn("⚠️ SUPABASE_URL not set - skipping JWKS health check");
      return false;
    }

    if (!supabaseAnonKey) {
      console.warn("⚠️ SUPABASE_ANON_KEY not set - skipping JWKS health check");
      return false;
    }

    try {
      const jwksUrl = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
      console.log(`🔐 Testing JWKS endpoint: ${jwksUrl}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const response = await fetch(jwksUrl, {
        signal: controller.signal,
        headers: {
          apikey: supabaseAnonKey, // Required by Supabase
        },
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        console.log(
          `✅ JWKS endpoint reachable - ${
            data.keys?.length || 0
          } keys available`,
        );
        return true;
      } else {
        console.error(
          `❌ JWKS endpoint returned ${response.status}: ${response.statusText}`,
        );
        const body = await response.text();
        console.error(`   Response: ${body}`);
        return false;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.error(`❌ JWKS endpoint timed out after 15 seconds`);
      } else {
        console.error(
          `❌ JWKS endpoint unreachable:`,
          error instanceof Error ? error.message : error,
        );
      }
      return false;
    }
  }

  async initialize(port: number = 8081): Promise<void> {
    // Test JWKS endpoint connectivity first
    const jwksAvailable = await this.testJwksEndpoint();
    if (!jwksAvailable) {
      console.warn(
        "⚠️ JWKS endpoint not available - WebSocket auth may fail. Continuing anyway...",
      );
    }

    // Check if port is available
    const isPortAvailable = await this.checkPort(port);

    if (!isPortAvailable) {
      console.error(`❌ Port ${port} is already in use`);
      console.log(`💡 Solutions:`);
      console.log(
        `   1. Kill existing process: netstat -ano | findstr :${port}`,
      );
      console.log(`   2. Change WEBSOCKET_PORT in .env`);
      console.log(`   3. Run: taskkill /PID <PID> /F`);
      throw new Error(`Port ${port} is already in use`);
    }

    this.wss = new WebSocket.Server({
      port,
      verifyClient: (info, done) => {
        this.verifyClient(info, done);
      },
    });

    this.wss.on("connection", this.handleConnection.bind(this));
    this.wss.on("error", this.handleServerError.bind(this));
    this.setupHeartbeat();
    this.setupRedisSubscription();

    console.log(`🔌 WebSocket server started on port ${port}`);
  }

  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = new Server();

      server.once("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
        }
      });

      server.once("listening", () => {
        server.close();
        resolve(true);
      });

      server.listen(port);
    });
  }

  private handleServerError(error: Error): void {
    console.error("WebSocket server error:", error);
    if (error.message.includes("EADDRINUSE")) {
      console.log("💡 Try: taskkill /PID <PID> /F or change WEBSOCKET_PORT");
    }
  }

  private async verifyClient(
    info: {
      origin: string;
      secure: boolean;
      req: IncomingMessage;
    },
    done: (result: boolean, code?: number, message?: string) => void,
  ): Promise<void> {
    try {
      const url = new URL(
        info.req.url || "",
        `http://${info.req.headers.host}`,
      );
      const token = url.searchParams.get("token");

      if (!token) {
        console.warn("WebSocket connection rejected: No token provided");
        done(false, 401, "Unauthorized");
        return;
      }

      // Verify JWT token with proper signature validation
      const decoded = await this.verifyJWT(token);
      if (!decoded.userId) {
        console.warn("WebSocket connection rejected: Invalid token");
        done(false, 401, "Unauthorized");
        return;
      }

      // Store user info in request for later use
      (info.req as any).userId = decoded.userId;
      done(true);
    } catch (error) {
      console.error("WebSocket verification error:", error);
      done(false, 401, "Unauthorized");
    }
  }

  /**
   * Verify JWT token with proper signature validation using Supabase JWKS
   * Production-ready implementation with security checks
   */
  private async verifyJWT(token: string): Promise<{ userId: string }> {
    try {
      if (!this.jwks) {
        console.error(
          "❌ JWKS not initialized - check SUPABASE_URL and SUPABASE_ANON_KEY",
        );
        throw new Error(
          "JWKS not initialized - SUPABASE_URL and SUPABASE_ANON_KEY required",
        );
      }

      // Verify JWT signature against Supabase JWKS endpoint
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: process.env.SUPABASE_URL
          ? `${process.env.SUPABASE_URL}/auth/v1`
          : undefined,
      });

      const userId = payload.sub;
      if (!userId) {
        throw new Error("Token missing user identifier (sub)");
      }

      // Additional security checks
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        throw new Error("Token expired");
      }

      console.log(`✅ JWT verified successfully for user: ${userId}`);
      return { userId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = (error as any)?.code;

      console.error(`❌ JWT verification failed: ${message}`);

      // Provide specific guidance based on error type
      if (errorCode === "ERR_JWKS_TIMEOUT" || message.includes("timed out")) {
        console.error(
          `   → Network timeout fetching JWKS. Check connectivity to Supabase.`,
        );
        console.error(
          `   → Try: curl ${process.env.SUPABASE_URL}/auth/v1/jwks`,
        );
        console.error(
          `   → Or check if Supabase URL is correct: ${process.env.SUPABASE_URL}`,
        );
      } else if (message.includes("Expected 200 OK")) {
        console.error(
          `   → JWKS endpoint not returning 200. Supabase may be down or unreachable.`,
        );
        console.error(
          `   → Verify SUPABASE_URL in .env: ${process.env.SUPABASE_URL}`,
        );
      }

      throw new Error("Invalid or expired token");
    }
  }

  private handleConnection(
    ws: AuthenticatedWebSocket,
    req: IncomingMessage,
  ): void {
    const userId = (req as any).userId;
    if (!userId) {
      console.warn("WebSocket connection missing userId after verification");
      ws.close(1008, "Authentication required");
      return;
    }

    // Check connection limit per user
    const existingClients = this.clients.get(userId);
    if (existingClients && existingClients.size >= MAX_CONNECTIONS_PER_USER) {
      console.warn(
        `⚠️ User ${userId} exceeded max connections (${MAX_CONNECTIONS_PER_USER}), rejecting`,
      );
      ws.close(
        1013,
        `Maximum connections (${MAX_CONNECTIONS_PER_USER}) exceeded`,
      );
      return;
    }

    const sessionId = this.generateSessionId();

    console.log(
      `🔌 New WebSocket connection - userId: ${userId}, sessionId: ${sessionId}`,
    );

    ws.userId = userId;
    ws.sessionId = sessionId;
    ws.isAlive = true;

    // Add to user clients
    if (!this.clients.has(userId)) {
      console.log(`📝 Creating new client set for user ${userId}`);
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(ws);
    this.sessions.set(sessionId, ws);

    console.log(`👤 User ${userId} connected (session: ${sessionId})`);
    console.log(
      `📊 Total clients for user ${userId}: ${
        this.clients.get(userId)?.size
      }/${MAX_CONNECTIONS_PER_USER}`,
    );
    console.log(`📊 Total connected users: ${this.clients.size}`);

    // Send welcome message
    this.sendMessage(ws, {
      type: "connected",
      payload: { sessionId, userId, maxConnections: MAX_CONNECTIONS_PER_USER },
      timestamp: new Date().toISOString(),
    });

    // Set up message handlers
    ws.on("message", (data: WebSocket.Data) => {
      this.handleMessage(ws, data);
    });

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("close", () => {
      this.handleDisconnection(ws);
    });

    ws.on("error", (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
      this.handleDisconnection(ws);
    });
  }

  private handleMessage(
    ws: AuthenticatedWebSocket,
    data: WebSocket.Data,
  ): void {
    try {
      const message = JSON.parse(data.toString()) as WebSocketMessage;

      console.log(`📨 Received message from ${ws.userId}:`, message.type);

      switch (message.type) {
        case "ping":
          this.sendMessage(ws, {
            type: "pong",
            timestamp: new Date().toISOString(),
          });
          break;

        case "subscribe_workflow":
          this.handleWorkflowSubscription(ws, message.payload);
          break;

        case "workflow_action":
          this.handleWorkflowAction(ws, message.payload);
          break;

        case "agent_message":
          this.handleAgentMessage(ws, message.payload);
          break;

        case "broker_subscribe":
          this.handleBrokerSubscription(ws, message.payload);
          break;

        case "websocket_stream":
          this.handleWebSocketStream(ws, message.payload);
          break;

        case "alpaca_news":
          this.handleWebSocketStream(ws, {
            source: "alpaca_news",
            ...message.payload,
          });
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
      this.sendMessage(ws, {
        type: "error",
        payload: { message: "Invalid message format" },
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleWorkflowSubscription(
    ws: AuthenticatedWebSocket,
    payload: any,
  ): void {
    console.log(`User ${ws.userId} subscribed to workflow updates`);

    this.sendMessage(ws, {
      type: "workflow_subscribed",
      payload: { success: true },
      timestamp: new Date().toISOString(),
    });
  }

  private handleWorkflowAction(ws: AuthenticatedWebSocket, payload: any): void {
    console.log(`User ${ws.userId} performed workflow action:`, payload);
  }

  private handleAgentMessage(ws: AuthenticatedWebSocket, payload: any): void {
    console.log(`User ${ws.userId} sent agent message:`, payload);
  }

  private handleBrokerSubscription(
    ws: AuthenticatedWebSocket,
    payload: any,
  ): void {
    console.log(
      `User ${ws.userId} subscribed to broker ${payload.broker} events`,
    );

    this.sendMessage(ws, {
      type: "broker_subscribed",
      payload: { broker: payload.broker, success: true },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle WebSocket stream subscriptions/unsubscriptions
   * DEPRECATED: This direct WebSocket subscription path is no longer used.
   * All subscriptions now go through HTTP POST /websocket/:source/subscribe
   * which publishes control messages to market-stream-service via Redis.
   */
  private async handleWebSocketStream(
    ws: AuthenticatedWebSocket,
    payload: any,
  ): Promise<void> {
    const { source, action } = payload || {};

    console.warn(
      `⚠️ [WebSocketManager] Received legacy WebSocket subscription message. Use HTTP POST /websocket/:source/subscribe instead.`,
    );

    this.sendMessage(ws, {
      type: "error",
      payload: {
        error:
          "Direct WebSocket subscriptions are deprecated. Use HTTP POST /websocket/:source/subscribe endpoint.",
      },
    });
  }

  private handleDisconnection(ws: AuthenticatedWebSocket): void {
    if (ws.userId && ws.sessionId) {
      console.log(
        `👋 User ${ws.userId} disconnected (session: ${ws.sessionId})`,
      );

      // Remove from clients
      const userClients = this.clients.get(ws.userId);
      if (userClients) {
        userClients.delete(ws);
        if (userClients.size === 0) {
          this.clients.delete(ws.userId);
        }
      }

      // Remove from sessions
      this.sessions.delete(ws.sessionId);
    }
  }

  private sendMessage(
    ws: AuthenticatedWebSocket,
    message: WebSocketMessage,
  ): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupRedisSubscription(): void {
    // Setup Redis subscriber for user-specific market data from market-stream-service
    // All market data now flows through: market-stream-service → ws:user:{userId} → WebSocketManager
    const { sub, pub } = createRedisQueuePubSub();
    this.redisSub = sub;

    // Subscribe to pattern ws:user:* to receive market data for all users
    this.redisSub.psubscribe("ws:user:*", (err, count) => {
      if (err) {
        console.error("❌ Failed to subscribe to ws:user:* pattern:", err);
      } else {
        console.log(
          `✅ Subscribed to ws:user:* pattern (${count} patterns active)`,
        );
      }
    });

    // Handle incoming messages from market-stream-service
    this.redisSub.on(
      "pmessage",
      async (pattern: string, channel: string, message: string) => {
        try {
          // Extract userId from channel name: ws:user:{userId}
          const userId = channel.split(":")[2];
          if (!userId) {
            console.warn(`⚠️ Invalid channel format: ${channel}`);
            return;
          }

          // Parse message payload
          const payload = JSON.parse(message);


          // Forward to all connected WebSocket clients for this user
          const userClients = this.clients.get(userId);
          if (userClients && userClients.size > 0) {
            const messageWithTimestamp = {
              ...payload,
              timestamp: new Date().toISOString(),
            };

            userClients.forEach((ws) => {
              if (ws.readyState === WebSocket.OPEN) {
                this.sendMessage(ws, messageWithTimestamp);
              }
            });

            console.log(
              `📤 Forwarded market data to ${userClients.size} client(s) for user ${userId}`,
            );
          } else {
            console.log(`⚠️ No connected clients for user ${userId}, skipping`);
          }
        } catch (error) {
          console.error("❌ Error processing Redis message:", error);
        }
      },
    );
  }

  /**
   * Check if incoming stream data matches any test listeners.
   * Uses the per-user active listeners SET from REDIS_CHANNELS (same contract
   * as RegistrationService.createListener) and atomic Lua script to prevent
   * race conditions with concurrent events.
   */
  private async checkTestListeners(
    userId: string,
    payload: any,
    redis: Redis,
  ): Promise<void> {
    try {
      // Read from the PER-USER active listeners SET (same key RegistrationService writes to)
      const userActiveListenersKey = REDIS_CHANNELS.userActiveListeners(userId);
      const activeTestKeys = await redis.smembers(userActiveListenersKey);
      // const activeTestKeys = (await redisSMembersBreaker.fire(
      //   redis,
      //   userActiveListenersKey,
      // )) as string[];

      if (!activeTestKeys || activeTestKeys.length === 0) return;

      // Extract event data from payload
      const eventData = payload.payload.data;
      const eventSymbol = eventData.BarSeries[0].symbol?.toUpperCase();
      const eventType = eventData.type;

      for (const testKey of activeTestKeys) {
        // Use circuit breaker for GET - returns null on failure (skip this listener)
        const listenerStr = (await redisGetBreaker.fire(redis, testKey)) as
          | string
          | null;

        // Key expired or circuit breaker fallback - clean up stale entry
        if (!listenerStr) {
          await redisSRemBreaker.fire(redis, userActiveListenersKey, testKey);
          continue;
        }

        let listener: any;
        try {
          listener = JSON.parse(listenerStr);
        } catch {
          await redisSRemBreaker.fire(redis, userActiveListenersKey, testKey);
          continue;
        }

        // Only process if this listener belongs to the current user
        if (listener.userId !== userId) continue;

        // Check if still in listening status
        if (listener.status !== "listening") continue;

        // Check symbol and type filters using shared utility
        // RegistrationService stores filterSymbols/filterTypes when available.
        // Fall back to accepting all events for this listener if no filters set
        // (mode=listen captures first matching event regardless of symbol/type).
        const hasFilters = listener.symbols || listener.streamTypes;
        if (
          hasFilters &&
          !matchesEventFilters(eventSymbol, eventType, {
            symbols: listener.symbols,
            streamTypes: listener.streamTypes,
          })
        ) {
          continue; // Doesn't match filters
        }

        // Match found! Use atomic Lua script to prevent race conditions
        const resultKey = `${testKey}:result`;
        const resultData = {
          symbol: eventSymbol,
          type: eventType,
          data: eventData,
          receivedAt: new Date().toISOString(),
          source: listener.source,
        };

        try {
          // Use circuit breaker for EVAL - returns null on failure
          const result = await redisEvalBreaker.fire(
            redis,
            LUA_ATOMIC_LISTENER,
            2, // number of keys
            testKey,
            resultKey,
            userId,
            JSON.stringify(resultData),
            String(TEST_RESULT_TTL_SECONDS),
            String(LISTENER_TTL_SECONDS),
          );

          if (result) {
            // Push result directly to user via WebSocket (replaces polling)
            WebSocketManager.sendToUser(userId, {
              type: "test_data_received",
              payload: {
                workflowId: listener.workflowId,
                nodeId: listener.nodeId,
                testKey,
                data: resultData,
              },
            });

            console.log(
              `🎯 [Test Listen] Data matched and pushed via WebSocket for ${testKey}: ${eventSymbol} (${eventType})`,
            );
          }
          // If result is null, listener was not eligible anymore OR circuit breaker fired
        } catch (luaError) {
          // Fallback - still try to push via WebSocket even if Redis failed
          console.warn(
            `⚠️ Test listener processing failed for ${testKey}:`,
            luaError,
          );

          // Attempt to push the data anyway - better to notify user than lose the event
          WebSocketManager.sendToUser(userId, {
            type: "test_data_received",
            payload: {
              workflowId: listener.workflowId,
              nodeId: listener.nodeId,
              testKey,
              data: resultData,
            },
          });

          console.log(
            `🎯 [Test Listen] Data pushed via WebSocket (fallback) for ${testKey}: ${eventSymbol} (${eventType})`,
          );
        }
      }
    } catch (error) {
      console.error("❌ Error checking test listeners:", error);
      // Don't throw - continue processing other events
    }
  }

  private setupHeartbeat(): void {
    const interval = setInterval(() => {
      if (!this.wss) return;

      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (!ws.isAlive) {
          ws.terminate();
          return;
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, WS_HEARTBEAT_INTERVAL_MS);

    this.wss?.on("close", () => {
      clearInterval(interval);
    });
  }

  // Public static methods for sending messages
  static sendToUser(
    userId: string,
    message: Omit<WebSocketMessage, "timestamp">,
  ): void {
    const instance = WebSocketManager.getInstance();
    const userClients = instance.clients.get(userId);

    console.log(`🔍 Attempting to send to user ${userId}`);
    console.log(`📊 Current clients map:`, Array.from(instance.clients.keys()));
    console.log(
      `👥 User clients found:`,
      userClients ? userClients.size : "undefined",
    );

    if (userClients && userClients.size > 0) {
      const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString(),
      };

      userClients.forEach((ws) => {
        instance.sendMessage(ws, messageWithTimestamp);
      });

      console.log(
        `📤 Sent message to user ${userId} (${userClients.size} clients)`,
      );
    } else {
      console.warn(`⚠️ No clients found for user ${userId}`);
    }
  }

  static sendToSession(
    sessionId: string,
    message: Omit<WebSocketMessage, "timestamp">,
  ): void {
    const instance = WebSocketManager.getInstance();
    const ws = instance.sessions.get(sessionId);

    if (ws) {
      const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString(),
      };

      instance.sendMessage(ws, messageWithTimestamp);
      console.log(`📤 Sent message to session ${sessionId}`);
    }
  }

  static broadcast(message: Omit<WebSocketMessage, "timestamp">): void {
    const instance = WebSocketManager.getInstance();

    if (instance.wss) {
      const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString(),
      };

      instance.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        instance.sendMessage(ws, messageWithTimestamp);
      });

      console.log(
        `📢 Broadcast message to ${instance.wss.clients.size} clients`,
      );
    }
  }

  static getStats(): any {
    const instance = WebSocketManager.getInstance();

    return {
      totalClients: instance.wss?.clients.size || 0,
      connectedUsers: instance.clients.size,
      activeSessions: instance.sessions.size,
      clients: Array.from(instance.clients.entries()).map(
        ([userId, clients]) => ({
          userId,
          connections: clients.size,
        }),
      ),
    };
  }

  async shutdown(): Promise<void> {
    console.log("🔌 Closing WebSocket connections...");

    // Close Redis subscriber
    if (this.redisSub) {
      try {
        await this.redisSub.quit();
        console.log("✅ Redis subscriber closed");
      } catch (error) {
        console.error("❌ Error closing Redis subscriber:", error);
      }
    }

    // Close all client connections
    this.clients.forEach((clientSet, userId) => {
      clientSet.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "Server shutting down");
        }
      });
    });

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss?.close(() => {
          console.log("✅ WebSocket server closed");
          resolve();
        });
      });
    }

    // Clear maps
    this.clients.clear();
    this.sessions.clear();
  }
}

// Export singleton instance
export default WebSocketManager.getInstance();
