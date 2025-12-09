/*
 * Copyright (C) 2024 Coreza
 * Rate limiting configuration by endpoint category and subscription tier
 */

// Tier multipliers for rate limits
export const TIER_MULTIPLIERS: Record<string, number> = {
  free: 1,
  trader: 2,
  professional: 5,
  enterprise: 10,
};

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
