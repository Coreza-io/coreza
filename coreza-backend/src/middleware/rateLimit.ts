/*
 * Copyright (C) 2024 Coreza
 * Redis-backed rate limiting middleware with tier-aware limits
 */

import rateLimit, { Options } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response } from 'express';
import { getRedisCache } from '../config/redis';
import { ENDPOINT_LIMITS, TIER_MULTIPLIERS, EndpointCategory } from '../config/rateLimits';
import logger from '../utils/logger';

// Extended request type with user info from JWT
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    tier?: string;
  };
}

// Get tier multiplier for a user
function getTierMultiplier(tier?: string): number {
  return TIER_MULTIPLIERS[tier || 'free'] || 1;
}

// Key generator - uses user ID for authenticated requests, IP for others
function keyGenerator(req: AuthenticatedRequest): string {
  const userId = req.user?.id;
  if (userId) {
    return `user:${userId}`;
  }
  // Fallback to IP for unauthenticated requests
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' 
    ? forwarded.split(',')[0].trim() 
    : req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

// Create a rate limiter for a specific endpoint category
function createLimiter(category: EndpointCategory, skipFailedRequests = false): ReturnType<typeof rateLimit> {
  const config = ENDPOINT_LIMITS[category];
  
  const options: Partial<Options> = {
    windowMs: config.windowMs,
    max: (req: AuthenticatedRequest) => {
      const multiplier = getTierMultiplier(req.user?.tier);
      return config.max * multiplier;
    },
    keyGenerator,
    skipFailedRequests,
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    handler: (req: AuthenticatedRequest, res: Response) => {
      const key = keyGenerator(req);
      logger.warn({
        category,
        key,
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        tier: req.user?.tier,
      }, 'Rate limit exceeded');
      
      res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded for ${category} operations. Please try again later.`,
        retryAfter: Math.ceil(config.windowMs / 1000),
      });
    },
    skip: (req: Request) => {
      // Skip rate limiting for health checks and metrics
      return req.path === '/health' || req.path === '/metrics';
    },
  };

  // Try to use Redis store, fall back to memory if unavailable
  try {
    const redisClient = getRedisCache();
    options.store = new RedisStore({
      sendCommand: (...args: string[]) => redisClient.call(...args) as Promise<any>,
      prefix: `rl:${category}:`,
    });
    logger.debug({ category }, 'Rate limiter using Redis store');
  } catch (error) {
    logger.warn({ category, error }, 'Redis unavailable, using in-memory rate limiting');
  }

  return rateLimit(options as Options);
}

// Pre-configured rate limiters for different endpoint categories
export const authLimiter = createLimiter('auth');
export const apiLimiter = createLimiter('api');
export const tradingLimiter = createLimiter('trading');
export const marketLimiter = createLimiter('market');
export const workflowLimiter = createLimiter('workflow');
export const screenerLimiter = createLimiter('screener');
export const aiLimiter = createLimiter('ai');
export const webhookLimiter = createLimiter('webhook', true); // Skip failed requests for webhooks
export const credentialsLimiter = createLimiter('credentials');

// Export the factory for custom limiters
export { createLimiter };
