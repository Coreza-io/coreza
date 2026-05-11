import Redis from 'ioredis';
import { getRedisCache, getRedisQueue } from '../config/redis';
import { supabase } from '../config/supabase';
import logger from './logger';

const STARTUP_TIMEOUT_MS = 10000; // 10 second timeout for startup checks

/**
 * Validate Redis connection is working
 */
async function validateRedisConnection(
  name: 'queue' | 'cache',
  redisFactory: () => Redis
): Promise<void> {
  logger.info({ name }, 'Validating Redis connection...');

  const redis = redisFactory();
  
  try {
    // Test PING command
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected Redis PING response: ${pong}`);
    }
    
    // Test basic SET/GET operations
    const testKey = 'startup:validation:test';
    const testValue = Date.now().toString();
    
    await redis.set(testKey, testValue, 'EX', 10);
    const retrieved = await redis.get(testKey);
    
    if (retrieved !== testValue) {
      throw new Error(`Redis SET/GET validation failed. Expected ${testValue}, got ${retrieved}`);
    }
    
    await redis.del(testKey);
    
    // Check Redis version
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:(\d+\.\d+\.\d+)/);
    if (versionMatch) {
      const version = versionMatch[1];
      logger.info({ version }, 'Redis version detected');
      
      const [major, minor] = version.split('.').map(Number);
      if (major < 6 || (major === 6 && minor < 2)) {
        logger.warn(
          { version, recommended: '6.2.0+' },
          'Redis version is below recommended minimum for BullMQ'
        );
      }
    }
    
    logger.info({ name }, '✅ Redis connection validated successfully');
  } catch (error) {
    logger.fatal({ err: error, name }, 'Redis connection validation failed');
    throw new Error(`Redis validation failed (${name}): ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate Supabase connection and permissions
 */
async function validateSupabaseConnection(): Promise<void> {
  logger.info('Validating Supabase connection...');
  
  try {
    // Test basic query - check we can read workflows table
    const { error: workflowError } = await supabase
      .from('workflows')
      .select('id')
      .limit(1);
    
    if (workflowError) {
      throw new Error(`Workflows table query failed: ${workflowError.message}`);
    }
    
    // Test workflow_runs table access
    const { error: runsError } = await supabase
      .from('workflow_runs')
      .select('id')
      .limit(1);
    
    if (runsError) {
      throw new Error(`Workflow_runs table query failed: ${runsError.message}`);
    }
    
    // Test user_credentials table access
    const { error: credsError } = await supabase
      .from('user_credentials')
      .select('id')
      .limit(1);
    
    if (credsError) {
      throw new Error(`User_credentials table query failed: ${credsError.message}`);
    }
    
    logger.info('✅ Supabase connection validated successfully');
  } catch (error) {
    logger.fatal({ err: error }, 'Supabase connection validation failed');
    throw new Error(`Supabase validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate required environment variables
 */
function validateEnvironmentVariables(): void {
  logger.info('Validating environment variables...');
  
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'COREZA_ENCRYPTION_KEY',
  ];
  
  const missing: string[] = [];
  
  for (const varName of required) {
    if (varName === 'SUPABASE_SECRET_KEY') {
      if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        missing.push('SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)');
      }
      continue;
    }

    if (!process.env[varName]) {
      missing.push(varName);
    }
  }
  
  const hasRedisConfig =
    !!process.env.REDIS_QUEUE_URL ||
    !!process.env.REDIS_CACHE_URL ||
    !!process.env.REDIS_URL;

  if (!hasRedisConfig) {
    missing.push('REDIS_QUEUE_URL or REDIS_CACHE_URL (or fallback REDIS_URL)');
  }

  if (missing.length > 0) {
    const errorMsg = `Missing required environment variables: ${missing.join(', ')}`;
    logger.fatal({ missing }, errorMsg);
    throw new Error(errorMsg);
  }
  
  logger.info('✅ Environment variables validated');
}

/**
 * Run all startup validations with timeout
 */
export async function runStartupValidation(): Promise<void> {
  logger.info('🔍 Running startup validation checks...');
  
  const validationPromise = (async () => {
    // Step 1: Validate environment variables (fast, no I/O)
    validateEnvironmentVariables();
    
    // Step 2: Validate Redis connections (network I/O)
    await validateRedisConnection('queue', getRedisQueue);
    await validateRedisConnection('cache', getRedisCache);
    
    // Step 3: Validate Supabase connection (network I/O)
    await validateSupabaseConnection();
  })();
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Startup validation timed out after ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);
  });
  
  try {
    await Promise.race([validationPromise, timeoutPromise]);
    logger.info('✅ All startup validations passed');
  } catch (error) {
    logger.fatal({ err: error }, 'Startup validation failed');
    
    if (error instanceof Error) {
      console.error('\n💥 STARTUP VALIDATION FAILED\n');
      console.error('Error:', error.message);
      console.error('\nTroubleshooting:');
      console.error('  1. Check Redis is running and accessible at REDIS_URL');
      console.error('  2. Verify Supabase credentials are correct');
      console.error('  3. Ensure all required environment variables are set');
      console.error('  4. Check network connectivity to external services\n');
    }
    
    throw error;
  }
}
