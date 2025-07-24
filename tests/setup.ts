import { beforeAll, afterAll, beforeEach } from '@jest/globals';
import { supabase } from '../coreza-backend-node/src/config/supabase';

// Global test setup
beforeAll(async () => {
  console.log('🧪 Setting up test environment...');
  
  // Test database connection
  const { data, error } = await supabase.from('users').select('count').limit(1);
  if (error) {
    console.warn('⚠️ Database connection warning:', error.message);
  } else {
    console.log('✅ Test database connected');
  }
});

afterAll(async () => {
  console.log('🧹 Cleaning up test environment...');
  // Add any cleanup logic here
});

beforeEach(() => {
  // Reset any global state before each test
  jest.clearAllMocks();
});

// Global test utilities
declare global {
  namespace NodeJS {
    interface Global {
      testHelpers: any;
    }
  }
}

export {};