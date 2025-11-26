# WebSocket Services

This module now uses a config-driven WebSocket architecture so new sources can be added by declaring a config entry instead of writing custom clients.

## Key Pieces
- `src/config/websockets.ts` holds per-source configuration such as URLs, auth helpers, message parsing, and subscription builders.
- `src/services/WebSocketClient.ts` is a generic reusable client that manages connections, reconnection, subscriptions, broadcasts, and workflow triggers.

## Usage Example
```typescript
import { WebSocketClient } from "../WebSocketClient";

const client = WebSocketClient.getInstance("alpaca_news");
await client.connect({ api_key: "YOUR_API_KEY", secret_key: "YOUR_SECRET_KEY" });
await client.subscribe("user123", ["AAPL"], { nodeId: "alpaca-node-1" });
```

The same client instance is reused per source ID and will resubscribe automatically after reconnections.
