/*
 * Copyright (C) 2024 Coreza
 * Rate limiting configuration by endpoint category
 */

// Whitelist configuration for rate limit bypass
export const RATE_LIMIT_WHITELIST = {
  // Whitelisted IP addresses (exact match)
  ips: [
    '127.0.0.1',        // Localhost IPv4
    '::1',              // Localhost IPv6
    '::ffff:127.0.0.1', // IPv4-mapped IPv6 localhost
  ],
  
  // CIDR ranges for internal networks
  cidrRanges: [
    '10.0.0.0/8',       // Private Class A
    '172.16.0.0/12',    // Private Class B
    '192.168.0.0/16',   // Private Class C
    'fc00::/7',         // IPv6 Unique Local Addresses
  ],
  
  // Trusted service names (via X-Service-Name header + shared secret)
  services: [
    'market-stream-service',
    'scheduler-service',
    'webhook-processor',
  ],
  
  // Paths that should always be whitelisted
  paths: [
    '/health',
    '/metrics',
    '/internal/',
  ],
};

// Shared secret for service-to-service authentication
export const SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

// Rate limit configurations by endpoint category
export const ENDPOINT_LIMITS = {
  // Auth endpoints (login, signup, OAuth) - strictest limits
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per 15 min
  },
  
  // General API endpoints
  api: {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
  },
  
  // Trading operations (orders, positions) - high frequency
  trading: {
    windowMs: 1000, // 1 second
    max: 50, // 50 requests per second
  },
  
  // Market data operations
  market: {
    windowMs: 60 * 1000, // 1 minute
    max: 200, // 200 requests per minute
  },
  
  // Workflow executions
  workflow: {
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 executions per minute
  },
  
  // Screener/scanner operations
  screener: {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
  },
  
  // AI/LLM operations (expensive)
  ai: {
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 requests per minute
  },
  
  // Incoming webhooks (external services)
  webhook: {
    windowMs: 60 * 1000, // 1 minute
    max: 500, // 500 requests per minute
  },
  
  // Credential operations
  credentials: {
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
  },
};

export type EndpointCategory = keyof typeof ENDPOINT_LIMITS;
