import { describe, test, expect } from '@jest/globals';
const express = require('../../coreza-backend/node_modules/express');
import request from 'supertest';
import comparatorRoutes from '../../coreza-backend/src/routes/comparator';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

describe('Math operations via Transform', () => {
  test('POST /comparator/math adds numbers', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/math')
      .send({ left: 2, operator: 'add', right: 3 })
      .expect(200);
    expect(res.body.data).toBe(5);
  });

  test('POST /comparator/transform calculates average', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/transform')
      .send({ value: [10, 20, 30, 40, 50], operator: 'avg' })
      .expect(200);
    expect(res.body.data).toBe(30);
  });

  test('POST /comparator/transform calculates sum', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/transform')
      .send({ value: [5, 10, 15], operator: 'sum' })
      .expect(200);
    expect(res.body.data).toBe(30);
  });

  test('POST /comparator/transform finds max', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/transform')
      .send({ value: [3, 7, 2, 9, 1], operator: 'max' })
      .expect(200);
    expect(res.body.data).toBe(9);
  });

  test('POST /comparator/transform calculates median', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/transform')
      .send({ value: [1, 2, 3, 4, 5], operator: 'median' })
      .expect(200);
    expect(res.body.data).toBe(3);
  });

  test('ControlFlowExecutor executes Transform node with avg', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'transform1',
      name: 'Transform',
      type: 'Transform',
      category: 'ControlFlow',
      values: { value: [10, 20, 30], operator: 'avg' }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data).toBe(20);
  });
});
