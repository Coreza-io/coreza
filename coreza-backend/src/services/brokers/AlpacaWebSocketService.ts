import WebSocket from 'ws';
import WebSocketManager from '../websocketManager';

interface AlpacaStreamMessage {
  stream: string;
  data: any;
}

interface AlpacaSubscription {
  action: 'subscribe' | 'unsubscribe';
  trades?: string[];
  quotes?: string[];
  bars?: string[];
}

export class AlpacaWebSocketService {
  private static instance: AlpacaWebSocketService;
  private ws: WebSocket | null = null;
  private subscriptions = new Map<string, Set<string>>(); // userId -> symbols
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  private constructor() {}

  static getInstance(): AlpacaWebSocketService {
    if (!AlpacaWebSocketService.instance) {
      AlpacaWebSocketService.instance = new AlpacaWebSocketService();
    }
    return AlpacaWebSocketService.instance;
  }

  async connect(credentials: { api_key: string; secret_key: string }) {
    try {
      // Alpaca WebSocket URL for market data
      const wsUrl = 'wss://stream.data.alpaca.markets/v2/sip';
      
      console.log('🔌 Connecting to Alpaca WebSocket...');
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('✅ Connected to Alpaca WebSocket');
        this.reconnectAttempts = 0;
        
        // Authenticate with Alpaca
        const authMessage = {
          action: 'auth',
          key: credentials.api_key,
          secret: credentials.secret_key
        };
        
        this.ws!.send(JSON.stringify(authMessage));
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code: number, reason: string) => {
        console.log(`❌ Alpaca WebSocket disconnected: ${code} - ${reason}`);
        this.ws = null;
        
        // Attempt to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          console.log(`🔄 Reconnecting to Alpaca in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
          
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectAttempts++;
            this.connect(credentials);
          }, delay);
        }
      });

      this.ws.on('error', (error: Error) => {
        console.error('❌ Alpaca WebSocket error:', error);
      });

    } catch (error) {
      console.error('Failed to connect to Alpaca WebSocket:', error);
      throw error;
    }
  }

  private handleMessage(data: WebSocket.Data) {
    try {
      const messages = JSON.parse(data.toString());
      
      // Alpaca sends arrays of messages
      const messageArray = Array.isArray(messages) ? messages : [messages];
      
      for (const message of messageArray) {
        this.processMessage(message);
      }
    } catch (error) {
      console.error('Error parsing Alpaca message:', error);
    }
  }

  private processMessage(message: any) {
    console.log('📨 Alpaca message:', message);

    // Handle different message types
    switch (message.T) {
      case 'success':
        console.log('✅ Alpaca auth successful');
        break;
        
      case 'subscription':
        console.log('📡 Alpaca subscription updated:', message);
        break;
        
      case 't': // Trade
        this.broadcastToSubscribers('alpaca_trade', {
          symbol: message.S,
          price: message.p,
          size: message.s,
          timestamp: message.t,
          conditions: message.c
        });
        break;
        
      case 'q': // Quote
        this.broadcastToSubscribers('alpaca_quote', {
          symbol: message.S,
          bid_price: message.bp,
          bid_size: message.bs,
          ask_price: message.ap,
          ask_size: message.as,
          timestamp: message.t
        });
        break;
        
      case 'b': // Bar (minute bar)
        this.broadcastToSubscribers('alpaca_bar', {
          symbol: message.S,
          open: message.o,
          high: message.h,
          low: message.l,
          close: message.c,
          volume: message.v,
          timestamp: message.t,
          trade_count: message.n,
          vwap: message.vw
        });
        break;
        
      case 'error':
        console.error('❌ Alpaca error:', message);
        this.broadcastToSubscribers('alpaca_error', {
          code: message.code,
          message: message.msg
        });
        break;
        
      default:
        console.log('🔍 Unknown Alpaca message type:', message.T);
    }
  }

  private broadcastToSubscribers(type: string, data: any) {
    // Broadcast to all WebSocket clients subscribed to Alpaca data
    WebSocketManager.broadcast({
      type,
      payload: data
    });
  }

  subscribeToSymbols(userId: string, symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('Alpaca WebSocket not connected');
      return false;
    }

    // Store user subscription
    if (!this.subscriptions.has(userId)) {
      this.subscriptions.set(userId, new Set());
    }
    
    const userSymbols = this.subscriptions.get(userId)!;
    symbols.forEach(symbol => userSymbols.add(symbol.toUpperCase()));

    // Subscribe to trades, quotes, and minute bars
    const subscribeMessage: AlpacaSubscription = {
      action: 'subscribe',
      trades: symbols,
      quotes: symbols,
      bars: symbols
    };

    console.log('📡 Subscribing to Alpaca symbols:', symbols);
    this.ws.send(JSON.stringify(subscribeMessage));
    
    return true;
  }

  unsubscribeFromSymbols(userId: string, symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const userSymbols = this.subscriptions.get(userId);
    if (userSymbols) {
      symbols.forEach(symbol => userSymbols.delete(symbol.toUpperCase()));
    }

    const unsubscribeMessage: AlpacaSubscription = {
      action: 'unsubscribe',
      trades: symbols,
      quotes: symbols,
      bars: symbols
    };

    console.log('🚫 Unsubscribing from Alpaca symbols:', symbols);
    this.ws.send(JSON.stringify(unsubscribeMessage));
    
    return true;
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.ws) {
      this.ws.close(1000, 'Service shutdown');
      this.ws = null;
    }
    
    this.subscriptions.clear();
    console.log('🔌 Alpaca WebSocket service disconnected');
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getSubscriptions(): Map<string, Set<string>> {
    return new Map(this.subscriptions);
  }
}

export default AlpacaWebSocketService.getInstance();