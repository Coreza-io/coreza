import client from "prom-client";

// Counters
export const marketMessagesCounter = new client.Counter({
  name: "coreza_market_messages_total",
  help: "Total number of market data messages processed",
  labelNames: ["source", "stream"],
});

export const workflowExecutionsCounter = new client.Counter({
  name: "coreza_workflow_executions_total",
  help: "Total number of workflow executions",
  labelNames: ["status", "trigger"],
});

export const httpRequestsCounter = new client.Counter({
  name: "coreza_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"],
});

export const redisOperationsCounter = new client.Counter({
  name: "coreza_redis_operations_total",
  help: "Total number of Redis operations",
  labelNames: ["operation", "status"],
});

export const websocketConnectionsCounter = new client.Counter({
  name: "coreza_websocket_connections_total",
  help: "Total number of WebSocket connections",
  labelNames: ["action"],
});

// Gauges
export const activeGatewayConnectionsGauge = new client.Gauge({
  name: "coreza_active_gateway_connections",
  help: "Currently active gateway connections",
  labelNames: ["source"],
});

export const subscribedSymbolsGauge = new client.Gauge({
  name: "coreza_subscribed_symbols",
  help: "Currently subscribed symbols per source",
  labelNames: ["source"],
});

export const activeWorkflowsGauge = new client.Gauge({
  name: "coreza_active_workflows",
  help: "Active workflow subscriptions",
});

export const redisBufferSizeGauge = new client.Gauge({
  name: "coreza_redis_buffer_size",
  help: "Current Redis buffer size",
});

export const workflowCacheSizeGauge = new client.Gauge({
  name: "coreza_workflow_cache_size",
  help: "Current workflow cache size",
});

// Histograms
export const httpRequestDurationHistogram = new client.Histogram({
  name: "coreza_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
});

export const marketMessageLatencyHistogram = new client.Histogram({
  name: "coreza_market_message_latency_seconds",
  help: "Time from broker to Redis publish in seconds",
  labelNames: ["source"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

export const workflowExecutionDurationHistogram = new client.Histogram({
  name: "coreza_workflow_execution_duration_seconds",
  help: "Workflow execution duration in seconds",
  labelNames: ["workflow_id", "status"],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
});

export const register = client.register;
