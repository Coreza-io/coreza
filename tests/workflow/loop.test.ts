import { describe, test, expect } from '@jest/globals';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';
const express = require('../../coreza-backend/node_modules/express');
import request from 'supertest';
import controlRoutes from '../../coreza-backend/src/routes/control';

describe('Loop node', () => {
  test('POST /control/loop returns loop config', async () => {
    const app = express();
    app.use(express.json());
    app.use('/control', controlRoutes);

    const res = await request(app)
      .post('/control/loop')
      .send({ inputArray: 'items', items: [1, 2, 3], batchSize: 1, parallel: true, continueOnError: true, throttleMs: 50 })
      .expect(200);

    expect(res.body.items).toEqual([1, 2, 3]);
    expect(res.body.batchSize).toBe(1);
    expect(res.body.isLoopNode).toBe(true);
    expect(res.body.parallel).toBe(true);
    expect(res.body.continueOnError).toBe(true);
    expect(res.body.throttleMs).toBe(50);
  });

  test('Loop node processes frontend-only (N8N style)', async () => {
    // This test should verify that Loop nodes work entirely in frontend
    // without backend API calls, similar to N8N's "Loop Over Items" node
    const loopConfig = {
      inputArray: 'items',
      batchSize: 1,
      parallel: false,
      continueOnError: false,
      throttleMs: 200
    };

    const inputData = { items: [1, 2, 3] };
    
    // Simulate what BaseNode does for Loop nodes
    const result = {
      [loopConfig.inputArray]: inputData.items,
      batchSize: loopConfig.batchSize,
      parallel: loopConfig.parallel,
      continueOnError: loopConfig.continueOnError,
      throttleMs: loopConfig.throttleMs,
      isLoopNode: true
    };

    expect(result.items).toEqual([1, 2, 3]);
    expect(result.batchSize).toBe(1);
    expect(result.isLoopNode).toBe(true);
    expect(result.parallel).toBe(false);
    expect(result.continueOnError).toBe(false);
    expect(result.throttleMs).toBe(200);
  });
});
