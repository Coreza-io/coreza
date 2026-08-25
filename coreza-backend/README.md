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

### Two-Layer Queue System

The backend uses a two-layer node processing model:

1. **Layer 1 (BullMQ/Job Queue)**: Distributes entire workflow executions as jobs across multiple workers
2. **Layer 2 (NodeQueueManager/In-Memory)**: Executes individual nodes sequentially within a single worker process

Nodes are NOT individually queued in BullMQ—only complete workflows are queued as jobs. When a BullMQ worker picks up a workflow job and calls `executeWorkflow()`, it uses `NodeQueueManager` internally to process nodes in order: Node1 → Node2 → Node3 → complete.

This design allows horizontal scaling of workflows while ensuring reliable in-order node execution without cross-process complexity.
