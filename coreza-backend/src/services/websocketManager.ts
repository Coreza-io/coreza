import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import jwt from 'jsonwebtoken';

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

  private constructor() {}

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  initialize(port: number = 8080): void {
    this.wss = new WebSocket.Server({
      port,
      verifyClient: this.verifyClient.bind(this)
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.setupHeartbeat();
    
    console.log(`🔌 WebSocket server started on port ${port}`);
  }

  private async verifyClient(info: { origin: string; secure: boolean; req: IncomingMessage }): Promise<boolean> {
    try {
      const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        console.warn('WebSocket connection rejected: No token provided');
        return false;
      }

      // Verify JWT token (you'll need to implement this based on your auth system)
      const decoded = this.verifyJWT(token);
      if (!decoded.userId) {
        console.warn('WebSocket connection rejected: Invalid token');
        return false;
      }

      // Store user info in request for later use
      (info.req as any).userId = decoded.userId;
      return true;
    } catch (error) {
      console.error('WebSocket verification error:', error);
      return false;
    }
  }

  private verifyJWT(token: string): { userId: string } {
    try {
      // For Supabase JWT, we need to verify using the Supabase endpoint
      // In production, use proper JWT verification with the public key
      // For development, decode and extract user info
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret') as any;
      return { userId: decoded.sub || decoded.user_id || decoded.userId };
    } catch (error) {
      console.error('JWT verification failed:', error);
      throw new Error('Invalid token');
    }
  }

  private handleConnection(ws: AuthenticatedWebSocket, req: IncomingMessage): void {
    const userId = (req as any).userId;
    const sessionId = this.generateSessionId();
    
    ws.userId = userId;
    ws.sessionId = sessionId;
    ws.isAlive = true;

    // Add to user clients
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(ws);
    this.sessions.set(sessionId, ws);

    console.log(`👤 User ${userId} connected (session: ${sessionId})`);

    // Send welcome message
    this.sendMessage(ws, {
      type: 'connected',
      payload: { sessionId, userId },
      timestamp: new Date().toISOString()
    });

    // Set up message handlers
    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(ws, data);
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      this.handleDisconnection(ws);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
      this.handleDisconnection(ws);
    });
  }

  private handleMessage(ws: AuthenticatedWebSocket, data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString()) as WebSocketMessage;
      
      console.log(`📨 Received message from ${ws.userId}:`, message.type);

      switch (message.type) {
        case 'ping':
          this.sendMessage(ws, { type: 'pong', timestamp: new Date().toISOString() });
          break;

        case 'subscribe_workflow':
          this.handleWorkflowSubscription(ws, message.payload);
          break;

        case 'workflow_action':
          this.handleWorkflowAction(ws, message.payload);
          break;

        case 'agent_message':
          this.handleAgentMessage(ws, message.payload);
          break;

        case 'broker_subscribe':
          this.handleBrokerSubscription(ws, message.payload);
          break;

        case 'alpaca_stream':
          this.handleAlpacaStream(ws, message.payload);
          break;

        case 'stream_data':
          // Handle generic stream data broadcast
          this.sendToUser(ws.userId, {
            type: 'stream_data',
            payload: message.payload,
            timestamp: new Date().toISOString()
          });
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
      this.sendMessage(ws, {
        type: 'error',
        payload: { message: 'Invalid message format' },
        timestamp: new Date().toISOString()
      });
    }
  }

  private handleWorkflowSubscription(ws: AuthenticatedWebSocket, payload: any): void {
    // TODO: Implement workflow subscription logic
    console.log(`User ${ws.userId} subscribed to workflow updates`);
    
    this.sendMessage(ws, {
      type: 'workflow_subscribed',
      payload: { success: true },
      timestamp: new Date().toISOString()
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

  private handleBrokerSubscription(ws: AuthenticatedWebSocket, payload: any): void {
    console.log(`User ${ws.userId} subscribed to broker ${payload.broker} events`);
    
    this.sendMessage(ws, {
      type: 'broker_subscribed',
      payload: { broker: payload.broker, success: true },
      timestamp: new Date().toISOString()
    });
  }

  private async handleAlpacaStream(ws: AuthenticatedWebSocket, payload: any): Promise<void> {
    console.log(`User ${ws.userId} requested Alpaca stream:`, payload);
    
    try {
      // Import dynamically to avoid circular dependencies
      const { default: AlpacaWebSocketService } = await import('./brokers/AlpacaWebSocketService');
      
      if (payload.action === 'subscribe' && payload.symbols) {
        const success = AlpacaWebSocketService.subscribeToSymbols(ws.userId!, payload.symbols);
        
        this.sendMessage(ws, {
          type: 'alpaca_stream_started',
          payload: { 
            symbols: payload.symbols, 
            success,
            message: success ? 'Subscribed to symbols' : 'Failed to subscribe - WebSocket not connected'
          }
        });
      } else if (payload.action === 'unsubscribe' && payload.symbols) {
        const success = AlpacaWebSocketService.unsubscribeFromSymbols(ws.userId!, payload.symbols);
        
        this.sendMessage(ws, {
          type: 'alpaca_stream_stopped',
          payload: { 
            symbols: payload.symbols, 
            success,
            message: success ? 'Unsubscribed from symbols' : 'Failed to unsubscribe'
          }
        });
      } else {
        this.sendMessage(ws, {
          type: 'alpaca_stream_error',
          payload: { 
            error: 'Invalid payload. Expected action (subscribe/unsubscribe) and symbols array.'
          }
        });
      }
    } catch (error) {
      console.error('Error handling Alpaca stream:', error);
      this.sendMessage(ws, {
        type: 'alpaca_stream_error',
        payload: { 
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  }

  private handleDisconnection(ws: AuthenticatedWebSocket): void {
    if (ws.userId && ws.sessionId) {
      console.log(`👋 User ${ws.userId} disconnected (session: ${ws.sessionId})`);
      
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

  private sendMessage(ws: AuthenticatedWebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

    this.wss?.on('close', () => {
      clearInterval(interval);
    });
  }

  // Public static methods for sending messages
  static sendToUser(userId: string, message: Omit<WebSocketMessage, 'timestamp'>): void {
    const instance = WebSocketManager.getInstance();
    const userClients = instance.clients.get(userId);
    
    if (userClients) {
      const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString()
      };

      userClients.forEach(ws => {
        instance.sendMessage(ws, messageWithTimestamp);
      });
      
      console.log(`📤 Sent message to user ${userId} (${userClients.size} clients)`);
    }
  }

  static sendToSession(sessionId: string, message: Omit<WebSocketMessage, 'timestamp'>): void {
    const instance = WebSocketManager.getInstance();
    const ws = instance.sessions.get(sessionId);
    
    if (ws) {
      const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString()
      };

      instance.sendMessage(ws, messageWithTimestamp);
      console.log(`📤 Sent message to session ${sessionId}`);
    }
  }

  static broadcast(message: Omit<WebSocketMessage, 'timestamp'>): void {
    const instance = WebSocketManager.getInstance();
    
    if (instance.wss) {
      const messageWithTimestamp = {
        ...message,
        timestamp: new Date().toISOString()
      };

      instance.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        instance.sendMessage(ws, messageWithTimestamp);
      });
      
      console.log(`📢 Broadcast message to ${instance.wss.clients.size} clients`);
    }
  }

  static getStats(): any {
    const instance = WebSocketManager.getInstance();
    
    return {
      totalClients: instance.wss?.clients.size || 0,
      connectedUsers: instance.clients.size,
      activeSessions: instance.sessions.size,
      clients: Array.from(instance.clients.entries()).map(([userId, clients]) => ({
        userId,
        connections: clients.size
      }))
    };
  }

  shutdown(): void {
    console.log('🔌 Shutting down WebSocket server...');
    
    if (this.wss) {
      this.wss.clients.forEach(ws => {
        ws.close(1000, 'Server shutdown');
      });
      
      this.wss.close(() => {
        console.log('✅ WebSocket server closed');
      });
    }
    
    this.clients.clear();
    this.sessions.clear();
  }
}

// Export singleton instance
export default WebSocketManager.getInstance();