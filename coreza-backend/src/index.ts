/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0 only.
 *
 * See the LICENSE file for details.
 */

// Force UTC timezone for all date operations in Node.js
process.env.TZ = "UTC";

import dotenv from "dotenv";

// Load environment variables FIRST before any other imports
dotenv.config();

import express from "express";
import cors from "cors";
import helmet from "helmet";
import { supabase } from "./config/supabase";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { metricsMiddleware } from "./middleware/metricsMiddleware";
import client from "prom-client";
import { register } from "./utils/metrics";
import logger from "./utils/logger";

// Import routes
import indicatorRoutes from "./routes/indicators";
import streamRoutes from "./routes/stream";
import oauthRoutes from "./routes/oauth";
import webhookRoutes from "./routes/webhook";
import communicationRoutes from "./routes/communication";
import workflowRoutes from "./routes/workflow";
import httpRoutes from "./routes/http";
import schedulerRoutes from "./routes/scheduler";
import comparatorRoutes from "./routes/comparator";
import riskRoutes from "./routes/risk";
import aiAgentRoutes from "./routes/aiagent";
import credentialsRoutes from "./routes/credentials";
import googleSearchRoutes from "./routes/googlesearch";
import screenerRoutes from "./routes/screener";
import brokerRoutes from "./routes/broker";
import storageRoutes from "./routes/storage";
import backtestRoutes from "./routes/backtest";
import datasourceRoutes from "./routes/datasource";
import portfolioRoutes from "./routes/portfolio";
import documentRoutes from "./routes/documents";

import WebSocketManager from "./infra/websocketManager";
import { initializeNodeExecutors } from "./nodes";
import { initializeScreenerServices } from "./services/screeners";
import { initializeDataSourceServices } from "./services/datasources";
import { initializeStorageServices } from "./services/storage";
import { initializeCommunicationServices } from "./services/communication";
import WorkflowCache from "./infra/WorkflowCache";
import {
  redisPublishBreaker,
  redisGetBreaker,
  redisSetBreaker,
} from "./utils/redisCircuitBreaker";
import { RedisBuffer } from "./infra/RedisBuffer";
import { setupBufferFlush } from "./utils/flushRedisBuffer";
import RunSyncService from "./workers/RunSyncService";
import streamingCleanupService from "./workers/StreamingCleanupService";
import { workflowRecoveryService } from "./workers/WorkflowRecoveryService";
import FillSyncWorker from "./workers/FillSyncWorker";

const app = express();
const PORT = process.env.PORT || 8000;

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ prefix: "coreza_" });

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use(metricsMiddleware);

// Store supabase instance in app.locals for route access
app.locals.supabase = supabase;

// Health check with circuit breaker and cache stats
app.get("/health", async (req, res) => {
  const runSyncStats = await RunSyncService.getStats();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    redis: {
      circuitBreaker: {
        publish: redisPublishBreaker.opened
          ? "OPEN"
          : redisPublishBreaker.halfOpen
          ? "HALF-OPEN"
          : "CLOSED",
        get: redisGetBreaker.opened
          ? "OPEN"
          : redisGetBreaker.halfOpen
          ? "HALF-OPEN"
          : "CLOSED",
        set: redisSetBreaker.opened
          ? "OPEN"
          : redisSetBreaker.halfOpen
          ? "HALF-OPEN"
          : "CLOSED",
      },
      buffer: RedisBuffer.getInstance().getStats(),
      pendingRunSync: runSyncStats.pendingCount,
    },
    workflowCache: WorkflowCache.getStats(),
  });
});

// Prometheus metrics endpoint
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error);
  }
});

// Routes
logger.info("Setting up routes...");

app.use("/oauth", oauthRoutes);
app.use("/broker", brokerRoutes);
app.use("/aiagent", aiAgentRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/stream", streamRoutes);
app.use("/workflows", workflowRoutes);
app.use("/execute", schedulerRoutes);
app.use("/screener", screenerRoutes);
app.use("/indicators", indicatorRoutes);
app.use("/communication", communicationRoutes);
app.use("/http", httpRoutes);
app.use("/comparator", comparatorRoutes);
app.use("/risk", riskRoutes);
app.use("/googlesearch", googleSearchRoutes);
app.use("/credentials", credentialsRoutes);
app.use("/storage", storageRoutes);
app.use("/backtest", backtestRoutes);
app.use("/datasource", datasourceRoutes);
app.use("/portfolio", portfolioRoutes);
app.use("/documents", documentRoutes);

logger.info("All routes mounted");

// Error handling
app.use(errorHandler);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

async function startServer() {
  try {
    // Test Supabase connection
    const { data, error } = await supabase
      .from("users")
      .select("count")
      .limit(1);
    if (error) {
      logger.warn({ error: error.message }, "Supabase connection warning");
    } else {
      logger.info("Supabase connected successfully");
    }

    // Initialize all services
    initializeStorageServices();
    initializeDataSourceServices();
    initializeScreenerServices();
    initializeCommunicationServices();
    initializeNodeExecutors();

    // Initialize Binance time sync
    logger.info("Initializing Binance time sync...");
    const { initBinanceTimeSync } = await import("./utils/binanceTimeSync");
    await initBinanceTimeSync();
    logger.info("Binance time sync initialized");

    // Run workflow recovery before starting workers
    logger.info("🔄 Running workflow recovery...");
    const recoveryStats = await workflowRecoveryService.recoverStaleRuns();
    logger.info({ stats: recoveryStats }, "Workflow recovery complete");

    // Clean up orphaned Redis data from interrupted loops
    const orphanedKeysCleanedUp =
      await workflowRecoveryService.cleanupOrphanedLoopData();
    if (orphanedKeysCleanedUp > 0) {
      logger.info(
        { keysCleanedUp: orphanedKeysCleanedUp },
        "Orphaned loop data cleanup complete"
      );
    }

    // Initialize BullMQ job queue workers
    logger.info("Starting BullMQ workers...");
    require("./infra/jobQueue/jobQueueManager");

    logger.info("Starting WorkflowCache periodic cleanup...");
    WorkflowCache.startCleanupTimer();
    logger.debug("WorkflowCache cleanup timer started");

    // Setup Redis buffer flush on circuit breaker close (Phase 3)
    logger.debug("Setting up Redis buffer flush...");
    setupBufferFlush();
    logger.debug("Redis buffer flush setup complete");

    // Start RunSyncService for periodic workflow_runs sync (Redis → Supabase)
    logger.info("Starting RunSyncService...");
    RunSyncService.start();
    logger.info("RunSyncService started (syncing every 10s)");

    // Start StreamingCleanupService for stale subscription cleanup
    logger.info("Starting StreamingCleanupService...");
    streamingCleanupService.start();
    logger.info("StreamingCleanupService started (cleanup every 5min)");

    // Start FillSyncWorker for async fill persistence (Redis Streams → Supabase)
    logger.info("Starting FillSyncWorker...");
    FillSyncWorker.start();
    logger.info("FillSyncWorker started");

    // Initialize WebSocket server
    const wsPort = parseInt(process.env.WEBSOCKET_PORT || "8081", 10);
    await WebSocketManager.initialize(wsPort);

    const server = app.listen(PORT, () => {
      logger.info(
        { port: PORT, environment: process.env.NODE_ENV || "development" },
        "Coreza Node.js Backend started"
      );
    });

    // Graceful shutdown handler
    const shutdown = async (signal: string) => {
      logger.info({ signal }, "Shutting down gracefully...");

      // Close HTTP server
      server.close(() => {
        logger.info("HTTP server closed");
      });

      // Stop WorkflowCache cleanup timer
      WorkflowCache.stopCleanupTimer();

      // Stop StreamingCleanupService
      streamingCleanupService.stop();

      // Stop RunSyncService and flush remaining runs
      RunSyncService.stop();
      await RunSyncService.flushAll();

      // Stop FillSyncWorker and flush remaining fills/snapshots
      FillSyncWorker.stop();
      await FillSyncWorker.flushAll();

      // Close WebSocket server
      await WebSocketManager.shutdown();

      // Exit process
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logger.fatal(
      { err: error, stack: error instanceof Error ? error.stack : undefined },
      "Failed to start server"
    );
    console.error("STARTUP ERROR:", error);
    process.exit(1);
  }
}

startServer();
