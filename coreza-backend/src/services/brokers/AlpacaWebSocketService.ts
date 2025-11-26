/**
 * @deprecated This file is kept for backward compatibility.
 * Use the config-driven WebSocketClient instead.
 */

import { WebSocketClient } from "../WebSocketClient";

/**
 * Legacy AlpacaWebSocketService - delegates to the generic WebSocketClient
 * @deprecated Use WebSocketClient directly
 */
export class AlpacaWebSocketService {
  private static instance: AlpacaWebSocketService;
  private client: ReturnType<typeof WebSocketClient.getInstance>;

  private constructor() {
    this.client = WebSocketClient.getInstance("alpaca_news");
  }

  static getInstance(): AlpacaWebSocketService {
    if (!AlpacaWebSocketService.instance) {
      AlpacaWebSocketService.instance = new AlpacaWebSocketService();
    }
    return AlpacaWebSocketService.instance;
  }

  async connect(credentials: { api_key: string; secret_key: string }) {
    return this.client.connect(credentials);
  }

  async subscribeToSymbols(userId: string, symbols: string[]) {
    return this.client.subscribe(userId, symbols);
  }

  unsubscribeFromSymbols(userId: string, symbols: string[]) {
    return this.client.unsubscribe(userId, symbols);
  }

  disconnect() {
    return this.client.disconnect();
  }

  isConnected(): boolean {
    return this.client.isReady();
  }

  getSubscriptions(userId: string): Record<string, string[]> {
    return this.client.getUserSubscriptions(userId);
  }
}

export default AlpacaWebSocketService.getInstance();
