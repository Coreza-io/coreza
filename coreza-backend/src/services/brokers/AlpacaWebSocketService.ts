import WebSocket from "ws";
import WebSocketManager from "../websocketManager";

interface AlpacaStreamMessage {
  stream: string;
  data: any;
}

interface AlpacaSubscription {
  action: "subscribe" | "unsubscribe";
  trades?: string[];
  quotes?: string[];
  bars?: string[];
}

export class AlpacaWebSocketService {
  private static instance: AlpacaWebSocketService;

  private ws: WebSocket | null = null;
  private authed = false;

  // userId -> symbols (what each user wants)
  private subscriptions = new Map<string, Set<string>>();

  // symbol -> userIds (who should receive a given symbol)
  private symbolToUsers = new Map<string, Set<string>>();

  // queue for subscriptions requested before we're authenticated
  private queuedSymbols = new Set<string>();

  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  // resolve when authenticated
  private readyPromise: Promise<void> | null = null;
  private resolveReady: (() => void) | null = null;

  // keepalive
  private pingTimer: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): AlpacaWebSocketService {
    if (!AlpacaWebSocketService.instance) {
      AlpacaWebSocketService.instance = new AlpacaWebSocketService();
    }
    return AlpacaWebSocketService.instance;
  }

  async connect(credentials: { api_key: string; secret_key: string }) {
    try {
      //const wsUrl = "wss://stream.data.sandbox.alpaca.markets/v2/iex";
      const wsUrl = "wss://stream.data.alpaca.markets/v2/iex";
      //const wsUrl = "wss://paper-api.alpaca.markets/stream";
      console.log("🔌 Connecting to Alpaca WebSocket...");
      this.ws = new WebSocket(wsUrl);

      // reset readiness tracking
      this.authed = false;
      this.readyPromise = new Promise<void>((res) => (this.resolveReady = res));

      this.ws.on("open", () => {
        console.log("✅ WS TCP open");
        this.reconnectAttempts = 0;

        // Authenticate promptly
        const authMessage = {
          action: "auth",
          key: credentials.api_key,
          secret: credentials.secret_key,
        };
        this.ws!.send(JSON.stringify(authMessage));

        // Start keepalive
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          try {
            this.ws?.ping();
          } catch {}
        }, 15000);
        this.ws!.on("pong", () => {
          /* optional: track latency */
        });
      });

      this.ws.on("message", (data: WebSocket.Data) => this.handleMessage(data));

      this.ws.on("close", (code: number, reason: Buffer) => {
        console.log(
          `❌ Alpaca WS disconnected: ${code} - ${reason?.toString?.() || ""}`
        );
        this.ws = null;
        this.authed = false;

        if (this.pingTimer) {
          clearInterval(this.pingTimer);
          this.pingTimer = null;
        }
        this.readyPromise = null;
        this.resolveReady = null;

        // Attempt to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            30000
          );
          console.log(
            `🔄 Reconnecting in ${delay}ms (attempt ${
              this.reconnectAttempts + 1
            })`
          );
          this.reconnectTimeout = setTimeout(() => {
            this.reconnectAttempts++;
            this.connect(credentials);
          }, delay);
        } else {
          console.error("⛔ Max reconnect attempts reached.");
        }
      });

      this.ws.on("error", (error: Error) => {
        console.error("❌ Alpaca WebSocket error:", error);
        // close will follow and handle reconnect logic
      });
    } catch (error) {
      console.error("Failed to connect to Alpaca WebSocket:", error);
      throw error;
    }
  }

  private handleMessage(data: WebSocket.Data) {
    try {
      const messages = JSON.parse(data.toString());
      const arr = Array.isArray(messages) ? messages : [messages];
      for (const msg of arr) this.processMessage(msg);
    } catch (error) {
      console.error("Error parsing Alpaca message:", error);
    }
  }

  private processMessage(message: any) {
    switch (message.T) {
      case "success": {
        // Alpaca usually sends: connected -> authenticated
        if (message.msg === "connected") {
          console.log("🟢 Server says: connected");
        } else if (message.msg === "authenticated") {
          console.log("🔐 Authenticated");
          this.authed = true;
          this.resolveReady?.();
          this.resolveReady = null;
          this.resubscribeAll();
        }
        return;
      }

      case "subscription":
        console.log("📡 Alpaca subscription echo:", message);
        return;

      case "t": // Trade
        this.broadcastToSubscribers("alpaca_trade", {
          symbol: message.S,
          price: message.p,
          size: message.s,
          timestamp: message.t,
          conditions: message.c,
        });
        return;

      case "q": // Quote
        this.broadcastToSubscribers("alpaca_quote", {
          symbol: message.S,
          bid_price: message.bp,
          bid_size: message.bs,
          ask_price: message.ap,
          ask_size: message.as,
          timestamp: message.t,
        });
        return;

      case "b": // Bar
        this.broadcastToSubscribers("alpaca_bar", {
          symbol: message.S,
          open: message.o,
          high: message.h,
          low: message.l,
          close: message.c,
          volume: message.v,
          timestamp: message.t,
          trade_count: message.n,
          vwap: message.vw,
        });
        return;

      case "error":
        console.error("❌ Alpaca error:", message);
        this.broadcastToSubscribers("alpaca_error", {
          code: message.code,
          message: message.msg,
        });
        return;

      default:
        // ignore other channel types (updatedBars/dailyBars/statuses/etc.)
        return;
    }
  }

  /** Send only to users who subscribed to the symbol */
  private broadcastToSubscribers(type: string, data: any) {
    const symbol = data?.symbol?.toUpperCase?.();
    if (!symbol) return;

    const users = this.symbolToUsers.get(symbol);
    if (!users || users.size === 0) return;

    const payload = { type, payload: data };

    // Prefer a targeted broadcast if your manager supports it.
    const mgr: any = WebSocketManager as any;
    if (typeof mgr.broadcastToUsers === "function") {
      mgr.broadcastToUsers(Array.from(users), payload);
    } else {
      // Fallback: global broadcast (add a targeted helper in your manager for efficiency)
      WebSocketManager.broadcast(payload);
    }
  }

  /**
   * Subscribe a user's symbols. If the socket isn't authenticated yet,
   * we queue and flush after auth.
   */
  async subscribeToSymbols(userId: string, symbols: string[]) {
    const syms = symbols.map((s) => s.toUpperCase()).filter(Boolean);
    if (syms.length === 0) return false;

    // Update user -> symbols
    if (!this.subscriptions.has(userId))
      this.subscriptions.set(userId, new Set());
    const userSet = this.subscriptions.get(userId)!;
    syms.forEach((s) => userSet.add(s));

    // Update symbol -> users
    for (const s of syms) {
      if (!this.symbolToUsers.has(s)) this.symbolToUsers.set(s, new Set());
      this.symbolToUsers.get(s)!.add(userId);
    }

    // Queue if not ready
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authed) {
      syms.forEach((s) => this.queuedSymbols.add(s));
      console.warn("Alpaca WS not ready; queued:", syms);
      return true;
    }

    const subscribeMessage: AlpacaSubscription = {
      action: "subscribe",
      trades: syms,
      quotes: syms,
      bars: syms,
    };
    console.log("📡 Subscribing to:", syms);
    this.ws.send(JSON.stringify(subscribeMessage));
    return true;
  }

  /**
   * Unsubscribe the user from the symbols. We only send a real unsubscribe
   * for symbols that no *other* user still has.
   */
  unsubscribeFromSymbols(userId: string, symbols: string[]) {
    const syms = symbols.map((s) => s.toUpperCase()).filter(Boolean);
    if (syms.length === 0) return false;

    // Remove from user -> symbols
    const userSet = this.subscriptions.get(userId);
    if (userSet) syms.forEach((s) => userSet.delete(s));

    // Update symbol -> users; collect symbols that are now unused
    const toUnsub: string[] = [];
    for (const s of syms) {
      const users = this.symbolToUsers.get(s);
      if (users) {
        users.delete(userId);
        if (users.size === 0) {
          this.symbolToUsers.delete(s);
          toUnsub.push(s);
        }
      }
      // Also remove from queued set if present
      this.queuedSymbols.delete(s);
    }

    // If not ready/open, we’re done (resubscribe logic will handle later)
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authed)
      return true;
    if (toUnsub.length === 0) return true;

    const unsubscribeMessage: AlpacaSubscription = {
      action: "unsubscribe",
      trades: toUnsub,
      quotes: toUnsub,
      bars: toUnsub,
    };
    console.log("🚫 Unsubscribing from:", toUnsub);
    this.ws.send(JSON.stringify(unsubscribeMessage));
    return true;
  }

  /** Resubscribe everything after (re)auth */
  private resubscribeAll() {
    // Union of current subscriptions + anything queued before auth
    const all = new Set<string>(this.queuedSymbols);
    for (const set of this.subscriptions.values())
      for (const s of set) all.add(s);
    this.queuedSymbols.clear();

    const syms = Array.from(all.values());
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      !this.authed ||
      syms.length === 0
    )
      return;

    const msg: AlpacaSubscription = {
      action: "subscribe",
      trades: syms,
      quotes: syms,
      bars: syms,
    };
    console.log("📡 Resubscribing all:", syms);
    this.ws.send(JSON.stringify(msg));
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Service shutdown");
      this.ws = null;
    }
    this.authed = false;
    this.readyPromise = null;
    this.resolveReady = null;

    this.subscriptions.clear();
    this.symbolToUsers.clear();
    this.queuedSymbols.clear();

    console.log("🔌 Alpaca WebSocket service disconnected");
  }

  isConnected(): boolean {
    return (
      this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.authed
    );
  }

  getSubscriptions(): Map<string, Set<string>> {
    // return copies to avoid external mutation
    const copy = new Map<string, Set<string>>();
    for (const [u, set] of this.subscriptions) copy.set(u, new Set(set));
    return copy;
  }
}

export default AlpacaWebSocketService.getInstance();

/**
 * If your WebSocketManager doesn't yet have a targeted sender, add this:
 *
 * static broadcastToUsers(userIds: string[], msg: any) {
 *   for (const id of userIds) {
 *     const set = this.clients.get(id);
 *     if (!set) continue;
 *     for (const ws of set) {
 *       if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
 *     }
 *   }
 * }
 */
