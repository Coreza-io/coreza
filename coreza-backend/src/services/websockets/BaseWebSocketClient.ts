import WebSocket from "ws";
import WebSocketManager from "../websocketManager";

/**
 * Configuration options for WebSocket client
 */
export interface WebSocketClientConfig {
  /** WebSocket URL to connect to */
  url: string;
  /** Maximum number of reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Initial reconnection delay in ms (default: 1000) */
  initialReconnectDelay?: number;
  /** Maximum reconnection delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Heartbeat interval in ms (default: 15000) */
  heartbeatInterval?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

/**
 * Subscription management for user-based WebSocket subscriptions
 */
export interface SubscriptionManager<T = string> {
  /** Map of userId to their subscribed items */
  userSubscriptions: Map<string, Set<T>>;
  /** Map of item to userIds subscribed to it */
  itemToUsers: Map<T, Set<string>>;
  /** Queue for items requested before authentication */
  queuedItems: Set<T>;
}

/**
 * Base WebSocket client for external API connections
 * 
 * This abstract class provides common functionality for connecting to external WebSocket APIs:
 * - Connection lifecycle management (connect, disconnect, reconnect)
 * - Exponential backoff reconnection strategy
 * - User-based subscription management
 * - Heartbeat/keepalive mechanism
 * - Message routing and broadcasting
 * - Integration with WebSocketManager for client notifications
 * 
 * @example
 * ```typescript
 * class MyBrokerClient extends BaseWebSocketClient<string> {
 *   protected authenticate(): void {
 *     this.send({ action: 'auth', key: this.credentials.api_key });
 *   }
 * 
 *   protected handleAuthSuccess(): void {
 *     console.log('Authenticated with MyBroker');
 *   }
 * 
 *   protected parseMessage(data: any): void {
 *     if (data.type === 'trade') {
 *       this.broadcastToSubscribers('broker_trade', data);
 *     }
 *   }
 * }
 * ```
 */
export abstract class BaseWebSocketClient<TSubscriptionItem = string> {
  protected ws: WebSocket | null = null;
  protected authenticated = false;
  protected config: Required<WebSocketClientConfig>;
  protected credentials: any;

  // Subscription management
  protected subscriptions: SubscriptionManager<TSubscriptionItem> = {
    userSubscriptions: new Map(),
    itemToUsers: new Map(),
    queuedItems: new Set(),
  };

  // Reconnection management
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;

  // Heartbeat management
  private heartbeatTimer: NodeJS.Timeout | null = null;

  // Authentication ready promise
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;

  /**
   * Create a new WebSocket client instance
   * @param config - Configuration options for the WebSocket connection
   */
  constructor(config: WebSocketClientConfig) {
    this.config = {
      maxReconnectAttempts: 5,
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 15000,
      debug: false,
      ...config,
    };
  }

  /**
   * Get the service name for logging purposes
   * @returns The name of the service (e.g., "Alpaca", "Dhan")
   */
  protected abstract getServiceName(): string;

  /**
   * Authenticate with the WebSocket server
   * This method should send authentication message(s) to the server
   */
  protected abstract authenticate(): void;

  /**
   * Handle successful authentication
   * Called when the server confirms authentication
   */
  protected abstract handleAuthSuccess(): void;

  /**
   * Parse and route incoming messages
   * @param data - Raw message data from the WebSocket
   */
  protected abstract parseMessage(data: any): void;

  /**
   * Build subscription message for specific items
   * @param items - Items to subscribe to
   * @returns Message object to send to the WebSocket server
   */
  protected abstract buildSubscribeMessage(items: TSubscriptionItem[]): any;

  /**
   * Build unsubscription message for specific items
   * @param items - Items to unsubscribe from
   * @returns Message object to send to the WebSocket server
   */
  protected abstract buildUnsubscribeMessage(items: TSubscriptionItem[]): any;

  /**
   * Normalize subscription items (e.g., uppercase symbols)
   * @param items - Raw subscription items
   * @returns Normalized items
   */
  protected normalizeItems(items: TSubscriptionItem[]): TSubscriptionItem[] {
    // Default implementation - override if needed
    return items;
  }

  /**
   * Connect to the WebSocket server
   * @param credentials - Authentication credentials
   */
  async connect(credentials: any): Promise<void> {
    try {
      this.credentials = credentials;
      this.log(`Connecting to ${this.getServiceName()} WebSocket...`);

      this.ws = new WebSocket(this.config.url);

      // Reset authentication state
      this.authenticated = false;
      this.readyPromise = new Promise<void>((resolve) => {
        this.resolveReady = resolve;
      });

      this.setupEventHandlers();
    } catch (error) {
      console.error(`Failed to connect to ${this.getServiceName()} WebSocket:`, error);
      throw error;
    }
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on("open", () => this.handleOpen());
    this.ws.on("message", (data: WebSocket.Data) => this.handleMessage(data));
    this.ws.on("close", (code: number, reason: Buffer) => this.handleClose(code, reason));
    this.ws.on("error", (error: Error) => this.handleError(error));
  }

  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    this.log("WebSocket connection established");
    this.reconnectAttempts = 0;

    // Authenticate
    this.authenticate();

    // Start heartbeat
    this.startHeartbeat();
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const parsed = JSON.parse(data.toString());
      this.parseMessage(parsed);
    } catch (error) {
      console.error(`${this.getServiceName()} message parsing error:`, error);
    }
  }

  /**
   * Handle WebSocket close event
   */
  private handleClose(code: number, reason: Buffer): void {
    this.log(`WebSocket disconnected: ${code} - ${reason?.toString?.() || ""}`);
    
    this.ws = null;
    this.authenticated = false;
    this.stopHeartbeat();
    this.readyPromise = null;
    this.resolveReady = null;

    // Attempt reconnection
    this.attemptReconnect();
  }

  /**
   * Handle WebSocket error event
   */
  private handleError(error: Error): void {
    console.error(`${this.getServiceName()} WebSocket error:`, error);
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(`⛔ ${this.getServiceName()}: Max reconnect attempts reached`);
      return;
    }

    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(this.credentials);
    }, delay);
  }

  /**
   * Mark authentication as successful and trigger ready callbacks
   */
  protected markAuthenticated(): void {
    this.authenticated = true;
    this.resolveReady?.();
    this.resolveReady = null;
    this.log("Authentication successful");
    this.handleAuthSuccess();
    this.resubscribeAll();
  }

  /**
   * Start heartbeat/keepalive mechanism
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      try {
        this.ws?.ping();
      } catch (error) {
        this.log("Heartbeat ping failed", error);
      }
    }, this.config.heartbeatInterval);

    this.ws?.on("pong", () => {
      // Optional: track latency
    });
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Subscribe a user to specific items
   * @param userId - User ID
   * @param items - Items to subscribe to
   * @returns Success status
   */
  async subscribe(userId: string, items: TSubscriptionItem[]): Promise<boolean> {
    const normalized = this.normalizeItems(items);
    if (normalized.length === 0) return false;

    // Update user -> items mapping
    if (!this.subscriptions.userSubscriptions.has(userId)) {
      this.subscriptions.userSubscriptions.set(userId, new Set());
    }
    const userSet = this.subscriptions.userSubscriptions.get(userId)!;
    normalized.forEach((item) => userSet.add(item));

    // Update item -> users mapping
    for (const item of normalized) {
      if (!this.subscriptions.itemToUsers.has(item)) {
        this.subscriptions.itemToUsers.set(item, new Set());
      }
      this.subscriptions.itemToUsers.get(item)!.add(userId);
    }

    // Queue if not ready
    if (!this.isReady()) {
      normalized.forEach((item) => this.subscriptions.queuedItems.add(item));
      this.log(`Not ready; queued items:`, normalized);
      return true;
    }

    // Send subscription message
    const message = this.buildSubscribeMessage(normalized);
    this.send(message);
    this.log(`Subscribed to:`, normalized);
    return true;
  }

  /**
   * Unsubscribe a user from specific items
   * @param userId - User ID
   * @param items - Items to unsubscribe from
   * @returns Success status
   */
  unsubscribe(userId: string, items: TSubscriptionItem[]): boolean {
    const normalized = this.normalizeItems(items);
    if (normalized.length === 0) return false;

    // Remove from user -> items mapping
    const userSet = this.subscriptions.userSubscriptions.get(userId);
    if (userSet) {
      normalized.forEach((item) => userSet.delete(item));
    }

    // Update item -> users mapping and collect unused items
    const toUnsubscribe: TSubscriptionItem[] = [];
    for (const item of normalized) {
      const users = this.subscriptions.itemToUsers.get(item);
      if (users) {
        users.delete(userId);
        if (users.size === 0) {
          this.subscriptions.itemToUsers.delete(item);
          toUnsubscribe.push(item);
        }
      }
      this.subscriptions.queuedItems.delete(item);
    }

    // Send unsubscription message if ready
    if (!this.isReady() || toUnsubscribe.length === 0) {
      return true;
    }

    const message = this.buildUnsubscribeMessage(toUnsubscribe);
    this.send(message);
    this.log(`Unsubscribed from:`, toUnsubscribe);
    return true;
  }

  /**
   * Resubscribe to all items after reconnection/authentication
   */
  private resubscribeAll(): void {
    // Union of current subscriptions + queued items
    const allItems = new Set<TSubscriptionItem>(this.subscriptions.queuedItems);
    for (const set of this.subscriptions.userSubscriptions.values()) {
      for (const item of set) {
        allItems.add(item);
      }
    }
    this.subscriptions.queuedItems.clear();

    const items = Array.from(allItems);
    if (!this.isReady() || items.length === 0) {
      return;
    }

    const message = this.buildSubscribeMessage(items);
    this.send(message);
    this.log(`Resubscribed to all:`, items);
  }

  /**
   * Broadcast data to all users subscribed to a specific item
   * @param type - Message type
   * @param data - Message data
   * @param itemKey - Key in data object that contains the item identifier (e.g., 'symbol')
   */
  protected broadcastToSubscribers(type: string, data: any, itemKey: string = 'symbol'): void {
    const item = data?.[itemKey];
    if (!item) return;

    const users = this.subscriptions.itemToUsers.get(item);
    if (!users || users.size === 0) return;

    const payload = { type, payload: data };

    // Broadcast to specific users
    this.broadcastToUsers(Array.from(users), payload);
  }

  /**
   * Broadcast message to specific users via WebSocketManager
   * @param userIds - Array of user IDs
   * @param message - Message to send
   */
  protected broadcastToUsers(userIds: string[], message: any): void {
    const mgr: any = WebSocketManager as any;
    if (typeof mgr.broadcastToUsers === "function") {
      mgr.broadcastToUsers(userIds, message);
    } else {
      // Fallback: send to each user individually
      userIds.forEach((userId) => {
        WebSocketManager.sendToUser(userId, message);
      });
    }
  }

  /**
   * Send a message to the WebSocket server
   * @param message - Message object to send
   */
  protected send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.log("Cannot send message: WebSocket not open");
    }
  }

  /**
   * Check if the WebSocket is ready (connected and authenticated)
   */
  isReady(): boolean {
    return (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      this.authenticated
    );
  }

  /**
   * Check if the WebSocket is connected (may not be authenticated yet)
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get current subscriptions (returns a copy)
   */
  getSubscriptions(): Map<string, Set<TSubscriptionItem>> {
    const copy = new Map<string, Set<TSubscriptionItem>>();
    for (const [userId, set] of this.subscriptions.userSubscriptions) {
      copy.set(userId, new Set(set));
    }
    return copy;
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.authenticated = false;
    this.readyPromise = null;
    this.resolveReady = null;

    this.subscriptions.userSubscriptions.clear();
    this.subscriptions.itemToUsers.clear();
    this.subscriptions.queuedItems.clear();

    this.log(`${this.getServiceName()} WebSocket client disconnected`);
  }

  /**
   * Log a message (respects debug config)
   */
  protected log(message: string, ...args: any[]): void {
    if (this.config.debug) {
      console.log(`[${this.getServiceName()}] ${message}`, ...args);
    } else {
      // Always log with emoji prefix for important messages
      if (message.includes("Connecting") || message.includes("disconnected") || message.includes("Authentication")) {
        console.log(`[${this.getServiceName()}] ${message}`, ...args);
      }
    }
  }
}
