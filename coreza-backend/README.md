# coreza-backend

## Queue configuration

The backend now supports two workflow job queue modes controlled by environment variables:

- **In-memory queue (default):** set `USE_BULLMQ_QUEUE=false` to execute workflow jobs immediately without Redis. No external dependencies are required.
- **BullMQ + Redis:** set `USE_BULLMQ_QUEUE=true` and provide `REDIS_URL` to enqueue workflow runs in Redis-backed BullMQ queues for distributed processing.

Workers are only started when BullMQ mode is enabled, while node-level execution continues to use the in-memory node queue internally.
