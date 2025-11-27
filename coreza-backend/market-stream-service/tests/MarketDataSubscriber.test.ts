/**
 * Integration Tests for MarketDataSubscriber
 * 
 * Tests subscription management, workflow triggering, and circuit breaker behavior
 */

import { MarketDataSubscriber } from '../src/services/MarketDataSubscriber';
import { CorezaMarketEvent } from '../src/types/marketEvent';
import { createRedisPubSub } from '../src/config/redis';
import { bullMqJobQueue } from '../src/services/jobQueueManager';

// Mock dependencies
jest.mock('../src/config/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'test-run-id' },
            error: null,
          }),
        }),
      }),
    }),
  },
}));

jest.mock('../src/services/WorkflowCache', () => ({
  default: {
    getWorkflow: jest.fn().mockResolvedValue({
      id: 'test-workflow-id',
      name: 'Test Workflow',
      is_active: true,
      nodes: [],
      edges: [],
    }),
  },
}));

jest.mock('../src/services/jobQueueManager', () => ({
  bullMqJobQueue: {
    addWorkflowExecution: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
  },
}));

describe('MarketDataSubscriber Integration Tests', () => {
  let subscriber: MarketDataSubscriber;
  let redisPub: any;
  let redisSub: any;

  beforeAll(() => {
    const { pub, sub } = createRedisPubSub();
    redisPub = pub;
    redisSub = sub;
  });

  beforeEach(() => {
    subscriber = MarketDataSubscriber.getInstance();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await subscriber.cleanup();
  });

  afterAll(async () => {
    await redisPub.quit();
    await redisSub.quit();
  });

  describe('Subscription Management', () => {
    it('should subscribe to a symbol and store subscription in memory', async () => {
      await subscriber.subscribe(
        'test-workflow-1',
        'node-1',
        'user-123',
        ['AAPL', 'TSLA'],
        { source: 'alpaca', eventTypes: ['trade'] }
      );

      const stats = subscriber.getStats();
      
      expect(stats.totalWorkflows).toBe(1);
      expect(stats.totalSymbols).toBe(2);
      expect(stats.subscriptions).toHaveLength(1);
      expect(stats.subscriptions[0].workflowId).toBe('test-workflow-1');
      expect(stats.subscriptions[0].symbols).toEqual(['AAPL', 'TSLA']);
    });

    it('should handle multiple subscriptions to the same symbol', async () => {
      await subscriber.subscribe(
        'workflow-1',
        'node-1',
        'user-123',
        ['AAPL']
      );

      await subscriber.subscribe(
        'workflow-2',
        'node-2',
        'user-456',
        ['AAPL']
      );

      const stats = subscriber.getStats();
      
      expect(stats.totalWorkflows).toBe(2);
      expect(stats.totalSymbols).toBe(1); // Only one unique symbol
    });

    it('should unsubscribe from symbols correctly', async () => {
      await subscriber.subscribe(
        'workflow-1',
        'node-1',
        'user-123',
        ['AAPL', 'TSLA']
      );

      await subscriber.unsubscribe('workflow-1');

      const stats = subscriber.getStats();
      
      expect(stats.totalWorkflows).toBe(0);
      expect(stats.totalSymbols).toBe(0);
    });

    it('should not unsubscribe from Redis channel if other workflows still need the symbol', async () => {
      await subscriber.subscribe(
        'workflow-1',
        'node-1',
        'user-123',
        ['AAPL']
      );

      await subscriber.subscribe(
        'workflow-2',
        'node-2',
        'user-456',
        ['AAPL']
      );

      await subscriber.unsubscribe('workflow-1');

      const stats = subscriber.getStats();
      
      expect(stats.totalWorkflows).toBe(1);
      expect(stats.totalSymbols).toBe(1); // Symbol still subscribed for workflow-2
    });
  });

  describe('Workflow Triggering', () => {
    it('should trigger workflow execution when market event arrives', async () => {
      await subscriber.subscribe(
        'test-workflow',
        'node-1',
        'user-123',
        ['AAPL'],
        { source: 'alpaca', eventTypes: ['trade'] }
      );

      // Simulate market event
      const marketEvent: CorezaMarketEvent = {
        source: 'alpaca',
        symbol: 'AAPL',
        type: 'trade',
        timestamp: new Date().toISOString(),
        lastPrice: 150.25,
      };

      // Publish event to Redis (simulating MarketDataGateway)
      await redisPub.publish('md:symbol:AAPL', JSON.stringify(marketEvent));

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify workflow execution was queued
      expect(bullMqJobQueue.addWorkflowExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'test-workflow',
          userId: 'user-123',
          trigger: 'webhook',
          initialInput: { marketEvent },
        })
      );
    });

    it('should filter events by source', async () => {
      await subscriber.subscribe(
        'test-workflow',
        'node-1',
        'user-123',
        ['AAPL'],
        { source: 'alpaca', eventTypes: ['trade'] }
      );

      // Simulate event from different source
      const marketEvent: CorezaMarketEvent = {
        source: 'binance', // Different source
        symbol: 'AAPL',
        type: 'trade',
        timestamp: new Date().toISOString(),
        lastPrice: 150.25,
      };

      await redisPub.publish('md:symbol:AAPL', JSON.stringify(marketEvent));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should not trigger workflow due to source mismatch
      expect(bullMqJobQueue.addWorkflowExecution).not.toHaveBeenCalled();
    });

    it('should filter events by event type', async () => {
      await subscriber.subscribe(
        'test-workflow',
        'node-1',
        'user-123',
        ['AAPL'],
        { source: 'alpaca', eventTypes: ['bar'] }
      );

      // Simulate event with different type
      const marketEvent: CorezaMarketEvent = {
        source: 'alpaca',
        symbol: 'AAPL',
        type: 'trade', // Different type
        timestamp: new Date().toISOString(),
        lastPrice: 150.25,
      };

      await redisPub.publish('md:symbol:AAPL', JSON.stringify(marketEvent));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Should not trigger workflow due to type mismatch
      expect(bullMqJobQueue.addWorkflowExecution).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle subscription errors gracefully', async () => {
      // Create invalid subscription (will fail internally but shouldn't crash)
      await expect(
        subscriber.subscribe(
          '',  // Invalid workflow ID
          'node-1',
          'user-123',
          []  // Empty symbols array
        )
      ).resolves.not.toThrow();
    });

    it('should continue processing after a single workflow trigger fails', async () => {
      const WorkflowCache = require('../src/services/WorkflowCache').default;
      
      // Mock workflow cache to fail once
      WorkflowCache.getWorkflow
        .mockResolvedValueOnce(null) // First call fails
        .mockResolvedValue({          // Subsequent calls succeed
          id: 'test-workflow',
          name: 'Test Workflow',
          is_active: true,
          nodes: [],
          edges: [],
        });

      await subscriber.subscribe('workflow-1', 'node-1', 'user-123', ['AAPL']);
      await subscriber.subscribe('workflow-2', 'node-2', 'user-456', ['AAPL']);

      const marketEvent: CorezaMarketEvent = {
        source: 'alpaca',
        symbol: 'AAPL',
        type: 'trade',
        timestamp: new Date().toISOString(),
        lastPrice: 150.25,
      };

      await redisPub.publish('md:symbol:AAPL', JSON.stringify(marketEvent));
      await new Promise(resolve => setTimeout(resolve, 500));

      // Second workflow should still be triggered despite first one failing
      expect(bullMqJobQueue.addWorkflowExecution).toHaveBeenCalledTimes(1);
    });
  });

  describe('Statistics', () => {
    it('should return accurate statistics', async () => {
      await subscriber.subscribe('wf-1', 'node-1', 'user-1', ['AAPL', 'TSLA']);
      await subscriber.subscribe('wf-2', 'node-2', 'user-2', ['MSFT']);

      const stats = subscriber.getStats();

      expect(stats).toEqual({
        totalWorkflows: 2,
        totalSymbols: 3,
        subscriptions: [
          {
            workflowId: 'wf-1',
            symbols: ['AAPL', 'TSLA'],
            source: undefined,
          },
          {
            workflowId: 'wf-2',
            symbols: ['MSFT'],
            source: undefined,
          },
        ],
      });
    });
  });

  describe('Cleanup', () => {
    it('should clean up resources properly', async () => {
      await subscriber.subscribe('wf-1', 'node-1', 'user-1', ['AAPL']);
      
      await subscriber.cleanup();

      const stats = subscriber.getStats();
      expect(stats.totalWorkflows).toBe(0);
      expect(stats.totalSymbols).toBe(0);
    });
  });
});
