import { describe, test, expect } from '@jest/globals';
const express = require('../../coreza-backend/node_modules/express');
import request from 'supertest';
import comparatorRoutes from '../../coreza-backend/src/routes/comparator';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

describe('Transform node and API', () => {
  test('POST /comparator/transform trims string', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/transform')
      .send({ value: ' hello ', operator: 'trim' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 'hello');
  });

  test('ControlFlowExecutor executes Transform node', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'transform1',
      type: 'Transform',
      category: 'ControlFlow',
      values: { value: 'abc', operator: 'len' }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data.result).toBe(3);
  });

  test('POST /comparator/transform parses key-value string to JSON', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/transform')
      .send({ value: 'ticker:AAPL, RSI:87', operator: 'toJson' })
      .expect(200);
    
    expect(res.body).toHaveProperty('result');
    expect(res.body.result).toEqual({ ticker: 'AAPL', RSI: 87 });
  });

  test('toJson handles curly braces format', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/transform')
      .send({ value: '{ticker:AAPL, RSI:87}', operator: 'toJson' })
      .expect(200);
    
    expect(res.body.result).toEqual({ ticker: 'AAPL', RSI: 87 });
  });
});
