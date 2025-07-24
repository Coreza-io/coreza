import request from 'supertest';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { TestDataGenerator, TEST_CONFIG } from '../utils/testHelpers';

describe('Trading APIs - Integration Tests', () => {
  let testUser: any;

  beforeAll(async () => {
    testUser = await TestDataGenerator.createTestUser();
  });

  afterAll(async () => {
    await TestDataGenerator.cleanup();
  });

  describe('Alpaca API Integration', () => {
    test('Get account info (without credentials)', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/alpaca/account')
        .send({
          user_id: testUser.id,
          credential_id: 'test-cred'
        })
        .expect(404); // Expected since no credentials stored

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('credentials not found');
    });

    test('Invalid credentials handling', async () => {
      // This tests the error handling for invalid API keys
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/alpaca/auth')
        .send({
          user_id: testUser.id,
          credential_name: 'test-alpaca',
          api_key: 'invalid-key',
          secret_key: 'invalid-secret',
          paper_trading: true
        })
        .expect(401); // Expected auth failure

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Dhan API Integration', () => {
    test('Authentication flow validation', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/dhan/auth')
        .send({
          user_id: testUser.id,
          credential_name: 'test-dhan',
          client_id: 'test-client',
          api_key: 'test-key'
        })
        .expect(502); // Expected since test credentials are invalid

      expect(response.body).toHaveProperty('error');
    });

    test('Candle data request structure', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/dhan/candles')
        .send({
          user_id: testUser.id,
          credential_id: 'test-cred',
          exchange: 'NSE_EQ',
          symbol: 'RELIANCE',
          interval: '1Day',
          lookback: 30
        })
        .expect(404); // Expected since no credentials

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('credentials not found');
    });
  });

  describe('Market Data API', () => {
    test('Market data endpoint structure', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/market/quote')
        .send({
          symbol: 'AAPL',
          exchange: 'NASDAQ'
        });

      // This might succeed or fail depending on data provider availability
      if (response.status === 200) {
        expect(response.body).toHaveProperty('data');
      } else {
        expect(response.body).toHaveProperty('error');
      }
    });
  });

  describe('External Integrations', () => {
    describe('Gmail API', () => {
      test('OAuth URL generation', async () => {
        const response = await request(TEST_CONFIG.NODE_API_BASE)
          .post('/api/gmail/auth/url')
          .send({
            user_id: testUser.id,
            credential_name: 'test-gmail',
            client_id: 'test-client-id',
            client_secret: 'test-client-secret',
            redirect_uri: 'http://localhost:3000/callback'
          })
          .expect(200);

        expect(response.body).toHaveProperty('auth_url');
        expect(response.body.auth_url).toContain('accounts.google.com');
        expect(response.body).toHaveProperty('message');
      });

      test('Send email without credentials', async () => {
        const response = await request(TEST_CONFIG.NODE_API_BASE)
          .post('/api/gmail/send')
          .send({
            user_id: testUser.id,
            credential_id: 'non-existent',
            to: 'test@example.com',
            subject: 'Test Email',
            body: 'This is a test email'
          })
          .expect(404);

        expect(response.body).toHaveProperty('error');
        expect(response.body.error).toContain('credentials not found');
      });
    });

    describe('WhatsApp API', () => {
      test('Send message structure validation', async () => {
        const response = await request(TEST_CONFIG.NODE_API_BASE)
          .post('/api/whatsapp/send')
          .send({
            to: '+1234567890',
            message: 'Test message'
          })
          .expect(500); // Expected since no WhatsApp credentials configured

        expect(response.body).toHaveProperty('error');
      });

      test('Webhook verification', async () => {
        const response = await request(TEST_CONFIG.NODE_API_BASE)
          .get('/api/whatsapp/webhook')
          .query({
            'hub.mode': 'subscribe',
            'hub.verify_token': 'your_verify_token',
            'hub.challenge': 'test_challenge'
          })
          .expect(200);

        expect(response.text).toBe('test_challenge');
      });
    });

    describe('Webhooks API', () => {
      test('Register webhook', async () => {
        const webhookData = {
          user_id: testUser.id,
          name: 'Test Webhook',
          url: 'https://httpbin.org/post',
          events: ['workflow.completed', 'workflow.failed']
        };

        const response = await request(TEST_CONFIG.NODE_API_BASE)
          .post('/api/webhooks/register')
          .send(webhookData)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.webhook).toHaveProperty('id');
        expect(response.body.webhook.name).toBe(webhookData.name);
      });

      test('Get user webhooks', async () => {
        const response = await request(TEST_CONFIG.NODE_API_BASE)
          .get(`/api/webhooks/${testUser.id}`)
          .expect(200);

        expect(response.body).toHaveProperty('webhooks');
        expect(Array.isArray(response.body.webhooks)).toBe(true);
      });
    });
  });

  describe('API Response Consistency', () => {
    test('Error response format consistency', async () => {
      const endpoints = [
        '/api/indicators/rsi',
        '/api/workflow/invalid-user/workflows',
        '/api/alpaca/account',
        '/api/dhan/funds'
      ];

      for (const endpoint of endpoints) {
        const response = await request(TEST_CONFIG.NODE_API_BASE)
          .post(endpoint)
          .send({});

        // All errors should have consistent format
        if (response.status >= 400) {
          expect(response.body).toHaveProperty('error');
          expect(typeof response.body.error).toBe('string');
        }
      }
    });

    test('Success response format consistency', async () => {
      // Test endpoints that should return success (with mock data)
      const candleData = TestDataGenerator.generateCandleData(50);
      
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post('/api/indicators/rsi')
        .send({
          prices: candleData.map(c => c.c),
          period: 14
        })
        .expect(200);

      // Success responses should have consistent structure
      expect(response.body).toHaveProperty('indicator');
      expect(response.body).toHaveProperty('values');
      expect(Array.isArray(response.body.values)).toBe(true);
    });
  });
});