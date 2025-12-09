/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import client from 'prom-client';

// Counters
export const marketMessagesCounter = new client.Counter({
  name: 'coreza_market_messages_total',
  help: 'Total number of market data messages processed',
  labelNames: ['source', 'symbol', 'type']
});

export const workflowExecutionsCounter = new client.Counter({
  name: 'coreza_workflow_executions_total',
  help: 'Total number of workflow executions',
  labelNames: ['status', 'trigger']
});

export const httpRequestsCounter = new client.Counter({
  name: 'coreza_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

export const redisOperationsCounter = new client.Counter({
  name: 'coreza_redis_operations_total',
  help: 'Total number of Redis operations',
  labelNames: ['operation', 'status']
});

export const websocketConnectionsCounter = new client.Counter({
  name: 'coreza_websocket_connections_total',
  help: 'Total number of WebSocket connections',
  labelNames: ['action']
});

// Gauges
export const activeGatewayConnectionsGauge = new client.Gauge({
  name: 'coreza_active_gateway_connections',
  help: 'Currently active gateway connections',
  labelNames: ['source']
});

export const subscribedSymbolsGauge = new client.Gauge({
  name: 'coreza_subscribed_symbols',
  help: 'Currently subscribed symbols per source',
  labelNames: ['source']
});

export const activeWorkflowsGauge = new client.Gauge({
  name: 'coreza_active_workflows',
  help: 'Active workflow subscriptions'
});

export const redisBufferSizeGauge = new client.Gauge({
  name: 'coreza_redis_buffer_size',
  help: 'Current Redis buffer size'
});

export const workflowCacheSizeGauge = new client.Gauge({
  name: 'coreza_workflow_cache_size',
  help: 'Current workflow cache size'
});

// Histograms
export const httpRequestDurationHistogram = new client.Histogram({
  name: 'coreza_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

export const marketMessageLatencyHistogram = new client.Histogram({
  name: 'coreza_market_message_latency_seconds',
  help: 'Time from broker to Redis publish in seconds',
  labelNames: ['source'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});

export const workflowExecutionDurationHistogram = new client.Histogram({
  name: 'coreza_workflow_execution_duration_seconds',
  help: 'Workflow execution duration in seconds',
  labelNames: ['workflow_id', 'status'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60]
});

// Rate Limiting Metrics
export const rateLimitHitsCounter = new client.Counter({
  name: 'coreza_rate_limit_hits_total',
  help: 'Total number of rate limit violations (429 responses)',
  labelNames: ['category', 'tier', 'key_type']
});

export const rateLimitBypassCounter = new client.Counter({
  name: 'coreza_rate_limit_bypass_total',
  help: 'Total number of rate limit bypasses',
  labelNames: ['category', 'reason']
});

export const register = client.register;
