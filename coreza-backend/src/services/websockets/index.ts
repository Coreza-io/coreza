/**
 * WebSocket Services Module
 * 
 * This module provides WebSocket client implementations for connecting to external APIs.
 * All clients extend BaseWebSocketClient for consistent behavior.
 * 
 * @module websockets
 */

export { BaseWebSocketClient, WebSocketClientConfig, SubscriptionManager } from './BaseWebSocketClient';
export { AlpacaWebSocketClient } from './AlpacaWebSocketClient';

// Future exports:
// export { DhanWebSocketClient } from './DhanWebSocketClient';
// export { NewsWebSocketClient } from './NewsWebSocketClient';
// export { FinnhubWebSocketClient } from './FinnhubWebSocketClient';
