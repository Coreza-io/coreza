/**
 * @deprecated This file is kept for backward compatibility.
 * Use AlpacaNewsWebSocketClient from '../websockets/AlpacaNewsWebSocketClient' instead.
 * 
 * This wrapper delegates to the new base class architecture.
 */

import { AlpacaNewsWebSocketClient } from '../websockets/AlpacaNewsWebSocketClient';

/**
 * Legacy AlpacaWebSocketService - delegates to AlpacaNewsWebSocketClient
 * @deprecated Use AlpacaNewsWebSocketClient directly
 */
export class AlpacaWebSocketService {
  private static instance: AlpacaWebSocketService;
  private client: AlpacaNewsWebSocketClient;

  private constructor() {
    this.client = AlpacaNewsWebSocketClient.getInstance();
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
