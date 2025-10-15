# WebSocket Services

✅ **Status: Fully Integrated** - The new WebSocket architecture is fully connected to the backend execution flow.

This directory contains WebSocket client implementations for connecting to external APIs (brokers, news feeds, data providers, etc.).

## Architecture

All WebSocket clients extend `BaseWebSocketClient`, which provides:

- **Connection Management**: Connect, disconnect, reconnect with exponential backoff
- **Authentication**: Flexible authentication mechanism per service
- **Subscription Management**: User-based subscription tracking
- **Message Routing**: Type-based message handling and broadcasting
- **Heartbeat**: Automatic keepalive mechanism
- **Error Handling**: Robust error recovery and logging
- **Integration**: Seamless integration with WebSocketManager for client notifications

## Usage

### Creating a New WebSocket Client

```typescript
import { BaseWebSocketClient, WebSocketClientConfig } from './BaseWebSocketClient';

export class MyBrokerWebSocketClient extends BaseWebSocketClient<string> {
  private static instance: MyBrokerWebSocketClient;

  private constructor() {
    super({
      url: "wss://api.mybroker.com/stream",
      maxReconnectAttempts: 5,
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 15000,
      debug: true,
    });
  }

  static getInstance(): MyBrokerWebSocketClient {
    if (!MyBrokerWebSocketClient.instance) {
      MyBrokerWebSocketClient.instance = new MyBrokerWebSocketClient();
    }
    return MyBrokerWebSocketClient.instance;
  }

  protected getServiceName(): string {
    return "MyBroker";
  }

  protected authenticate(): void {
    this.send({
      action: "authenticate",
      api_key: this.credentials.api_key,
    });
  }

  protected handleAuthSuccess(): void {
    console.log("MyBroker authenticated successfully");
  }

  protected parseMessage(message: any): void {
    switch (message.type) {
      case "trade":
        this.broadcastToSubscribers("broker_trade", {
          symbol: message.symbol,
          price: message.price,
          volume: message.volume,
        }, "symbol");
        break;
      
      case "quote":
        this.broadcastToSubscribers("broker_quote", message, "symbol");
        break;
    }
  }

  protected buildSubscribeMessage(symbols: string[]): any {
    return {
      action: "subscribe",
      symbols: symbols,
    };
  }

  protected buildUnsubscribeMessage(symbols: string[]): any {
    return {
      action: "unsubscribe",
      symbols: symbols,
    };
  }

  protected normalizeItems(symbols: string[]): string[] {
    return symbols.map(s => s.toUpperCase());
  }
}

export default MyBrokerWebSocketClient.getInstance();
```

### Using a WebSocket Client

```typescript
import { MyBrokerWebSocketClient } from './websockets/MyBrokerWebSocketClient';

// Get client instance
const client = MyBrokerWebSocketClient.getInstance();

// Connect with credentials
await client.connect({
  api_key: 'your_api_key',
  secret_key: 'your_secret',
});

// Subscribe user to symbols
await client.subscribe('user123', ['AAPL', 'MSFT', 'GOOGL']);

// Unsubscribe
client.unsubscribe('user123', ['GOOGL']);

// Check status
console.log(client.isReady()); // true if connected and authenticated

// Disconnect
client.disconnect();
```

## Existing Implementations

### AlpacaWebSocketClient

✅ **Fully Implemented & Integrated**

Connects to Alpaca's market data WebSocket API for real-time:
- **Trades** - Real-time trade executions
- **Quotes** - Bid/ask prices and sizes
- **Bars** - OHLCV candlestick data
- **News** - Market news updates

**File**: `AlpacaWebSocketClient.ts`

**Integration Points**:
- Used by `AlpacaStreamService` for broker operations
- Connected to `WebSocketManager` for client notifications
- Broadcasts to subscribed users via `WebSocketManager.sendToUser()`

**Usage**:
```typescript
import { AlpacaWebSocketClient } from './websockets';

const client = AlpacaWebSocketClient.getInstance();

// Connect with credentials
await client.connect({ api_key: 'xxx', secret_key: 'yyy' });

// Subscribe user to symbols (includes trades, quotes, bars, news)
await client.subscribe('user123', ['AAPL', 'MSFT']);

// Check status
console.log(client.isReady()); // true if authenticated
console.log(client.isConnected()); // true if connected

// Unsubscribe
await client.unsubscribe('user123', ['AAPL']);
```

**Message Types Broadcast**:
- `alpaca_trade` - Trade data with symbol, price, size, timestamp
- `alpaca_quote` - Quote data with bid/ask prices and sizes
- `alpaca_bar` - OHLCV bar data with open, high, low, close, volume
- `alpaca_news` - News articles with headline, summary, symbols, source

## Future Implementations

### DhanWebSocketClient (Planned)

Connects to Dhan broker for Indian market data.

### NewsWebSocketClient (Planned)

Connects to news feed APIs for real-time news updates.

### FinnhubWebSocketClient (Planned)

Connects to Finnhub for additional market data streams.

## Message Flow

1. **Client subscribes** via frontend WebSocket to WebSocketManager (port 8081)
2. **WebSocketManager** receives subscription request and routes to appropriate client
3. **WebSocketClient** (e.g., AlpacaWebSocketClient) manages subscription with external API
4. **External API** (e.g., Alpaca) sends real-time data to WebSocketClient
5. **WebSocketClient** broadcasts data to subscribed users via `WebSocketManager.sendToUser()`
6. **WebSocketManager** delivers data to connected client WebSocket connections

### Example Flow for Alpaca Stream

```
Frontend Client → WebSocket (port 8081)
    ↓ { type: "alpaca_stream", action: "subscribe", symbols: ["AAPL"] }
WebSocketManager.handleAlpacaStream()
    ↓ AlpacaWebSocketClient.subscribe(userId, ["AAPL"])
AlpacaWebSocketClient → Alpaca API (wss://stream.data.alpaca.markets)
    ↓ { T: "t", S: "AAPL", p: 150.25, s: 100 }
AlpacaWebSocketClient.broadcastToSubscribers("alpaca_trade", data)
    ↓ WebSocketManager.sendToUser(userId, { type: "alpaca_trade", ... })
Frontend Client ← Receives real-time trade data
```

**Architecture Diagram**:
```
Frontend WS ←→ WebSocketManager ←→ AlpacaWebSocketClient ←→ Alpaca API
  (Port 8081)   (Singleton)          (Singleton)           (External)
                      ↓
               Other Clients (Dhan, News, Finnhub - Planned)
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | required | WebSocket URL to connect to |
| `maxReconnectAttempts` | number | 5 | Maximum reconnection attempts |
| `initialReconnectDelay` | number | 1000 | Initial reconnection delay (ms) |
| `maxReconnectDelay` | number | 30000 | Maximum reconnection delay (ms) |
| `heartbeatInterval` | number | 15000 | Heartbeat ping interval (ms) |
| `debug` | boolean | false | Enable debug logging |

## Best Practices

1. **Singleton Pattern**: Always use singleton pattern for WebSocket clients
2. **Error Handling**: Implement robust error handling in message parsing
3. **Normalization**: Normalize subscription items (e.g., uppercase symbols)
4. **Logging**: Use the built-in `log()` method for consistent logging
5. **Broadcasting**: Use `broadcastToSubscribers()` for targeted user notifications
6. **Resource Cleanup**: Always call `disconnect()` when shutting down

## Testing

```typescript
// Test connection
const client = MyBrokerWebSocketClient.getInstance();
await client.connect(credentials);
console.log(client.isReady()); // Should be true

// Test subscription
await client.subscribe('testuser', ['AAPL']);
const subs = client.getSubscriptions();
console.log(subs.get('testuser')); // Should contain 'AAPL'

// Test disconnection
client.disconnect();
console.log(client.isConnected()); // Should be false
```
