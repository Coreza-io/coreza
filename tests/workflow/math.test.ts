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

describe('Math node statistical operations', () => {
  test('POST /comparator/math calculates average', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: [10, 20, 30, 40, 50], operator: 'avg' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 30);
  });

  test('POST /comparator/math calculates sum', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: [5, 10, 15], operator: 'sum' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 30);
  });

  test('POST /comparator/math finds max', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: [3, 7, 2, 9, 1], operator: 'max' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 9);
  });

  test('POST /comparator/math finds min', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: [3, 7, 2, 9, 1], operator: 'min' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 1);
  });

  test('POST /comparator/math parses JSON array string', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: '[100, 200, 300]', operator: 'avg' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 200);
  });

  test('POST /comparator/math counts array elements', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: [1, 2, 3, 4, 5, 6, 7], operator: 'count' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 7);
  });

  test('POST /comparator/math calculates median odd length', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: [1, 2, 3, 4, 5], operator: 'median' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 3);
  });

  test('POST /comparator/math calculates median even length', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: [1, 2, 3, 4], operator: 'median' })
      .expect(200);
    expect(res.body).toHaveProperty('result', 2.5);
  });

  test('ControlFlowExecutor executes Math node with avg', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'math1',
      type: 'Math',
      category: 'ControlFlow',
      values: { left: [10, 20, 30], operator: 'avg' }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data.result).toBe(20);
  });

  test('ControlFlowExecutor executes Math node with std', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'math1',
      type: 'Math',
      category: 'ControlFlow',
      values: { left: [2, 4, 4, 4, 5, 5, 7, 9], operator: 'std' }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data.result).toBeCloseTo(2, 0);
  });
});
