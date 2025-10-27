import request from 'supertest';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { TestDataGenerator, TEST_CONFIG } from '../utils/testHelpers';

describe('Workflow Engine - Execution Tests', () => {
  let testUser: any;
  let testWorkflow: any;

  beforeAll(async () => {
    testUser = await TestDataGenerator.createTestUser();
    testWorkflow = await TestDataGenerator.createTestWorkflow(testUser.id);
  });

  afterAll(async () => {
    await TestDataGenerator.cleanup();
  });

  describe('Workflow CRUD Operations', () => {
    test('Create workflow', async () => {
      const workflowData = {
        name: 'Test API Workflow',
        nodes: [
          {
            id: 'node1',
            type: 'input',
            data: { symbol: 'TSLA' }
          }
        ],
        edges: []
      };

      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post(`/api/workflow/${testUser.id}`)
        .send(workflowData)
        .expect(201);

      expect(response.body.workflow).toHaveProperty('id');
      expect(response.body.workflow.name).toBe(workflowData.name);
      expect(response.body.workflow.user_id).toBe(testUser.id);
    });

    test('Get user workflows', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .get(`/api/workflow/${testUser.id}`)
        .expect(200);

      expect(response.body).toHaveProperty('workflows');
      expect(Array.isArray(response.body.workflows)).toBe(true);
      expect(response.body.workflows.length).toBeGreaterThan(0);
    });

    test('Update workflow', async () => {
      const updateData = {
        name: 'Updated Test Workflow',
        is_active: true
      };

      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .put(`/api/workflow/${testUser.id}/${testWorkflow.id}`)
        .send(updateData)
        .expect(200);

      expect(response.body.workflow.name).toBe(updateData.name);
      expect(response.body.workflow.is_active).toBe(true);
    });
  });

  describe('Workflow Execution', () => {
    test('Manual workflow execution', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post(`/api/workflow/${testUser.id}/${testWorkflow.id}/execute`)
        .send({ input_data: { test: true } })
        .expect(200);

      expect(response.body).toHaveProperty('run_id');
      expect(response.body).toHaveProperty('status', 'started');
      expect(response.body).toHaveProperty('message');

      // Wait a bit for execution to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check run status
      const statusResponse = await request(TEST_CONFIG.NODE_API_BASE)
        .get(`/api/workflow/${testUser.id}/${testWorkflow.id}/runs/${response.body.run_id}/status`)
        .expect(200);

      expect(statusResponse.body.run).toHaveProperty('status');
      expect(['running', 'completed', 'failed']).toContain(statusResponse.body.run.status);
    });

    test('Get workflow runs', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .get(`/api/workflow/${testUser.id}/${testWorkflow.id}/runs`)
        .expect(200);

      expect(response.body).toHaveProperty('runs');
      expect(Array.isArray(response.body.runs)).toBe(true);
    });

    test('Get node executions for run', async () => {
      // First create a run
      const runResponse = await request(TEST_CONFIG.NODE_API_BASE)
        .post(`/api/workflow/${testUser.id}/${testWorkflow.id}/execute`)
        .send({})
        .expect(200);

      // Wait for execution
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get node executions
      const execResponse = await request(TEST_CONFIG.NODE_API_BASE)
        .get(`/api/workflow/${testUser.id}/${testWorkflow.id}/runs/${runResponse.body.run_id}/executions`)
        .expect(200);

      expect(execResponse.body).toHaveProperty('executions');
      expect(Array.isArray(execResponse.body.executions)).toBe(true);
    });
  });

  describe('Workflow Scheduling', () => {
    test('Schedule workflow with cron expression', async () => {
      const scheduleData = {
        is_active: true,
        schedule_cron: '0 0 * * *' // Daily at midnight
      };

      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .put(`/api/workflow/${testUser.id}/${testWorkflow.id}/schedule`)
        .send(scheduleData)
        .expect(200);

      expect(response.body.workflow.is_active).toBe(true);
      expect(response.body.workflow.schedule_cron).toBe(scheduleData.schedule_cron);
      expect(response.body.message).toContain('scheduled');
    });

    test('Unschedule workflow', async () => {
      const scheduleData = {
        is_active: false,
        schedule_cron: null
      };

      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .put(`/api/workflow/${testUser.id}/${testWorkflow.id}/schedule`)
        .send(scheduleData)
        .expect(200);

      expect(response.body.workflow.is_active).toBe(false);
      expect(response.body.message).toContain('unscheduled');
    });

    test('Get scheduler status', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .get('/api/workflow/scheduler/status')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('scheduled_workflows');
      expect(response.body).toHaveProperty('jobs');
      expect(Array.isArray(response.body.jobs)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('Execute non-existent workflow', async () => {
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .post(`/api/workflow/${testUser.id}/non-existent-id/execute`)
        .send({})
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('not found');
    });

    test('Access workflow from different user', async () => {
      const otherUser = await TestDataGenerator.createTestUser();
      
      const response = await request(TEST_CONFIG.NODE_API_BASE)
        .get(`/api/workflow/${otherUser.id}/${testWorkflow.id}/runs`)
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Performance Tests', () => {
    test('Concurrent workflow executions', async () => {
      const concurrentRuns = 5;
      const promises = [];

      for (let i = 0; i < concurrentRuns; i++) {
        promises.push(
          request(TEST_CONFIG.NODE_API_BASE)
            .post(`/api/workflow/${testUser.id}/${testWorkflow.id}/execute`)
            .send({ run_number: i })
        );
      }

      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('run_id');
        console.log(`Run ${index + 1}: ${response.body.run_id}`);
      });

      // Wait for all executions to complete
      await new Promise(resolve => setTimeout(resolve, 5000));
    });
  });
});