#!/usr/bin/env ts-node

/**
 * Health Check Verification Script
 * 
 * Verifies that the market-stream-service is running correctly by checking:
 * - HTTP server is responding
 * - All components report healthy status
 * - Circuit breakers are functioning
 * 
 * Usage:
 *   npm run verify-health
 *   ts-node scripts/verify-health.ts
 * 
 * Exit codes:
 *   0 - All checks passed
 *   1 - Service unavailable or unhealthy
 */

import http from 'http';

const MARKET_STREAM_HOST = process.env.MARKET_STREAM_HOST || 'localhost';
const MARKET_STREAM_PORT = process.env.MARKET_STREAM_PORT || 8090;
const TIMEOUT_MS = 5000;

interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
  stats: {
    gateways: any;
    subscriber: any;
    cache: any;
    buffer: any;
    circuitBreaker: any;
  };
}

async function checkHealth(): Promise<void> {
  console.log('🔍 Verifying Market Stream Service health...\n');

  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: MARKET_STREAM_HOST,
        port: MARKET_STREAM_PORT,
        path: '/health',
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              console.error(`❌ Health check failed with status ${res.statusCode}`);
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }

            const health: HealthResponse = JSON.parse(data);

            console.log('✅ Service Status:', health.status);
            console.log('📊 Service Name:', health.service);
            console.log('⏰ Timestamp:', health.timestamp);
            console.log('\n📈 Component Stats:');
            console.log('  Gateways:', JSON.stringify(health.stats.gateways, null, 2));
            console.log('  Subscriber:', JSON.stringify(health.stats.subscriber, null, 2));
            console.log('  Cache:', JSON.stringify(health.stats.cache, null, 2));
            console.log('  Buffer:', JSON.stringify(health.stats.buffer, null, 2));
            console.log('  Circuit Breaker:', JSON.stringify(health.stats.circuitBreaker, null, 2));

            if (health.status === 'healthy') {
              console.log('\n✅ All health checks passed!');
              resolve();
            } else {
              console.error('\n❌ Service reported unhealthy status');
              reject(new Error('Unhealthy status'));
            }
          } catch (error) {
            console.error('❌ Failed to parse health response:', error);
            reject(error);
          }
        });
      }
    );

    req.on('error', (error) => {
      console.error('❌ Connection error:', error.message);
      console.error('\nTroubleshooting:');
      console.error('  1. Is the Market Stream Service running?');
      console.error('  2. Check the service is listening on port', MARKET_STREAM_PORT);
      console.error('  3. Verify firewall/network settings');
      reject(error);
    });

    req.on('timeout', () => {
      console.error('❌ Health check timed out after', TIMEOUT_MS, 'ms');
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Run health check
checkHealth()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Health check failed:', error.message);
    process.exit(1);
  });
