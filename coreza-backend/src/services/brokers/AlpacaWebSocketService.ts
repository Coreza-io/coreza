/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

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
