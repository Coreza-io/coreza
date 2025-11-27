# Market Stream Service

A dedicated microservice for managing real-time market data streaming from external brokers (Alpaca, Binance, Dhan, Schwab) to workflows and frontend clients.

## Architecture

This service is designed to run as a **single instance** in production to ensure only one WebSocket connection is established to each broker, preventing duplicate connections and resource waste.

### Components

1. **MarketControlHandler**: Listens to Redis control channels (`md:control:subscribe`, `md:control:unsubscribe`) and orchestrates gateway connections
2. **MarketDataGateway**: Manages WebSocket connections to external brokers and normalizes market events to `CorezaMarketEvent`
3. **MarketDataSubscriber**: Listens to market data channels (`md:symbol:*`), triggers workflow executions via BullMQ, and publishes to user-specific Redis channels for frontend delivery
4. **WorkflowCache**: Caches workflow definitions (60s TTL) to reduce database queries
5. **RedisBuffer**: Buffers messages when Redis circuit breaker opens, preventing data loss

### Redis Communication Pattern

```
API Servers (N instances) → PUBLISH to md:control:* → Market Stream Service (1 instance)
Market Stream Service → SUBSCRIBE to md:control:* → Connect to brokers
Brokers → Market Stream Service → Normalize → PUBLISH to md:symbol:*
Market Stream Service → SUBSCRIBE to md:symbol:* → Trigger workflows + PUBLISH to ws:user:*
API Servers → SUBSCRIBE to ws:user:* → Forward to WebSocket clients
```

### Key Features

- **Single broker connection**: Only one WebSocket connection per broker across all API instances
- **Symbol deduplication**: Multiple consumers requesting same symbol result in single subscription
- **Circuit breaker**: Graceful degradation when Redis unavailable
- **Message buffering**: Prevents data loss during Redis outages
- **Prometheus metrics**: Exposes metrics on `/metrics` endpoint
- **Health checks**: `/health` endpoint for monitoring gateway status

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MARKET_STREAM_PORT` | No | HTTP port for health/metrics (default: 8090) |
| `REDIS_HOST` | Yes | Redis hostname |
| `REDIS_PORT` | No | Redis port (default: 6379) |
| `REDIS_URL` | Yes | Full Redis connection URL |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |
| `COREZA_ENCRYPTION_KEY` | Yes | Encryption key for credential decryption |
| `NODE_ENV` | No | Environment (default: development) |

## Running Locally

```bash
cd coreza-backend/market-stream-service
npm install
npm run dev
```

### Health Check Verification

After starting the service, verify it's running correctly:

```bash
npm run verify-health
```

This script checks:
- HTTP server is responding
- All components initialized properly
- Circuit breakers are functioning
- Redis connection is active

### Startup Validation

The service automatically validates on startup:
1. **Environment Variables**: Checks all required variables are set
2. **Redis Connection**: Tests PING, SET/GET operations, checks version
3. **Supabase Connection**: Validates access to workflows, workflow_runs, user_credentials tables
4. **Timeout**: Fails fast (10s) if dependencies unavailable

## Docker Deployment

### docker-compose.yml

```yaml
market-stream-service:
  build:
    context: ./coreza-backend/market-stream-service
    dockerfile: Dockerfile
  ports:
    - "8090:8090"
  environment:
    - NODE_ENV=production
    - REDIS_URL=redis://redis:6379
    - SUPABASE_URL=${SUPABASE_URL}
    # ... other env vars
  deploy:
    replicas: 1  # CRITICAL: Must be exactly 1
```

### render.yaml

```yaml
- type: worker
  name: market-stream-service
  env: node
  plan: starter
  buildCommand: "cd coreza-backend/market-stream-service && npm install && npm run build"
  startCommand: "cd coreza-backend/market-stream-service && npm start"
```

## Monitoring

- **Health Check**: `GET http://localhost:8090/health`
- **Prometheus Metrics**: `GET http://localhost:8090/metrics`

### Key Metrics

- `coreza_market_messages_total`: Total market events processed
- `coreza_workflow_executions_total`: Total workflows triggered
- `coreza_active_gateway_connections`: Active broker connections
- `coreza_subscribed_symbols`: Current symbol subscriptions
- `coreza_redis_buffer_size`: Buffered messages during Redis outage

## Production Considerations

1. **Single Instance Constraint**: Deploy ONLY ONE instance. Multiple instances will create duplicate broker connections.
2. **High Availability**: Use container restart policies to ensure service availability.
3. **Resource Limits**: Allocate sufficient memory (512MB+) for message buffering and cache.
4. **Circuit Breaker**: Configure Redis circuit breaker thresholds based on expected load.
5. **Credential Rotation**: Market data gateways support OAuth token refresh for brokers like Schwab.

## Troubleshooting

### Service won't start

**1. Check startup validation logs:**
```bash
npm run dev
# Look for validation errors in structured JSON logs
```

Common failures:
- **Missing environment variables**: Check `.env` file matches `.env.example`
- **Redis connection failed**: Ensure Redis is running (`redis-cli ping`)
- **Supabase connection failed**: Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

**2. Run health check after startup:**
```bash
npm run verify-health
```

**3. Check Redis version:**
```bash
redis-cli INFO server | grep redis_version
```

If below 6.2.0, upgrade Redis for optimal BullMQ performance:

**Docker:**
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

**Windows (Chocolatey):**
```bash
choco upgrade redis-64
```

### No market data flowing to workflows

- Check market-stream-service logs for gateway connection status
- Verify Redis connectivity: `redis-cli ping`
- Check `/health` endpoint for gateway state
- Verify broker credentials are valid and not expired

### Duplicate broker connections

- Ensure only ONE instance of market-stream-service is running
- Check docker-compose.yml: `deploy.replicas: 1`
- Verify no leftover processes: `ps aux | grep market-stream`

### Circuit breaker open

- Redis connection issue - check Redis logs
- Check buffered message count in `/health` endpoint
- Messages will be buffered up to 10,000 and flushed when Redis recovers

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    API Servers (N instances)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Instance 1 │  │   Instance 2 │  │   Instance N │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │ PUBLISH         │ PUBLISH         │ PUBLISH       │
│         └─────────────────┴─────────────────┘               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │    Redis Pub/Sub       │
              │  md:control:subscribe  │
              │ md:control:unsubscribe │
              └────────┬───────────────┘
                       │ SUBSCRIBE
                       ▼
       ┌───────────────────────────────────────┐
       │   Market Stream Service (1 instance)  │
       │  ┌─────────────────────────────────┐  │
       │  │   MarketControlHandler          │  │
       │  │   - Listens to control channels │  │
       │  │   - Manages gateways            │  │
       │  └─────────┬───────────────────────┘  │
       │            │                           │
       │            ▼                           │
       │  ┌─────────────────────────────────┐  │
       │  │   MarketDataGateway             │  │
       │  │   - Alpaca WebSocket            │  │
       │  │   - Binance WebSocket           │  │
       │  │   - Dhan WebSocket              │  │
       │  │   - Schwab WebSocket            │  │
       │  └─────────┬───────────────────────┘  │
       │            │ Normalize               │
       │            ▼                           │
       │  ┌─────────────────────────────────┐  │
       │  │   MarketDataSubscriber          │  │
       │  │   - Triggers workflows          │  │
       │  │   - Publishes to ws:user:*      │  │
       │  └─────────────────────────────────┘  │
       └───────────────────────────────────────┘
```
