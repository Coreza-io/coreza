/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import axios from 'axios';
import logger from './logger';

interface AlertPayload {
  level: 'warning' | 'critical';
  service: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
}

export async function sendAlert(payload: AlertPayload): Promise<void> {
  // Log using structured logger
  const logLevel = payload.level === 'critical' ? 'fatal' : 'warn';
  logger[logLevel](payload, payload.message);
  
  // Optional: Send to external webhook (Slack, PagerDuty, etc.)
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await axios.post(webhookUrl, payload, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      logger.error({ error, webhookUrl }, 'Failed to send alert to webhook');
    }
  }
}

export function alertRedisCircuitOpen() {
  return sendAlert({
    level: 'critical',
    service: 'Redis',
    message: 'Redis circuit breaker opened - connection unavailable',
    timestamp: new Date().toISOString()
  });
}

export function alertGatewayDisconnected(source: string, reason: string) {
  return sendAlert({
    level: 'critical',
    service: 'MarketDataGateway',
    message: `Gateway disconnected: ${source}`,
    details: { source, reason },
    timestamp: new Date().toISOString()
  });
}

export function alertMaxReconnectAttempts(source: string) {
  return sendAlert({
    level: 'critical',
    service: 'MarketDataGateway',
    message: `Max reconnection attempts reached: ${source}`,
    details: { source },
    timestamp: new Date().toISOString()
  });
}

export function alertBufferOverflow() {
  return sendAlert({
    level: 'warning',
    service: 'RedisBuffer',
    message: 'Redis buffer approaching capacity',
    timestamp: new Date().toISOString()
  });
}
