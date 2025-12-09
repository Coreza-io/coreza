/*
 * Copyright (C) 2024 Coreza
 * Redis-backed rate limiting middleware with tier-aware limits
 */

import rateLimit, { Options, ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response } from 'express';
import { getRedisCache } from '../config/redis';
import { ENDPOINT_LIMITS, TIER_MULTIPLIERS, EndpointCategory, RATE_LIMIT_WHITELIST, SERVICE_SECRET } from '../config/rateLimits';
import { isIpWhitelisted, getClientIp } from '../utils/ipUtils';
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
function keyGenerator(req: AuthenticatedRequest, res: Response): string {
  const userId = req.user?.id;
  if (userId) {
    return `user:${userId}`;
  }
  // Use the built-in ipKeyGenerator helper for proper IPv6 handling
  return `ip:${ipKeyGenerator(req, res)}`;
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
      // 1. Check whitelisted paths
      if (RATE_LIMIT_WHITELIST.paths.some(p => req.path === p || req.path.startsWith(p))) {
        return true;
      }
      
      // 2. Check IP whitelist (exact match + CIDR ranges)
      const clientIp = getClientIp(req);
      if (isIpWhitelisted(clientIp, RATE_LIMIT_WHITELIST)) {
        logger.debug({ ip: clientIp, path: req.path }, 'Rate limit bypassed: whitelisted IP');
        return true;
      }
      
      // 3. Check trusted service header (with secret verification)
      const serviceName = req.headers['x-service-name'];
      const serviceSecret = req.headers['x-service-secret'];
      if (
        serviceName && 
        SERVICE_SECRET && 
        serviceSecret === SERVICE_SECRET &&
        RATE_LIMIT_WHITELIST.services.includes(serviceName as string)
      ) {
        logger.debug({ service: serviceName, path: req.path }, 'Rate limit bypassed: trusted service');
        return true;
      }
      
      // 4. Check environment variable for additional IPs
      const envWhitelist = process.env.RATE_LIMIT_WHITELIST_IPS;
      if (envWhitelist) {
        const additionalIps = envWhitelist.split(',').map(ip => ip.trim());
        if (additionalIps.includes(clientIp)) {
          logger.debug({ ip: clientIp, path: req.path }, 'Rate limit bypassed: env whitelist');
          return true;
        }
      }
      
      return false;
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
