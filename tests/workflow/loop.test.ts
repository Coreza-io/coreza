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
      .send({ inputArray: 'items', items: [1, 2, 3], batchSize: 1 })
      .expect(200);

    expect(res.body.items).toEqual([1, 2, 3]);
    expect(res.body.batchSize).toBe(1);
    expect(res.body.isLoopNode).toBe(true);
  });

  test('ControlFlowExecutor executes Loop node', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'loop1',
      type: 'Loop',
      category: 'ControlFlow',
      values: {
        inputArray: 'items',
        batchSize: 1
      }
    } as any;

    const input = { items: [1, 2, 3] };

    const result = await executor.execute(node, input, {});
    expect(result.success).toBe(true);
    expect(result.data.items).toEqual([1, 2, 3]);
    expect(result.data.batchSize).toBe(1);
    expect(result.data.isLoopNode).toBe(true);
  });
});
