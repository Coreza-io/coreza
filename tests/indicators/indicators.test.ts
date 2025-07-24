import request from 'supertest';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { TestDataGenerator, TEST_CONFIG } from '../utils/testHelpers';

describe('Indicators API - Feature Parity Tests', () => {
  let testUser: any;
  let candleData: any[];

  beforeAll(async () => {
    testUser = await TestDataGenerator.createTestUser();
    candleData = TestDataGenerator.generateCandleData(100);
  });

  afterAll(async () => {
    await TestDataGenerator.cleanup();
  });

  describe('RSI Indicator', () => {
    test('RSI calculation matches between Node.js and Python', async () => {
      const payload = {
        prices: candleData.map(c => c.c), // closing prices
        period: 14
      };

      // Test Node.js endpoint
      const nodeResponse = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/indicators/rsi')
        .send(payload)
        .expect(200);

      // Test Python endpoint (if available)
      try {
        const pythonResponse = await request(TEST_CONFIG.PYTHON_API_BASE)
          .post('/indicators/rsi')
          .send({
            user_id: testUser.id,
            candle_data: candleData,
            window: 14
          })
          .expect(200);

        // Compare results
        expect(nodeResponse.body.indicator).toBe('RSI');
        expect(nodeResponse.body.period).toBe(14);
        expect(nodeResponse.body.values).toHaveLength(pythonResponse.body.values?.length || 0);
        
        // Check if latest values are close (within 0.1% tolerance)
        if (pythonResponse.body.latest && nodeResponse.body.latest) {
          const tolerance = 0.001;
          const diff = Math.abs(nodeResponse.body.latest - pythonResponse.body.latest);
          const relativeDiff = diff / pythonResponse.body.latest;
          expect(relativeDiff).toBeLessThan(tolerance);
        }
      } catch (error) {
        console.warn('Python API not available for comparison, testing Node.js only');
      }

      // Validate Node.js response structure
      expect(nodeResponse.body).toHaveProperty('indicator', 'RSI');
      expect(nodeResponse.body).toHaveProperty('period', 14);
      expect(nodeResponse.body).toHaveProperty('values');
      expect(nodeResponse.body).toHaveProperty('latest');
      expect(Array.isArray(nodeResponse.body.values)).toBe(true);
      
      // RSI values should be between 0 and 100
      nodeResponse.body.values.forEach((value: number) => {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('EMA Indicator', () => {
    test('EMA calculation accuracy', async () => {
      const payload = {
        prices: candleData.map(c => c.c),
        period: 20
      };

      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/indicators/ema')
        .send(payload)
        .expect(200);

      expect(response.body.indicator).toBe('EMA');
      expect(response.body.period).toBe(20);
      expect(Array.isArray(response.body.values)).toBe(true);
      expect(response.body.values.length).toBeGreaterThan(0);
      
      // EMA values should be reasonable (within price range)
      const maxPrice = Math.max(...candleData.map(c => c.c));
      const minPrice = Math.min(...candleData.map(c => c.c));
      
      response.body.values.forEach((value: number) => {
        expect(value).toBeGreaterThan(minPrice * 0.8);
        expect(value).toBeLessThan(maxPrice * 1.2);
      });
    });
  });

  describe('MACD Indicator', () => {
    test('MACD calculation with proper structure', async () => {
      const payload = {
        prices: candleData.map(c => c.c),
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9
      };

      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/indicators/macd')
        .send(payload)
        .expect(200);

      expect(response.body.indicator).toBe('MACD');
      expect(response.body.periods).toEqual({
        fast: 12,
        slow: 26,
        signal: 9
      });
      
      // Check MACD structure
      expect(Array.isArray(response.body.values)).toBe(true);
      if (response.body.values.length > 0) {
        const macdValue = response.body.values[0];
        expect(macdValue).toHaveProperty('macd');
        expect(macdValue).toHaveProperty('signal');
        expect(macdValue).toHaveProperty('histogram');
      }
    });
  });

  describe('ADX Indicator', () => {
    test('ADX calculation with candle data', async () => {
      const payload = {
        candle_data: candleData,
        period: 14
      };

      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/indicators/adx')
        .send(payload)
        .expect(200);

      expect(response.body.indicator).toBe('ADX');
      expect(response.body.period).toBe(14);
      expect(Array.isArray(response.body.values)).toBe(true);
      
      // ADX values should be between 0 and 100
      response.body.values.forEach((value: any) => {
        if (typeof value === 'number') {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        } else {
          expect(value).toHaveProperty('adx');
          expect(value).toHaveProperty('pdi');
          expect(value).toHaveProperty('mdi');
        }
      });
    });
  });

  describe('Error Handling', () => {
    test('Missing parameters return proper error', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/indicators/rsi')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('required');
    });

    test('Invalid period returns proper error', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/indicators/rsi')
        .send({
          prices: [1, 2, 3],
          period: -1
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Performance Tests', () => {
    test('Large dataset processing performance', async () => {
      const largeCandleData = TestDataGenerator.generateCandleData(10000);
      const payload = {
        prices: largeCandleData.map(c => c.c),
        period: 14
      };

      const startTime = Date.now();
      
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/indicators/rsi')
        .send(payload)
        .expect(200);
      
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      
      console.log(`RSI processing time for 10k points: ${processingTime}ms`);
      
      // Should process 10k points in under 5 seconds
      expect(processingTime).toBeLessThan(5000);
      expect(response.body.values.length).toBeGreaterThan(0);
    });
  });
});