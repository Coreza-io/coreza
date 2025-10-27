import { describe, test, expect } from '@jest/globals';
const express = require('../../coreza-backend/node_modules/express');
import request from 'supertest';
import comparatorRoutes from '../../coreza-backend/src/routes/comparator';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

describe('Math node and API', () => {
  test('POST /comparator/math adds numbers', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: 2, operator: 'add', right: 3 })
      .expect(200);
    expect(res.body).toHaveProperty('result', 5);
  });

  test('ControlFlowExecutor executes Math node', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'math1',
      type: 'Math',
      category: 'ControlFlow',
      values: { left: 4, operator: 'multiply', right: 5 }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data.result).toBe(20);
  });
});
