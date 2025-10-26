# WebSocket Services

This module provides a simplified WebSocket client for connecting to the Alpaca News API.

## Architecture

### AlpacaNewsWebSocketClient

A standalone WebSocket client for streaming real-time news from Alpaca Markets.

**Features:**
- Header-based authentication (APCA-API-KEY-ID, APCA-API-SECRET-KEY)
- Automatic reconnection with exponential backoff
- User-based subscription management
- Symbol-specific and wildcard ("*") subscriptions
- Message broadcasting to WebSocketManager

**Endpoint:** `wss://stream.data.alpaca.markets/v1beta1/news`

## Usage Example

```typescript
import { AlpacaNewsWebSocketClient } from './websockets/AlpacaNewsWebSocketClient';

// Get singleton instance
const client = AlpacaNewsWebSocketClient.getInstance();

// Connect with credentials
await client.connect({
  api_key: 'YOUR_API_KEY',
  secret_key: 'YOUR_SECRET_KEY'
});

// Subscribe to news for specific symbols
await client.subscribe('user123', ['AAPL', 'MSFT']);

// Subscribe to all news
await client.subscribe('user456', ['*']);

// Unsubscribe
await client.unsubscribe('user123', ['AAPL']);

// Get stats
const stats = client.getStats();
console.log(stats);
```

## Message Flow

```
Frontend Client
    ↓
WebSocket Connection (port 8081)
    ↓
WebSocketManager.handleAlpacaStream()
    ↓
AlpacaNewsWebSocketClient.subscribe(userId, symbols)
    ↓
Alpaca News API (wss://stream.data.alpaca.markets/v1beta1/news)
    ↓
News Message { T: "n", headline, symbols, ... }
    ↓
AlpacaNewsWebSocketClient.handleNews()
    ↓
WebSocketManager.sendToUser(userId, newsData)
    ↓
Frontend Client receives news
```

## Message Types

### Subscribe (Frontend → Backend)
```json
{
  "type": "alpaca_news",
  "payload": {
    "action": "subscribe",
    "symbols": ["AAPL", "MSFT"],
    "credential_id": "cred-123"
  }
}
```

### News Event (Backend → Frontend)
```json
{
  "type": "alpaca_news",
  "payload": {
    "id": 123,
    "headline": "Apple announces new product",
    "summary": "Apple Inc. today announced...",
    "symbols": ["AAPL"],
    "source": "Bloomberg",
    "created_at": "2025-10-16T10:00:00Z",
    "updated_at": "2025-10-16T10:00:00Z",
    "url": "https://...",
    "content": "Full article content...",
    "author": "John Doe"
  },
  "timestamp": "2025-10-16T10:00:01Z"
}
```

## Alpaca Message Types

The Alpaca News WebSocket API sends these message types:

| Type | T Value | Description |
|------|---------|-------------|
| Success | "success" | Handshake confirmation (connected, authenticated) |
| Subscription | "subscription" | Subscription confirmation |
| News | "n" | News article with headline, summary, symbols, etc. |
| Error | "error" | Error message with code and msg |

## Subscription Management

The client maintains two mappings:
- **userSubscriptions**: `Map<userId, Set<symbols>>`
- **symbolSubscribers**: `Map<symbol, Set<userIds>>`

This allows:
1. Efficient broadcasting to users subscribed to specific symbols
2. Automatic unsubscription when no users are listening
3. Wildcard support for "all news" subscriptions

## Reconnection Strategy

- **Max attempts**: 5
- **Initial delay**: 1000ms
- **Backoff**: Exponential (2^n)
- **Max delay**: 30 seconds

When reconnecting:
1. All pending subscriptions are processed
2. All existing symbols are resubscribed
3. Users receive no duplicate messages

## API Endpoints

### Backend REST API

- `POST /alpaca-news/subscribe` - Subscribe to news
- `POST /alpaca-news/unsubscribe` - Unsubscribe from news
- `GET /alpaca-news/status` - Get connection status
- `GET /alpaca-news/subscriptions/:userId` - Get user's subscriptions

### Frontend Node

The `AlpacaNews` node in the workflow editor allows users to:
- Select Alpaca credentials
- Choose subscribe/unsubscribe operation
- Specify symbols (comma-separated or "*" for all)

## Best Practices

1. **Singleton Pattern**: Use `getInstance()` to ensure one connection per server
2. **Error Handling**: Always wrap operations in try-catch blocks
3. **Cleanup**: Unsubscribe users when they disconnect
4. **Logging**: Enable debug mode during development
5. **Credentials**: Never hardcode API keys; use credential manager
6. **Wildcard**: Use "*" sparingly to avoid overwhelming clients

## Future Enhancements

Potential additions to this module:
- Support for other data providers (Dhan, Finnhub, etc.)
- Rate limiting and throttling
- Message filtering and transformation
- Historical news lookup
- Sentiment analysis integration
