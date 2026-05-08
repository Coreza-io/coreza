import express from 'express';
import { register } from 'prom-client';
import logger from './utils/logger';
import { MarketControlHandler } from './services/MarketControlHandler';
import { MarketDataSubscriber } from './services/MarketDataSubscriber';
import { RedisPubSubSubscriber } from './services/RedisPubSubSubscriber';
import WorkflowCache from './services/WorkflowCache';
import { RedisBuffer } from './services/RedisBuffer';
import { getRedisQueue } from './config/redis';
import { redisPublishBreaker } from './utils/redisCircuitBreaker';
import { runStartupValidation } from './utils/startupValidation';
import { GATEWAY_CONFIGS } from './marketGateways';

// Lazy-initialized singleton instances (initialized after env validation)
let workflowCacheInstance: ReturnType<typeof WorkflowCache.getInstance> | null = null;

const PORT = process.env.MARKET_STREAM_PORT || 8090;

async function startMarketStreamService() {
  const app = express();

  logger.info('🚀 Starting Market Stream Service...');

  try {
    // Run startup validation (Redis, Supabase, env vars)
    await runStartupValidation();


    for (const [gatewayName, gatewayConfig] of Object.entries(GATEWAY_CONFIGS)) {
      if (gatewayConfig.onServiceStart) {
        logger.info({ gateway: gatewayName }, 'Running gateway startup hook');
        await gatewayConfig.onServiceStart();
      }
    }

    // Initialize WorkflowCache (now safe - env vars are loaded)
    logger.info('Initializing WorkflowCache...');
    workflowCacheInstance = WorkflowCache.getInstance();
    workflowCacheInstance.startCleanupTimer();

    // Initialize Redis buffer flush on circuit breaker recovery
    logger.info('Setting up Redis buffer flush on circuit breaker recovery...');
    redisPublishBreaker.on('close', async () => {
      logger.info('Redis circuit breaker closed (recovered), flushing buffer...');
      try {
        const redis = getRedisQueue();
        const flushed = await RedisBuffer.getInstance().flushToRedis(redis);
        logger.info({ flushed }, 'Successfully flushed buffered messages to Redis');
      } catch (error) {
        logger.error({ err: error }, 'Failed to flush Redis buffer on recovery');
      }
    });

    // Initialize MarketControlHandler (listens to md:control:* and manages gateways)
    logger.info('Initializing MarketControlHandler...');
    const marketControlHandler = MarketControlHandler.getInstance();
    await marketControlHandler.initialize();
    logger.info('✅ MarketControlHandler initialized');

    // Initialize MarketDataSubscriber (listens to md:symbol:* and triggers workflows)
    logger.info('Initializing MarketDataSubscriber...');
    const marketDataSubscriber = MarketDataSubscriber.getInstance();
    await marketDataSubscriber.restoreFromRedis();
    logger.info('✅ MarketDataSubscriber initialized and subscriptions restored');

    // Initialize RedisPubSubSubscriber (listens to Redis channels for inter-workflow messaging)
    logger.info('Initializing RedisPubSubSubscriber...');
    const redisPubSubSubscriber = RedisPubSubSubscriber.getInstance();
    await redisPubSubSubscriber.initialize();
    logger.info('✅ RedisPubSubSubscriber initialized');

    // Health check endpoint
    app.get('/health', (req, res) => {
      const controlStats = marketControlHandler.getStats();
      const subscriberStats = marketDataSubscriber.getStats();
      const redisPubSubStats = redisPubSubSubscriber.getStats();
      const cacheStats = workflowCacheInstance?.getStats() || { size: 0, entries: [] };
      const bufferStats = RedisBuffer.getInstance().getStats();

      res.json({
        status: 'healthy',
        service: 'market-stream-service',
        timestamp: new Date().toISOString(),
        stats: {
          gateways: controlStats,
          subscriber: subscriberStats,
          redisPubSub: redisPubSubStats,
          cache: cacheStats,
          buffer: bufferStats,
          circuitBreaker: {
            stats: redisPublishBreaker.stats,
          },
        },
      });
    });

    // Prometheus metrics endpoint
    app.get('/metrics', async (req, res) => {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    });

    // Start HTTP server
    const server = app.listen(PORT, () => {
      logger.info({ port: PORT }, '✅ Market Stream Service HTTP server listening');
    });

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down Market Stream Service...');
      
      server.close(() => {
        logger.info('HTTP server closed');
      });

      try {
        await marketControlHandler.cleanup();
        logger.info('MarketControlHandler cleaned up');
      } catch (error) {
        logger.error({ err: error }, 'Error cleaning up MarketControlHandler');
      }

      try {
        await marketDataSubscriber.cleanup();
        logger.info('MarketDataSubscriber cleaned up');
      } catch (error) {
        logger.error({ err: error }, 'Error cleaning up MarketDataSubscriber');
      }

      try {
        await redisPubSubSubscriber.shutdown();
        logger.info('RedisPubSubSubscriber shut down');
      } catch (error) {
        logger.error({ err: error }, 'Error shutting down RedisPubSubSubscriber');
      }

      workflowCacheInstance?.stopCleanupTimer();
      logger.info('WorkflowCache cleanup timer stopped');

      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.fatal({ err: error, stack: error instanceof Error ? error.stack : undefined }, 'Failed to start Market Stream Service');
    console.error('Fatal error during Market Stream Service startup:', error);
    process.exit(1);
  }
}

// Set TZ to UTC to ensure consistent date handling
process.env.TZ = 'UTC';

startMarketStreamService();
