# coreza-backend

## Queue Configuration

The backend uses BullMQ with Redis for distributed workflow job processing. Redis is **required** for all environments (development and production).

### Requirements
- **Redis server**: Running locally or accessible via `REDIS_URL`
- **Environment variables**:
  - `REDIS_URL`: Connection string for Redis (e.g., `redis://localhost:6379`)
  - `REDIS_TLS`: Set to `true` for TLS connections (e.g., Upstash, AWS ElastiCache)
  - `REDIS_TLS_REJECT_UNAUTHORIZED`: Set to `false` to allow self-signed certificates

### Local Development

Run Redis using Docker:
```bash
docker-compose up -d redis
```

Or install Redis locally:
- **macOS**: `brew install redis && brew services start redis`
- **Linux**: `sudo apt install redis-server && sudo systemctl start redis`

Set environment variable:
```
REDIS_URL=redis://localhost:6379
```

### Production

Point to your production Redis instance (Upstash, AWS ElastiCache, etc.):
```
REDIS_URL=rediss://username:password@host:port
REDIS_TLS=true
```

Workers are automatically started on server initialization and handle:
- Manual workflow executions
- Scheduled workflow executions (cron-based)
- Job retries and failure handling

## Architecture

### In-memory runtime state

`ENABLE_CONSOLIDATOR_SCAN=true` enables clock-driven emission of completed consolidator bars. Indicator state, rolling windows, and consolidator working bars are process-local and do not survive a backend restart; operators must warm up workflows again before resuming live execution.

### Scan-driven side-effect guarantees

Scan delivery receipts use renewable, owner-checked Redis leases. Effect guarantees below apply to retries of the same emission; they do not turn an external provider without idempotency or reconciliation support into an exactly-once system.

| Effect | Classification | Delivery guarantee |
| --- | --- | --- |
| Store and RedisStore reads | Pure | Exactly-once result semantics (no mutation) |
| Store and RedisStore mutations | Guarded by parameter-specific effect receipt | At-most-once after an unknown outcome; cached replay after success |
| Gmail, Telegram, WhatsApp and other communication sends | Guarded by parameter-specific effect receipt | At-most-once after an unknown outcome; cached replay after success |
| Alpaca order placement | Client-order-id reconciled | Effectively exactly-once while provider lookup is available |
| Binance standard order placement | Client-order-id reconciled | Effectively exactly-once while provider lookup is available |
| Binance futures algo order placement | Algo-client-id reconciled, scan gate retained | Unsupported for live scan execution pending production qualification |
| Broker close-position operations | Position-based only, scan gated | Unsupported for live scan execution |
| Unknown broker mutations | No reconciliation capability | Unsupported for live scan execution |
| HTTP/Webhook utility nodes | Payload processing only; no outbound mutation in the current executor | Pure |
| Indicators, conditions, transforms, consolidators, and market-data reads | No external mutation | Pure or naturally idempotent |

An external timeout, reset connection, abort, or body-less 5xx is persisted as an unknown effect outcome. Automatic replay is blocked with `EFFECT_OUTCOME_UNKNOWN` unless the provider supplies a reconciliation callback. Explicit provider rejections are released for a safe retry. Legitimate identical effects in a loop use their invocation index as part of the effect key.

### Two-Layer Queue System

The backend uses a two-layer node processing model:

1. **Layer 1 (BullMQ/Job Queue)**: Distributes entire workflow executions as jobs across multiple workers
2. **Layer 2 (NodeQueueManager/In-Memory)**: Executes individual nodes sequentially within a single worker process

Nodes are NOT individually queued in BullMQ—only complete workflows are queued as jobs. When a BullMQ worker picks up a workflow job and calls `executeWorkflow()`, it uses `NodeQueueManager` internally to process nodes in order: Node1 → Node2 → Node3 → complete.

This design allows horizontal scaling of workflows while ensuring reliable in-order node execution without cross-process complexity.
