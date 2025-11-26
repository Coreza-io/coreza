// Updated import path for backend
import { supabase } from '../../coreza-backend/src/config/supabase';

export interface TestUser {
  id: string;
  email: string;
  accessToken?: string;
}

export interface TestWorkflow {
  id: string;
  userId: string;
  name: string;
  nodes: any[];
  edges: any[];
}

export class TestDataGenerator {
  static generateTestUser(): TestUser {
    const timestamp = Date.now();
    return {
      id: `test-user-${timestamp}`,
      email: `test-${timestamp}@example.com`
    };
  }

  static generateCandleData(count: number = 100): any[] {
    const candles = [];
    const basePrice = 100;
    let currentPrice = basePrice;
    
    for (let i = 0; i < count; i++) {
      const change = (Math.random() - 0.5) * 2; // Random change between -1 and 1
      currentPrice += change;
      
      const high = currentPrice + Math.random() * 2;
      const low = currentPrice - Math.random() * 2;
      const volume = Math.floor(Math.random() * 1000000);
      
      candles.push({
        t: new Date(Date.now() - (count - i) * 60000).toISOString(), // 1 minute intervals
        o: currentPrice,
        h: high,
        l: low,
        c: currentPrice + (Math.random() - 0.5),
        v: volume
      });
    }
    
    return candles;
  }

  static generateTestWorkflow(userId: string): TestWorkflow {
    const timestamp = Date.now();
    return {
      id: `test-workflow-${timestamp}`,
      userId,
      name: `Test Workflow ${timestamp}`,
      nodes: [
        {
          id: 'input-1',
          type: 'input',
          position: { x: 100, y: 100 },
          data: { symbol: 'AAPL', exchange: 'NASDAQ' }
        },
        {
          id: 'rsi-1',
          type: 'rsi',
          position: { x: 300, y: 100 },
          data: { period: 14 }
        },
        {
          id: 'output-1',
          type: 'output',
          position: { x: 500, y: 100 },
          data: {}
        }
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'input-1',
          target: 'rsi-1'
        },
        {
          id: 'edge-2',
          source: 'rsi-1',
          target: 'output-1'
        }
      ]
    };
  }

  static async createTestUser(): Promise<TestUser> {
    const user = this.generateTestUser();
    
    // Create user in test database
    const { error } = await supabase
      .from('users')
      .insert({
        user_id: user.id,
        first_name: 'Test',
        last_name: 'User'
      });

    if (error) {
      console.warn('Test user creation warning:', error.message);
    }

    return user;
  }

  static async createTestWorkflow(userId: string): Promise<TestWorkflow> {
    const workflow = this.generateTestWorkflow(userId);
    
    const { error } = await supabase
      .from('workflows')
      .insert({
        id: workflow.id,
        user_id: userId,
        name: workflow.name,
        nodes: workflow.nodes,
        edges: workflow.edges,
        is_active: false
      });

    if (error) {
      throw new Error(`Failed to create test workflow: ${error.message}`);
    }

    return workflow;
  }

  static async cleanup(): Promise<void> {
    try {
      // Clean up test data
      await supabase
        .from('workflow_runs')
        .delete()
        .like('id', 'test-%');
      
      await supabase
        .from('workflows')
        .delete()
        .like('id', 'test-%');
      
      await supabase
        .from('users')
        .delete()
        .like('user_id', 'test-%');
      
      console.log('🧹 Test data cleanup completed');
    } catch (error) {
      console.warn('Test cleanup warning:', error);
    }
  }
}

export const TEST_CONFIG = {
  PYTHON_API_BASE: 'http://localhost:3000', // Python backend URL
  NODE_API_BASE: 'http://localhost:8000',   // Node.js backend URL
  TEST_TIMEOUT: 30000,
  MAX_RETRIES: 3
};