/**
 * @deprecated This file is kept for backward compatibility.
 * Use AlpacaWebSocketClient from '../websockets/AlpacaWebSocketClient' instead.
 * 
 * This wrapper delegates to the new base class architecture.
 */

import { AlpacaWebSocketClient } from '../websockets/AlpacaWebSocketClient';

/**
 * Legacy AlpacaWebSocketService - delegates to new AlpacaWebSocketClient
 * @deprecated Use AlpacaWebSocketClient directly
 */
export class AlpacaWebSocketService {
  private static instance: AlpacaWebSocketService;
  private client: AlpacaWebSocketClient;

  private constructor() {
    this.client = AlpacaWebSocketClient.getInstance();
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

  getSubscriptions(): Map<string, Set<string>> {
    return this.client.getSubscriptions();
  }
}

export default AlpacaWebSocketService.getInstance();
