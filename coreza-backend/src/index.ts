// Force UTC timezone for all date operations in Node.js
process.env.TZ = 'UTC';

import dotenv from 'dotenv';

// Load environment variables FIRST before any other imports
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { supabase } from './config/supabase';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { metricsMiddleware } from './middleware/metricsMiddleware';
import { workflowScheduler } from './services/scheduler';
import client from 'prom-client';
import { register } from './utils/metrics';
import logger from './utils/logger';

// Import routes
import indicatorRoutes from './routes/indicators';
import marketRoutes from './routes/market';
import credentialsRoutes from './routes/credentials';
import gmailRoutes from './routes/gmail';
import oauthRoutes from './routes/oauth';
import finnhubRoutes from './routes/finnhub';
import whatsappRoutes from './routes/whatsapp';
import webhookRoutes from './routes/webhooks';
import workflowRoutes from './routes/workflow';
import yahoofinanceRoutes from './routes/yahoofinance';
import httpRoutes from './routes/http';
import schedulerRoutes from './routes/scheduler';
import comparatorRoutes from './routes/comparator';
import riskRoutes from './routes/risk';
import controlRoutes from './routes/control';
import websocketRoutes from './routes/websocket';
import openaiRoutes from './routes/openai';
import aiAgentRoutes from './routes/aiagent';
import googleSearchRoutes from './routes/googlesearch';
import screenerRoutes from './routes/screener';
import brokerRoutes from './routes/broker';
import redisRoutes from './routes/redis';

import WebSocketManager from './services/websocketManager';
import { initializeNodeExecutors } from './nodes';
import { initializeScreenerServices } from './services/screeners';
import WorkflowCache from './services/WorkflowCache';
import { redisPublishBreaker, redisGetBreaker, redisSetBreaker } from './utils/redisCircuitBreaker';
import { RedisBuffer } from './services/RedisBuffer';
import { setupBufferFlush } from './utils/flushRedisBuffer';


const app = express();
const PORT = process.env.PORT || 8000;

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ prefix: 'coreza_' });

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(metricsMiddleware);

// Store supabase instance in app.locals for route access
app.locals.supabase = supabase;

// Health check with circuit breaker and cache stats
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    redis: {
      circuitBreaker: {
        publish: redisPublishBreaker.opened ? 'OPEN' : redisPublishBreaker.halfOpen ? 'HALF-OPEN' : 'CLOSED',
        get: redisGetBreaker.opened ? 'OPEN' : redisGetBreaker.halfOpen ? 'HALF-OPEN' : 'CLOSED',
        set: redisSetBreaker.opened ? 'OPEN' : redisSetBreaker.halfOpen ? 'HALF-OPEN' : 'CLOSED',
      },
      buffer: RedisBuffer.getInstance().getStats(),
    },
    workflowCache: WorkflowCache.getStats(),
  });
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error);
  }
});

// Routes
logger.info('Setting up routes...');
app.use('/indicators', indicatorRoutes);
app.use('/market', marketRoutes);
app.use('/credentials', credentialsRoutes);
app.use('/gmail', gmailRoutes);
app.use('/oauth', oauthRoutes);
app.use('/finnhub', finnhubRoutes);
app.use('/whatsapp', whatsappRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/workflows', workflowRoutes);
app.use('/yahoofinance', yahoofinanceRoutes);
app.use('/http', httpRoutes);
app.use('/execute', schedulerRoutes);
app.use('/comparator', comparatorRoutes);
app.use('/control', controlRoutes);
app.use('/risk', riskRoutes);
app.use('/websocket', websocketRoutes);
app.use('/openai', openaiRoutes);
app.use('/aiagent', aiAgentRoutes);
app.use('/googlesearch', googleSearchRoutes);
app.use('/screener', screenerRoutes);
app.use('/broker', brokerRoutes);
app.use('/redis', redisRoutes);
logger.info('All routes mounted successfully');

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

async function startServer() {
  try {
    // Test Supabase connection
    const { data, error } = await supabase.from('users').select('count').limit(1);
    if (error) {
      logger.warn({ error: error.message }, 'Supabase connection warning');
    } else {
      logger.info('Supabase connected successfully');
    }

    // Initialize node executors and screener services
    initializeScreenerServices();
    initializeNodeExecutors();

    // Initialize BullMQ job queue workers
    logger.info('Starting BullMQ workers...');
    require('./services/jobQueueManager');

    // Initialize workflow scheduler
    await workflowScheduler.initialize();

    // Start WorkflowCache cleanup timer (Phase 3)
    logger.info('Starting WorkflowCache periodic cleanup...');
    WorkflowCache.startCleanupTimer();
    logger.debug('WorkflowCache cleanup timer started');

    // Setup Redis buffer flush on circuit breaker close (Phase 3)
    logger.debug('Setting up Redis buffer flush...');
    setupBufferFlush();
    logger.debug('Redis buffer flush setup complete');

    // Initialize WebSocket server
    const wsPort = parseInt(process.env.WEBSOCKET_PORT || '8081', 10);
    await WebSocketManager.initialize(wsPort);

    const server = app.listen(PORT, () => {
      logger.info({ port: PORT, environment: process.env.NODE_ENV || 'development' }, 'Coreza Node.js Backend started');
    });

    // Graceful shutdown handler
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down gracefully...');
      
      // Close HTTP server
      server.close(() => {
        logger.info('HTTP server closed');
      });
      
      // Stop WorkflowCache cleanup timer
      WorkflowCache.stopCleanupTimer();
      
      // Close WebSocket server
      await WebSocketManager.shutdown();
      
      // Exit process
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
  } catch (error) {
    logger.fatal({ err: error, stack: error instanceof Error ? error.stack : undefined }, 'Failed to start server');
    console.error('STARTUP ERROR:', error);
    process.exit(1);
  }
}

startServer();