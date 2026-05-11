# Market Stream Service Deployment Guide

## Overview

The Market Stream Service is a dedicated microservice that manages all real-time market data connections to external brokers (Alpaca, Binance, Dhan, Schwab). This document explains the architecture, deployment strategy, and migration path.

## Why a Separate Microservice?

### Problem Before

In the monolithic architecture, **every backend instance** initialized:
- `MarketControlHandler` (listens to Redis control channels)
- `MarketDataGateway` (connects to broker WebSockets)
- `MarketDataSubscriber` (triggers workflows on market events)

**Result**: 
- If you deploy 3 API instances, you get **3 WebSocket connections** to Alpaca, Binance, etc.
- Wasted resources, potential rate-limiting, inconsistent state
- Cannot scale API servers horizontally without multiplying broker connections

### Solution: Single Market Stream Service

**One dedicated service** handles ALL market data connections:
- **API Servers (N instances)**: Handle HTTP requests, WebSocket client connections, publish control messages to Redis
- **Market Stream Service (1 instance)**: Subscribes to control messages, connects to brokers, distributes data via Redis

**Result**:
- Scale API servers to N instances without multiplying broker connections
- Single source of truth for market data state
- Clean separation of concerns

## Architecture

```
┌─────────────────────────────────────────────┐
│         API Server Instances (N)            │
│  ┌────────────┐  ┌────────────┐            │
│  │ Instance 1 │  │ Instance 2 │  ...       │
│  │            │  │            │            │
│  │ HTTP API   │  │ HTTP API   │            │
│  │ WebSocket  │  │ WebSocket  │            │
│  │ Mgr        │  │ Mgr        │            │
│  └────┬───────┘  └────┬───────┘            │
│       │ PUBLISH       │ PUBLISH             │
└───────┼───────────────┼─────────────────────┘
        │               │
        └───────┬───────┘
                ▼
     ┌──────────────────────┐
     │    Redis Pub/Sub     │
     │ md:control:subscribe │
     │ md:control:unsub     │
     └──────────┬───────────┘
                │ SUBSCRIBE
                ▼
  ┌─────────────────────────────────┐
  │ Market Stream Service (1 only)  │
  │                                 │
  │  MarketControlHandler           │
  │  MarketDataGateway              │
  │  MarketDataSubscriber           │
  │                                 │
  │  ┌────────────┐                 │
  │  │  Alpaca    │ ← WebSocket     │
  │  │  Binance   │ ← WebSocket     │
  │  │  Dhan      │ ← WebSocket     │
  │  │  Schwab    │ ← WebSocket     │
  │  └────────────┘                 │
  │         │                       │
  │         │ Normalize             │
  │         ▼                       │
  │  PUBLISH to:                    │
  │  - md:symbol:*                  │
  │  - ws:user:*                    │
  └─────────────────────────────────┘
           │
           ├─────────────────┐
           ▼                 ▼
    ┌───────────┐    ┌──────────────┐
    │ BullMQ    │    │ ws:user:*    │
    │ Workflow  │    │ (to clients) │
    │ Queue     │    └──────────────┘
    └───────────┘
```

## Communication Flow

### 1. User Subscribes to Market Data

```
Frontend → API Server → PUBLISH md:control:subscribe
                          ↓
                    Market Stream Service
                          ↓
                    MarketControlHandler
                          ↓
                    MarketDataGateway.connect()
                          ↓
                    Broker WebSocket (Alpaca, etc.)
```

### 2. Market Event Arrives

```
Broker WebSocket → MarketDataGateway
                          ↓
                    Normalize to CorezaMarketEvent
                          ↓
                    PUBLISH to md:symbol:AAPL
                          ↓
                    MarketDataSubscriber
                          ├─ Trigger Workflow (BullMQ)
                          └─ PUBLISH to ws:user:{userId}
                                    ↓
                    API Server WebSocketManager
                          ↓
                    Frontend WebSocket Client
```

## Deployment

### Docker Compose (Local/Staging)

```yaml
services:
  # API servers - can scale to N instances
  coreza-backend:
    image: coreza-backend:latest
    ports:
      - "8000:8000"
      - "8081:8081"
    environment:
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      # ... other env vars
    deploy:
      replicas: 3  # ✅ Can scale freely

  # Market Stream Service - MUST be exactly 1 instance
  market-stream-service:
    image: market-stream-service:latest
    ports:
      - "8090:8090"
    environment:
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      # ... other env vars
    deploy:
      replicas: 1  # ⚠️ CRITICAL: Must be 1
```

### Render.com (Production)

```yaml
services:
  # API server - can scale with plan
  - type: web
    name: coreza-backend
    plan: standard  # Can upgrade for more instances
    # ... config

  # Market Stream Service - single worker
  - type: worker
    name: market-stream-service
    plan: starter
    numInstances: 1  # ⚠️ CRITICAL: Must be 1
    # ... config
```

### Kubernetes (Future)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: market-stream-service
spec:
  replicas: 1  # ⚠️ CRITICAL: Must be 1
  selector:
    matchLabels:
      app: market-stream-service
  template:
    # ... pod spec
```

## Migration from Monolith

### Before (Monolith)

All in `coreza-backend/src/index.ts`:
```typescript
// ❌ OLD - Creates duplicate connections
const marketControlHandler = MarketControlHandler.getInstance();
await marketControlHandler.initialize();

const marketDataSubscriber = MarketDataSubscriber.getInstance();
await marketDataSubscriber.restoreFromRedis();
```

### After (Microservice)

**API Server** (`coreza-backend/src/index.ts`):
```typescript
// ✅ NEW - Only WebSocketManager
const wsPort = parseInt(process.env.WEBSOCKET_PORT || '8081', 10);
await WebSocketManager.initialize(wsPort);
```

**Market Stream Service** (`market-stream-service/src/index.ts`):
```typescript
// ✅ NEW - Single service handles all broker connections
const marketControlHandler = MarketControlHandler.getInstance();
await marketControlHandler.initialize();

const marketDataSubscriber = MarketDataSubscriber.getInstance();
await marketDataSubscriber.restoreFromRedis();
```

## Environment Variables

### API Server (coreza-backend)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | HTTP port (default: 8000) |
| `WEBSOCKET_PORT` | No | WebSocket port (default: 8081) |
| `REDIS_URL` | Yes | Redis connection URL |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable key (legacy `SUPABASE_ANON_KEY` also works in backend) |

### Market Stream Service

| Variable | Required | Description |
|----------|----------|-------------|
| `MARKET_STREAM_PORT` | No | HTTP port (default: 8090) |
| `REDIS_URL` | Yes | Redis connection URL |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Service role key |
| `COREZA_ENCRYPTION_KEY` | Yes | Encryption key |

## Monitoring & Health Checks

### API Server

- **Health**: `GET http://localhost:8000/health`
- **Metrics**: `GET http://localhost:8000/metrics`

### Market Stream Service

- **Health**: `GET http://localhost:8090/health`
  ```json
  {
    "status": "healthy",
    "service": "market-stream-service",
    "stats": {
      "gateways": {
        "alpaca": { "connected": true, "symbols": ["AAPL", "MSFT"] }
      },
      "subscriber": { "subscriptions": 5 }
    }
  }
  ```
- **Metrics**: `GET http://localhost:8090/metrics`

### Prometheus Metrics

```
# Market events processed
coreza_market_messages_total{source="alpaca",symbol="AAPL"} 1250

# Active gateway connections
coreza_active_gateway_connections{source="alpaca"} 1

# Workflow executions triggered
coreza_workflow_executions_total{trigger="market_event"} 45

# Redis circuit breaker state
coreza_redis_circuit_breaker_state{operation="publish"} 0  # 0=closed, 1=open
```

## Troubleshooting

### No Market Data Flowing

1. **Check market-stream-service health**:
   ```bash
   curl http://localhost:8090/health
   ```

2. **Check logs**:
   ```bash
   docker logs market-stream-service
   ```

3. **Verify gateway connections**:
   ```bash
   curl http://localhost:8090/health | jq '.stats.gateways'
   ```

4. **Check Redis connectivity**:
   ```bash
   redis-cli -u $REDIS_URL ping
   ```

### Duplicate Broker Connections

**Symptom**: Seeing multiple WebSocket connections to same broker

**Cause**: Multiple instances of market-stream-service running

**Fix**:
```bash
# Check running instances
docker ps | grep market-stream

# Should show exactly 1 container
# If more, scale down:
docker-compose up --scale market-stream-service=1
```

### Circuit Breaker Open

**Symptom**: `/health` shows circuit breaker open

**Cause**: Redis connection issues

**Fix**:
1. Check Redis status: `redis-cli -u $REDIS_URL ping`
2. Check buffered messages: `curl http://localhost:8090/health | jq '.stats.buffer'`
3. Messages will be flushed automatically when Redis recovers

## Production Readiness Checklist

- [ ] Deploy exactly 1 instance of market-stream-service
- [ ] Configure container restart policy: `restart: always`
- [ ] Set resource limits (memory: 512MB minimum)
- [ ] Configure health check endpoint monitoring
- [ ] Set up Prometheus scraping for metrics
- [ ] Configure alerts for circuit breaker events
- [ ] Test failover scenario (kill process, verify restart)
- [ ] Verify broker credentials are valid and refreshable
- [ ] Test scaling API servers to N instances (market service stays at 1)
- [ ] Monitor Redis connection pool utilization

## Security Considerations

1. **Credential Storage**: All broker credentials encrypted in Supabase with envelope encryption
2. **OAuth Token Refresh**: Automatic for brokers like Schwab
3. **JWT Verification**: WebSocket connections verified via Supabase JWKS
4. **Redis Authentication**: Use `REDIS_URL` with password in production
5. **Internal Communication**: All via Redis Pub/Sub, no direct service-to-service HTTP

## Future Enhancements

- [ ] High Availability: Leader election for multi-instance failover
- [ ] Message persistence: Redis Streams for replay on service restart
- [ ] Rate limiting: Per-symbol throttling for high-frequency data
- [ ] Dead letter queue: Failed workflow triggers
- [ ] Geo-distribution: Regional market-stream-service instances
