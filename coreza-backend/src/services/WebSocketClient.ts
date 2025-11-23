import WebSocket from "ws";
import { supabase } from "../config/supabase";
import { WebSocketManager } from "./websocketManager";
import { executeWorkflow } from "./workflowEngine";
import {
  WebSocketSourceConfig,
  getWebSocketConfig,
} from "../config/websockets";
import { getRedis } from "../config/redis";

interface SubscriberInfo {
  userId: string;
  nodeId: string;
}

type UserNodeSubscriptions = Map<string, Set<string>>;

export class WebSocketClient {
  private static instances = new Map<string, WebSocketClient>();

  private ws: WebSocket | null = null;
  private config: WebSocketSourceConfig;
  private credentials: any = null;

  private userSubscriptions: Map<string, UserNodeSubscriptions> = new Map();
  private symbolSubscribers: Map<string, Set<string>> = new Map();
  private subscriberDirectory: Map<string, SubscriberInfo> = new Map();
  private pendingSubscriptions: Array<{
    userId: string;
    symbols: string[];
    workflowId?: string;
    nodeId: string;
  }> = [];

  private symbolWorkflowSubscribers: Map<string, Set<string>> = new Map();
  private workflowMetadata: Map<
    string,
    { userId: string; nodeId?: string; symbols: Set<string> }
  > = new Map();

  private isAuthenticated = false;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  private constructor(config: WebSocketSourceConfig) {
    this.config = config;
    this.restoreSubscriptionsFromRedis().catch((err) => {
      console.error(`[${this.config.id}] Failed to restore subscriptions from Redis:`, err);
    });
  }

  static getInstance(sourceId: string): WebSocketClient {
    if (!this.instances.has(sourceId)) {
      const config = getWebSocketConfig(sourceId);
      if (!config) {
        throw new Error(`Unknown WebSocket source: ${sourceId}`);
      }
      this.instances.set(sourceId, new WebSocketClient(config));
    }

    return this.instances.get(sourceId)!;
  }

  private getSubscriberKey(userId: string, nodeId: string): string {
    return `${userId}::${nodeId}`;
  }

  async connect(credentials: any): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.isConnecting) {
      return;
    }

    this.credentials = credentials;
    this.isConnecting = true;
    this.isAuthenticated = false;

    const url =
      typeof this.config.url === "function"
        ? this.config.url(credentials)
        : this.config.url;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, {
          headers: this.config.makeAuthHeaders?.(credentials),
        });

        this.ws.on("open", () => {
          this.isConnecting = false;
          this.reconnectAttempts = 0;

          const authMessage = this.config.makeAuthMessage?.(credentials);
          if (authMessage) {
            this.sendRaw(authMessage);
          }
        });

        this.ws.on("message", (data: Buffer) => this.handleMessage(data));

        this.ws.on("close", (code: number, reason: Buffer) => {
          this.isAuthenticated = false;
          this.isConnecting = false;
          this.handleReconnect(code, reason.toString());
        });

        this.ws.on("error", (error: Error) => {
          this.isConnecting = false;
          reject(error);
        });

        const authCheckInterval = setInterval(() => {
          if (this.isAuthenticated) {
            clearInterval(authCheckInterval);
            resolve();
          }
        }, 100);

        setTimeout(() => {
          if (!this.isAuthenticated) {
            clearInterval(authCheckInterval);
            reject(new Error("Authentication timeout"));
          }
        }, 10000);
      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private handleMessage(buffer: Buffer): void {
    const parser = this.config.parseMessage ?? ((data: Buffer) => [JSON.parse(data.toString())]);

    let messages: any[] = [];
    try {
      messages = parser(buffer) || [];
    } catch (error) {
      console.error(`[${this.config.id}] Failed to parse message`, error);
      return;
    }

    messages.forEach((msg) => this.processMessage(msg));
  }

  private processMessage(msg: any): void {
    const type = this.config.identifyMessageType(msg);

    switch (type) {
      case "success":
      case "authenticated":
        this.isAuthenticated = true;
        this.resubscribeAll();
        break;
      default: {
        if (this.config.shouldTriggerWorkflow?.(msg)) {
          this.handleDataMessage(msg).catch((err) => {
            console.error(`[${this.config.id}] Failed to handle message`, err);
          });
        }
        break;
      }
    }
  }

  private async handleDataMessage(msg: any): Promise<void> {
    const data = this.config.extractData(msg);
    const symbols = this.config.extractSymbols?.(msg) || [];

    this.broadcastToSubscribers(symbols, data);
    await this.triggerWorkflows(symbols, data);
  }

  private broadcastToSubscribers(symbols: string[], data: any): void {
    const notifiedSubscribers = new Set<string>();

    const wildcardSubs = this.symbolSubscribers.get("*") || new Set();
    wildcardSubs.forEach((key) => notifiedSubscribers.add(key));

    const normalizedSymbols = symbols.map((symbol: string) =>
      symbol === "*" ? "*" : symbol.toUpperCase()
    );

    normalizedSymbols.forEach((symbol) => {
      const subs = this.symbolSubscribers.get(symbol) || new Set();
      subs.forEach((key) => notifiedSubscribers.add(key));
    });

    notifiedSubscribers.forEach((subscriberKey) => {
      const info = this.subscriberDirectory.get(subscriberKey);
      if (!info) {
        return;
      }

      WebSocketManager.sendToUser(info.userId, {
        type: this.config.id,
        payload: {
          nodeId: info.nodeId,
          data,
          symbols: normalizedSymbols.length ? normalizedSymbols : ["*"],
        },
      });
    });
  }

  private async triggerWorkflows(symbols: string[], data: any): Promise<void> {
    const normalizedSymbols = symbols.map((s) => s.toUpperCase());
    const workflowIds = new Set<string>();

    const wildcard = this.symbolWorkflowSubscribers.get("*");
    if (wildcard) {
      wildcard.forEach((id) => workflowIds.add(id));
    }

    normalizedSymbols.forEach((symbol) => {
      const workflows = this.symbolWorkflowSubscribers.get(symbol);
      workflows?.forEach((id) => workflowIds.add(id));
    });

    for (const workflowId of workflowIds) {
      const metadata = this.workflowMetadata.get(workflowId);
      if (!metadata) {
        continue;
      }

      const { userId } = metadata;
      const { data: workflow } = await supabase
        .from("workflows")
        .select("id, user_id, nodes, edges, is_active")
        .eq("id", workflowId)
        .single();

      if (!workflow) {
        continue;
      }

      if (!workflow.is_active) {
        continue;
      }

      const { data: run, error: runError } = await supabase
        .from("workflow_runs")
        .insert({
          workflow_id: workflowId,
          status: "running",
          initiated_by: userId,
        })
        .select()
        .single();

      if (runError || !run) {
        console.error(
          `[${this.config.id}] Failed to create workflow run for ${workflowId}:`,
          runError
        );
        continue;
      }

      executeWorkflow(run.id, workflowId, userId, workflow.nodes, workflow.edges, {
        initialInput: { data },
      }).catch(async (error) => {
        console.error(
          `[${this.config.id}] Workflow ${workflowId} execution error:`,
          error
        );

        await supabase
          .from("workflow_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: error.message,
          })
          .eq("id", run.id);
      });
    }
  }

  async subscribe(
    userId: string,
    symbols: string[],
    options: { workflowId?: string; nodeId?: string; streamTypes?: string[] } = {}
  ): Promise<boolean> {
    if (!this.credentials) {
      throw new Error("Not connected. Call connect() first.");
    }

    const nodeId = options.nodeId;
    if (!nodeId) {
      throw new Error("nodeId is required for subscriptions");
    }

    const normalizedSymbols = symbols
      .map((s) => (s === "*" ? "*" : s.toUpperCase()))
      .filter(Boolean);

    if (!normalizedSymbols.length) {
      throw new Error("No symbols provided");
    }

    if (!this.isAuthenticated) {
      this.pendingSubscriptions.push({
        userId,
        symbols: normalizedSymbols,
        workflowId: options.workflowId,
        nodeId,
      });
      return true;
    }

    if (!this.userSubscriptions.has(userId)) {
      this.userSubscriptions.set(userId, new Map());
    }

    const userNodes = this.userSubscriptions.get(userId)!;
    if (!userNodes.has(nodeId)) {
      userNodes.set(nodeId, new Set());
    }

    const nodeSymbols = userNodes.get(nodeId)!;
    const subscriberKey = this.getSubscriberKey(userId, nodeId);
    this.subscriberDirectory.set(subscriberKey, { userId, nodeId });

    const newSymbols: string[] = [];

    normalizedSymbols.forEach((symbol) => {
      if (!nodeSymbols.has(symbol)) {
        nodeSymbols.add(symbol);

        if (!this.symbolSubscribers.has(symbol)) {
          this.symbolSubscribers.set(symbol, new Set());
        }
        const subscribers = this.symbolSubscribers.get(symbol)!;
        const wasEmpty = subscribers.size === 0;
        subscribers.add(subscriberKey);
        if (wasEmpty) {
          newSymbols.push(symbol);
        }
      }
    });

    if (options.workflowId) {
      const workflowId = options.workflowId;
      let metadata = this.workflowMetadata.get(workflowId);
      if (!metadata) {
        metadata = { userId, nodeId, symbols: new Set() };
        this.workflowMetadata.set(workflowId, metadata);
      }
      metadata.nodeId = nodeId;

      normalizedSymbols.forEach((symbol) => {
        metadata!.symbols.add(symbol);
        if (!this.symbolWorkflowSubscribers.has(symbol)) {
          this.symbolWorkflowSubscribers.set(symbol, new Set());
        }
        this.symbolWorkflowSubscribers.get(symbol)!.add(workflowId);
      });
    }

    if (newSymbols.length > 0) {
      this.sendSubscription("subscribe", newSymbols, options.streamTypes);
    }

    await this.persistSubscriptionsToRedis(userId, nodeId, options.streamTypes);

    return true;
  }

  async unsubscribe(
    userId: string,
    symbols: string[],
    options: { workflowId?: string; nodeId?: string; streamTypes?: string[] } = {}
  ): Promise<boolean> {
    const normalizedSymbols = symbols
      .map((s) => (s === "*" ? "*" : s.toUpperCase()))
      .filter(Boolean);

    if (!normalizedSymbols.length) {
      return true;
    }

    const userNodes = this.userSubscriptions.get(userId);
    if (!userNodes) {
      return true;
    }

    const targetNodeIds = options.nodeId
      ? [options.nodeId]
      : Array.from(userNodes.keys());

    const symbolsToUnsubscribe: string[] = [];

    targetNodeIds.forEach((nodeId) => {
      const nodeSymbols = userNodes.get(nodeId);
      if (!nodeSymbols) {
        return;
      }

      const subscriberKey = this.getSubscriberKey(userId, nodeId);

      normalizedSymbols.forEach((symbol) => {
        if (!nodeSymbols.has(symbol)) {
          return;
        }
        nodeSymbols.delete(symbol);

        const subscribers = this.symbolSubscribers.get(symbol);
        if (subscribers) {
          subscribers.delete(subscriberKey);
          if (subscribers.size === 0) {
            this.symbolSubscribers.delete(symbol);
            symbolsToUnsubscribe.push(symbol);
          }
        }
      });

      if (nodeSymbols.size === 0) {
        userNodes.delete(nodeId);
        this.subscriberDirectory.delete(subscriberKey);
      }
    });

    if (options.workflowId) {
      const workflowId = options.workflowId;
      const metadata = this.workflowMetadata.get(workflowId);
      if (metadata && metadata.userId === userId) {
        normalizedSymbols.forEach((symbol) => {
          metadata.symbols.delete(symbol);
          const workflows = this.symbolWorkflowSubscribers.get(symbol);
          if (workflows) {
            workflows.delete(workflowId);
            if (workflows.size === 0) {
              this.symbolWorkflowSubscribers.delete(symbol);
            }
          }
        });

        if (metadata.symbols.size === 0) {
          this.workflowMetadata.delete(workflowId);
        }
      }
    }

    if (userNodes.size === 0) {
      this.userSubscriptions.delete(userId);
    }

    if (symbolsToUnsubscribe.length > 0 && this.isAuthenticated) {
      this.sendSubscription("unsubscribe", Array.from(new Set(symbolsToUnsubscribe)), options.streamTypes);
    }

    await this.cleanupRedisSubscriptions(userId, options.nodeId);

    return true;
  }

  private sendSubscription(action: "subscribe" | "unsubscribe", symbols: string[], streamTypes?: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message =
      action === "subscribe"
        ? this.config.makeSubscribeMessage(symbols, streamTypes)
        : this.config.makeUnsubscribeMessage(symbols, streamTypes);

    this.ws.send(JSON.stringify(message));
  }

  private resubscribeAll(): void {
    const pending = [...this.pendingSubscriptions];
    this.pendingSubscriptions = [];

    pending.forEach(({ userId, symbols, workflowId, nodeId }) => {
      this.subscribe(userId, symbols, { workflowId, nodeId }).catch((err) => {
        console.error("Failed to process pending subscription:", err);
      });
    });

    const allSymbols = Array.from(this.symbolSubscribers.keys());
    if (allSymbols.length > 0) {
      this.sendSubscription("subscribe", allSymbols);
    }
  }

  private handleReconnect(code: number, reason: string): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? 5;
    if (this.reconnectAttempts >= maxAttempts) {
      console.error(`[${this.config.id}] Max reconnection attempts reached`);
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    const delay = (this.config.reconnectDelay ?? 1000) * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      if (this.credentials) {
        this.connect(this.credentials).catch((err) => {
          console.error("Reconnection failed:", err);
        });
      }
    }, delay);
  }

  private sendRaw(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  isReady(): boolean {
    return (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      this.isAuthenticated
    );
  }

  getUserSubscriptions(userId: string): Record<string, string[]> {
    const userNodes = this.userSubscriptions.get(userId);
    if (!userNodes) {
      return {};
    }

    const result: Record<string, string[]> = {};
    userNodes.forEach((symbols, nodeId) => {
      result[nodeId] = Array.from(symbols);
    });
    return result;
  }

  getAllSymbols(): string[] {
    return Array.from(this.symbolSubscribers.keys());
  }

  getStats(): any {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN,
      authenticated: this.isAuthenticated,
      totalUsers: this.userSubscriptions.size,
      totalSymbols: this.symbolSubscribers.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

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
  }

  // ========== Redis Persistence Methods ==========

  private getRedisKey(suffix: string): string {
    return `ws:${this.config.id}:${suffix}`;
  }

  private async persistSubscriptionsToRedis(userId: string, nodeId: string, streamTypes?: string[]): Promise<void> {
    try {
      const redis = getRedis();
      const key = this.getRedisKey(`subs:${userId}:${nodeId}`);

      const userNodes = this.userSubscriptions.get(userId);
      if (!userNodes) return;

      const nodeSymbols = userNodes.get(nodeId);
      if (!nodeSymbols || nodeSymbols.size === 0) {
        await redis.del(key);
        return;
      }

      const symbolsArray = Array.from(nodeSymbols);
      const data = { symbols: symbolsArray, streamTypes: streamTypes || [] };
      await redis.set(key, JSON.stringify(data), "EX", 86400 * 7); // 7 days TTL
    } catch (error) {
      console.error(`[${this.config.id}] Failed to persist subscriptions to Redis:`, error);
    }
  }

  private async restoreSubscriptionsFromRedis(): Promise<void> {
    try {
      const redis = getRedis();
      const pattern = this.getRedisKey("subs:*");
      const keys = await redis.keys(pattern);

      for (const key of keys) {
        try {
          const data = await redis.get(key);
          if (!data) continue;

          const parsed = JSON.parse(data);
          const symbols = Array.isArray(parsed) ? parsed : (parsed.symbols || []);
          const streamTypes = parsed.streamTypes || [];
          
          const parts = key.split(":");
          if (parts.length < 4) continue;

          const userId = parts[2];
          const nodeId = parts[3];

          if (!this.userSubscriptions.has(userId)) {
            this.userSubscriptions.set(userId, new Map());
          }

          const userNodes = this.userSubscriptions.get(userId)!;
          if (!userNodes.has(nodeId)) {
            userNodes.set(nodeId, new Set());
          }

          const nodeSymbols = userNodes.get(nodeId)!;
          const subscriberKey = this.getSubscriberKey(userId, nodeId);
          this.subscriberDirectory.set(subscriberKey, { userId, nodeId });

          symbols.forEach((symbol: string) => {
            nodeSymbols.add(symbol);

            if (!this.symbolSubscribers.has(symbol)) {
              this.symbolSubscribers.set(symbol, new Set());
            }
            this.symbolSubscribers.get(symbol)!.add(subscriberKey);
          });

          console.log(
            `[${this.config.id}] Restored ${symbols.length} symbols for ${userId}:${nodeId}${streamTypes.length > 0 ? ` (types: ${streamTypes.join(',')})` : ''}`
          );
        } catch (parseError) {
          console.error(`[${this.config.id}] Failed to parse subscription data from ${key}:`, parseError);
        }
      }

      if (keys.length > 0) {
        console.log(
          `[${this.config.id}] Restored ${keys.length} subscription entries from Redis`
        );
      }
    } catch (error) {
      console.error(`[${this.config.id}] Failed to restore subscriptions from Redis:`, error);
    }
  }

  private async cleanupRedisSubscriptions(userId: string, nodeId?: string): Promise<void> {
    try {
      const redis = getRedis();

      if (nodeId) {
        const key = this.getRedisKey(`subs:${userId}:${nodeId}`);
        await redis.del(key);
      } else {
        const pattern = this.getRedisKey(`subs:${userId}:*`);
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } catch (error) {
      console.error(`[${this.config.id}] Failed to cleanup Redis subscriptions:`, error);
    }
  }
}
