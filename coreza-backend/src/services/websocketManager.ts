import WebSocket from "ws";
import { IncomingMessage } from "http";
import { URL } from "url";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";
import { Server } from "net";
import { SubscriptionManager } from "./SubscriptionManager";

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
  private subscriptionManager = SubscriptionManager.getInstance();
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  private constructor() {
    // Initialize JWKS for JWT verification
    const supabaseUrl = process.env.SUPABASE_URL;
    if (supabaseUrl) {
      this.jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/jwks`));
    }
  }

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  async initialize(port: number = 8081): Promise<void> {
    // Check if port is available
    const isPortAvailable = await this.checkPort(port);
    
    if (!isPortAvailable) {
      console.error(`❌ Port ${port} is already in use`);
      console.log(`💡 Solutions:`);
      console.log(`   1. Kill existing process: netstat -ano | findstr :${port}`);
      console.log(`   2. Change WEBSOCKET_PORT in .env`);
      console.log(`   3. Run: taskkill /PID <PID> /F`);
      throw new Error(`Port ${port} is already in use`);
    }

    this.wss = new WebSocket.Server({
      port,
      verifyClient: this.verifyClient.bind(this),
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
      
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        }
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port);
    });
  }

  private handleServerError(error: Error): void {
    console.error('WebSocket server error:', error);
    if (error.message.includes('EADDRINUSE')) {
      console.log('💡 Try: taskkill /PID <PID> /F or change WEBSOCKET_PORT');
    }
  }

  private async verifyClient(info: {
    origin: string;
    secure: boolean;
    req: IncomingMessage;
  }): Promise<boolean> {
    try {
      const url = new URL(
        info.req.url || "",
        `http://${info.req.headers.host}`
      );
      const token = url.searchParams.get("token");

      if (!token) {
        console.warn("WebSocket connection rejected: No token provided");
        return false;
      }

      // Verify JWT token with proper signature validation
      const decoded = await this.verifyJWT(token);
      if (!decoded.userId) {
        console.warn("WebSocket connection rejected: Invalid token");
        return false;
      }

      // Store user info in request for later use
      (info.req as any).userId = decoded.userId;
      return true;
    } catch (error) {
      console.error("WebSocket verification error:", error);
      return false;
    }
  }

  /**
   * Verify JWT token with proper signature validation using Supabase JWKS
   * Production-ready implementation with security checks
   */
  private async verifyJWT(token: string): Promise<{ userId: string }> {
    try {
      if (!this.jwks) {
        throw new Error("JWKS not initialized - SUPABASE_URL required");
      }

      // Verify JWT signature against Supabase JWKS endpoint
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/auth/v1` : undefined,
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
      console.error("❌ JWT verification failed:", error instanceof Error ? error.message : error);
      throw new Error("Invalid or expired token");
    }
  }

  private handleConnection(
    ws: AuthenticatedWebSocket,
    req: IncomingMessage
  ): void {
    const userId = (req as any).userId;
    const sessionId = this.generateSessionId();

    console.log(
      `🔌 New WebSocket connection - userId: ${userId}, sessionId: ${sessionId}`
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
      `📊 Total clients for user ${userId}: ${this.clients.get(userId)?.size}`
    );
    console.log(`📊 Total connected users: ${this.clients.size}`);

    // Send welcome message
    this.sendMessage(ws, {
      type: "connected",
      payload: { sessionId, userId },
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
    data: WebSocket.Data
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
    payload: any
  ): void {
    // TODO: Implement workflow subscription logic
    console.log(`User ${ws.userId} subscribed to workflow updates`);

    this.sendMessage(ws, {
      type: "workflow_subscribed",
      payload: { success: true },
      timestamp: new Date().toISOString(),
    });
  }

  private handleWorkflowAction(ws: AuthenticatedWebSocket, payload: any): void {
    // TODO: Implement workflow action handling (start, stop, pause)
    console.log(`User ${ws.userId} performed workflow action:`, payload);
  }

  private handleAgentMessage(ws: AuthenticatedWebSocket, payload: any): void {
    // TODO: Queue agent processing
    console.log(`User ${ws.userId} sent agent message:`, payload);
  }

  private handleBrokerSubscription(
    ws: AuthenticatedWebSocket,
    payload: any
  ): void {
    console.log(
      `User ${ws.userId} subscribed to broker ${payload.broker} events`
    );

    this.sendMessage(ws, {
      type: "broker_subscribed",
      payload: { broker: payload.broker, success: true },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Handle WebSocket stream subscriptions/unsubscriptions
   * CONSOLIDATED: All market data now goes through Redis Pub/Sub via SubscriptionManager
   */
  private async handleWebSocketStream(
    ws: AuthenticatedWebSocket,
    payload: any
  ): Promise<void> {
    const { source, action, symbols, node_id, nodeId } = payload || {};
    const targetNodeId = node_id || nodeId;

    // Validate payload
    if (!action || !symbols || !Array.isArray(symbols) || symbols.length === 0) {
      this.sendMessage(ws, {
        type: "error",
        payload: {
          error: "Invalid payload. Expected action (subscribe/unsubscribe) and symbols array.",
        },
      });
      return;
    }

    try {
      if (action === "subscribe") {
        // Subscribe via SubscriptionManager (Redis Pub/Sub)
        await this.subscriptionManager.subscribeClient(ws.sessionId!, symbols);
        
        this.sendMessage(ws, {
          type: source ? `${source}_started` : "market_subscribed",
          payload: {
            symbols,
            node_id: targetNodeId,
            success: true,
          },
        });
        
        console.log(`✅ [WebSocketManager] Subscribed session ${ws.sessionId} to symbols:`, symbols);
      } 
      else if (action === "unsubscribe") {
        // Unsubscribe via SubscriptionManager
        await this.subscriptionManager.unsubscribeClient(ws.sessionId!, symbols);
        
        this.sendMessage(ws, {
          type: source ? `${source}_stopped` : "market_unsubscribed",
          payload: {
            symbols,
            node_id: targetNodeId ?? null,
            success: true,
          },
        });
        
        console.log(`✅ [WebSocketManager] Unsubscribed session ${ws.sessionId} from symbols:`, symbols);
      }
      else {
        this.sendMessage(ws, {
          type: "error",
          payload: {
            error: `Unknown action: ${action}. Expected 'subscribe' or 'unsubscribe'.`,
          },
        });
      }
    } catch (error) {
      console.error(`❌ [WebSocketManager] Stream operation failed:`, error);
      this.sendMessage(ws, {
        type: "error",
        payload: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }

  private handleDisconnection(ws: AuthenticatedWebSocket): void {
    if (ws.userId && ws.sessionId) {
      console.log(
        `👋 User ${ws.userId} disconnected (session: ${ws.sessionId})`
      );

      // Remove from subscription manager
      this.subscriptionManager.removeClient(ws.sessionId);

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
    message: WebSocketMessage
  ): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupRedisSubscription(): void {
    this.subscriptionManager.onMessage((symbol, data) => {
      const clients = this.subscriptionManager.getClientsForSymbol(symbol);
      const wildcardClients = this.subscriptionManager.getClientsForSymbol('*');
      const allClients = new Set([...clients, ...wildcardClients]);
      
      const event = JSON.parse(data);
      
      allClients.forEach(clientId => {
        const ws = this.sessions.get(clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          this.sendMessage(ws, {
            type: 'market_data',
            payload: event,
          });
        }
      });
    });
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
    }, 30000); // 30 seconds

    this.wss?.on("close", () => {
      clearInterval(interval);
    });
  }

  // Public static methods for sending messages
  static sendToUser(
    userId: string,
    message: Omit<WebSocketMessage, "timestamp">
  ): void {
    const instance = WebSocketManager.getInstance();
    const userClients = instance.clients.get(userId);

    console.log(`🔍 Attempting to send to user ${userId}`);
    console.log(`📊 Current clients map:`, Array.from(instance.clients.keys()));
    console.log(
      `👥 User clients found:`,
      userClients ? userClients.size : "undefined"
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
        `📤 Sent message to user ${userId} (${userClients.size} clients)`
      );
    } else {
      console.warn(`⚠️ No clients found for user ${userId}`);
    }
  }

  static sendToSession(
    sessionId: string,
    message: Omit<WebSocketMessage, "timestamp">
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
        `📢 Broadcast message to ${instance.wss.clients.size} clients`
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
        })
      ),
      subscriptions: instance.subscriptionManager.getStats(),
    };
  }

  async shutdown(): Promise<void> {
    console.log("🔌 Closing WebSocket connections...");
    
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
