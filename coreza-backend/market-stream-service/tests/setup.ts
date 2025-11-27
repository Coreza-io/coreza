/**
 * Jest Test Setup
 * 
 * Runs before all tests to configure the environment
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent'; // Suppress logs during tests
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.COREZA_ENCRYPTION_KEY = process.env.COREZA_ENCRYPTION_KEY || 'dGVzdC1lbmNyeXB0aW9uLWtleS1mb3ItdGVzdGluZw==';

// Set UTC timezone for consistent date handling in tests
process.env.TZ = 'UTC';

// Increase timeout for integration tests
jest.setTimeout(10000);
