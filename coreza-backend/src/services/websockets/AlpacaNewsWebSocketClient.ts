import WebSocket from 'ws';
import WebSocketManager from '../websocketManager';

/**
 * Alpaca News WebSocket Message Types
 */
interface AlpacaNewsMessage {
  T: string; // Message type
  msg?: string; // Message content for success/error
  code?: number; // Error code
  id?: number; // News ID
  headline?: string;
  summary?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
  content?: string;
  symbols?: string[];
  source?: string;
  [key: string]: any;
}

/**
 * Alpaca News Subscription Message
 */
interface AlpacaSubscription {
  action: 'subscribe' | 'unsubscribe';
  news: string[];
}

/**
 * User subscription tracking
 */
interface UserSubscription {
  userId: string;
  symbols: Set<string>;
}

/**
 * Alpaca News WebSocket Client
 * Connects to Alpaca's News API and streams news in real-time
 * 
 * @example
 * ```typescript
 * const client = AlpacaNewsWebSocketClient.getInstance();
 * await client.connect({ api_key: 'xxx', secret_key: 'yyy' });
 * await client.subscribe('user123', ['AAPL', 'MSFT']);
 * ```
 */
export class AlpacaNewsWebSocketClient {
  private static instance: AlpacaNewsWebSocketClient;
  private ws: WebSocket | null = null;
  private credentials: { api_key: string; secret_key: string } | null = null;
  private isAuthenticated: boolean = false;
  private isConnecting: boolean = false;
  
  // Subscription management
  private userSubscriptions: Map<string, Set<string>> = new Map(); // userId -> symbols
  private symbolSubscribers: Map<string, Set<string>> = new Map(); // symbol -> userIds
  private pendingSubscriptions: Array<{ userId: string; symbols: string[] }> = [];
  
  // Reconnection
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private readonly URL = 'wss://stream.data.alpaca.markets/v1beta1/news';
  private readonly debug = true;

  private constructor() {}

  static getInstance(): AlpacaNewsWebSocketClient {
    if (!AlpacaNewsWebSocketClient.instance) {
      AlpacaNewsWebSocketClient.instance = new AlpacaNewsWebSocketClient();
    }
    return AlpacaNewsWebSocketClient.instance;
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[AlpacaNews]', ...args);
    }
  }

  /**
   * Connect to Alpaca News WebSocket
   */
  async connect(credentials: { api_key: string; secret_key: string }): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.log('Already connected');
      return;
    }

    if (this.isConnecting) {
      this.log('Connection already in progress');
      return;
    }

    this.credentials = credentials;
    this.isConnecting = true;
    this.isAuthenticated = false;

    return new Promise((resolve, reject) => {
      try {
        this.log('🔌 Connecting to Alpaca News...');
        
        // Authenticate via headers
        this.ws = new WebSocket(this.URL, {
          headers: {
            'APCA-API-KEY-ID': credentials.api_key,
            'APCA-API-SECRET-KEY': credentials.secret_key,
          },
        });

        this.ws.on('open', () => {
          this.log('🔌 Connected to Alpaca News stream');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
        });

        this.ws.on('message', (data: Buffer) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.log('🔒 Connection closed', code, reason.toString());
          this.isAuthenticated = false;
          this.isConnecting = false;
          this.handleReconnect();
        });

        this.ws.on('error', (error: Error) => {
          console.error('❌ Alpaca News WebSocket error:', error);
          this.isConnecting = false;
          reject(error);
        });

        // Resolve after successful authentication
        const authCheckInterval = setInterval(() => {
          if (this.isAuthenticated) {
            clearInterval(authCheckInterval);
            resolve();
          }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!this.isAuthenticated) {
            clearInterval(authCheckInterval);
            reject(new Error('Authentication timeout'));
          }
        }, 10000);

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  /**
   * Handle incoming messages from Alpaca
   */
  private handleMessage(buffer: Buffer): void {
    let messages: AlpacaNewsMessage[];
    
    try {
      messages = JSON.parse(buffer.toString());
      if (!Array.isArray(messages)) {
        messages = [messages];
      }
    } catch (error) {
      console.error('❌ Failed to parse message:', buffer.toString());
      return;
    }

    for (const msg of messages) {
      this.processMessage(msg);
    }
  }

  /**
   * Process individual message
   */
  private processMessage(msg: AlpacaNewsMessage): void {
    switch (msg.T) {
      case 'success':
        if (msg.msg === 'connected') {
          this.log('🤝 Handshake OK');
        } else if (msg.msg === 'authenticated') {
          this.log('✅ Authenticated');
          this.isAuthenticated = true;
          this.resubscribeAll();
        }
        break;

      case 'subscription':
        this.log('🔗 Subscription confirmed:', msg);
        break;

      case 'n': // News
        this.handleNews(msg);
        break;

      case 'error':
        console.error('⛔ Alpaca error:', msg.code, msg.msg);
        break;

      default:
        this.log('📩 Unknown message type:', msg);
    }
  }

  /**
   * Handle news message and broadcast to subscribers
   */
  private handleNews(msg: AlpacaNewsMessage): void {
    const symbols = msg.symbols || [];
    const tickers = symbols.join(',');
    
    this.log(
      `📰 [${msg.source}] ${msg.created_at} ${tickers} — ${msg.headline}`
    );

    const newsData = {
      id: msg.id,
      headline: msg.headline,
      summary: msg.summary,
      author: msg.author,
      created_at: msg.created_at,
      updated_at: msg.updated_at,
      url: msg.url,
      content: msg.content,
      symbols: msg.symbols,
      source: msg.source,
    };

    // Broadcast to all subscribers of these symbols or wildcard
    const notifiedUsers = new Set<string>();

    // Check wildcard subscribers
    const wildcardSubs = this.symbolSubscribers.get('*') || new Set();
    wildcardSubs.forEach(userId => notifiedUsers.add(userId));

    // Check symbol-specific subscribers
    symbols.forEach((symbol: string) => {
      const subs = this.symbolSubscribers.get(symbol.toUpperCase()) || new Set();
      subs.forEach(userId => notifiedUsers.add(userId));
    });

    // Send to all subscribed users
    notifiedUsers.forEach(userId => {
      WebSocketManager.sendToUser(userId, {
        type: 'alpaca_news',
        payload: newsData,
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Subscribe user to news for specific symbols
   */
  async subscribe(userId: string, symbols: string[]): Promise<void> {
    if (!this.credentials) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Normalize symbols
    const normalizedSymbols = symbols.map(s => s.toUpperCase()).filter(Boolean);
    
    if (!normalizedSymbols.length) {
      throw new Error('No symbols provided');
    }

    // If not authenticated, queue the subscription
    if (!this.isAuthenticated) {
      this.log(`⏳ Queueing subscription for user ${userId}`);
      this.pendingSubscriptions.push({ userId, symbols: normalizedSymbols });
      
      // Try to connect if not already connecting
      if (!this.isConnecting && !this.ws) {
        await this.connect(this.credentials);
      }
      return;
    }

    // Update user subscriptions
    if (!this.userSubscriptions.has(userId)) {
      this.userSubscriptions.set(userId, new Set());
    }
    const userSymbols = this.userSubscriptions.get(userId)!;
    
    // Track new symbols to subscribe
    const newSymbols: string[] = [];
    
    normalizedSymbols.forEach(symbol => {
      userSymbols.add(symbol);
      
      // Update reverse mapping
      if (!this.symbolSubscribers.has(symbol)) {
        this.symbolSubscribers.set(symbol, new Set());
        newSymbols.push(symbol);
      }
      this.symbolSubscribers.get(symbol)!.add(userId);
    });

    // Send subscription to Alpaca if there are new symbols
    if (newSymbols.length > 0) {
      this.sendSubscription('subscribe', newSymbols);
    }

    this.log(`✅ User ${userId} subscribed to: ${normalizedSymbols.join(', ')}`);
  }

  /**
   * Unsubscribe user from specific symbols
   */
  async unsubscribe(userId: string, symbols: string[]): Promise<void> {
    const normalizedSymbols = symbols.map(s => s.toUpperCase()).filter(Boolean);
    
    if (!normalizedSymbols.length) {
      return;
    }

    const userSymbols = this.userSubscriptions.get(userId);
    if (!userSymbols) {
      return;
    }

    const symbolsToUnsubscribe: string[] = [];

    normalizedSymbols.forEach(symbol => {
      userSymbols.delete(symbol);
      
      const subscribers = this.symbolSubscribers.get(symbol);
      if (subscribers) {
        subscribers.delete(userId);
        
        // If no more subscribers for this symbol, unsubscribe from Alpaca
        if (subscribers.size === 0) {
          this.symbolSubscribers.delete(symbol);
          symbolsToUnsubscribe.push(symbol);
        }
      }
    });

    // Clean up if user has no more subscriptions
    if (userSymbols.size === 0) {
      this.userSubscriptions.delete(userId);
    }

    // Send unsubscription to Alpaca
    if (symbolsToUnsubscribe.length > 0 && this.isAuthenticated) {
      this.sendSubscription('unsubscribe', symbolsToUnsubscribe);
    }

    this.log(`✅ User ${userId} unsubscribed from: ${normalizedSymbols.join(', ')}`);
  }

  /**
   * Send subscription message to Alpaca
   */
  private sendSubscription(action: 'subscribe' | 'unsubscribe', symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('⚠️  Cannot send subscription: not connected');
      return;
    }

    const message: AlpacaSubscription = {
      action,
      news: symbols,
    };

    this.ws.send(JSON.stringify(message));
    this.log(`📤 Sent ${action} for: ${symbols.join(', ')}`);
  }

  /**
   * Resubscribe all symbols after reconnection
   */
  private resubscribeAll(): void {
    // Process pending subscriptions
    const pending = [...this.pendingSubscriptions];
    this.pendingSubscriptions = [];
    
    pending.forEach(({ userId, symbols }) => {
      this.subscribe(userId, symbols).catch(err => {
        console.error('Failed to process pending subscription:', err);
      });
    });

    // Resubscribe existing symbols
    const allSymbols = Array.from(this.symbolSubscribers.keys());
    if (allSymbols.length > 0) {
      this.log('🔄 Resubscribing to all symbols...');
      this.sendSubscription('subscribe', allSymbols);
    }
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.log(`🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      if (this.credentials) {
        this.connect(this.credentials).catch(err => {
          console.error('Reconnection failed:', err);
        });
      }
    }, delay);
  }

  /**
   * Check if connected and authenticated
   */
  isReady(): boolean {
    return this.ws !== null && 
           this.ws.readyState === WebSocket.OPEN && 
           this.isAuthenticated;
  }

  /**
   * Get current subscriptions for a user
   */
  getUserSubscriptions(userId: string): string[] {
    return Array.from(this.userSubscriptions.get(userId) || []);
  }

  /**
   * Get all active symbols
   */
  getAllSymbols(): string[] {
    return Array.from(this.symbolSubscribers.keys());
  }

  /**
   * Get statistics
   */
  getStats(): any {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      authenticated: this.isAuthenticated,
      totalUsers: this.userSubscriptions.size,
      totalSymbols: this.symbolSubscribers.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isAuthenticated = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.log('🔌 Disconnected');
  }
}

// Export singleton instance
export default AlpacaNewsWebSocketClient.getInstance();
