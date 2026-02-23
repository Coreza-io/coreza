import { describe, test, expect } from '@jest/globals';
const express = require('../../coreza-backend/node_modules/express');
import request from 'supertest';
import comparatorRoutes from '../../coreza-backend/src/routes/comparator';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

describe('Compute node and API', () => {
  test('POST /comparator/compute trims string', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: ' hello ', operator: 'trim' })
      .expect(200);
    expect(res.body).toHaveProperty('data', 'hello');
  });

  test('ControlFlowExecutor executes Compute node', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'compute1',
      type: 'Compute',
      name: 'Compute',
      category: 'ControlFlow',
      values: { value: 'abc', operator: 'len' }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data).toBe(3);
  });

  test('POST /comparator/compute parses key-value string to JSON', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: 'ticker:AAPL, RSI:87', operator: 'toJson' })
      .expect(200);
    
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toEqual({ ticker: 'AAPL', RSI: 87 });
  });

  test('toJson handles curly braces format', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: '{ticker:AAPL, RSI:87}', operator: 'toJson' })
      .expect(200);
    
    expect(res.body.data).toEqual({ ticker: 'AAPL', RSI: 87 });
  });

  test('POST /comparator/compute calculates average', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: [10, 20, 30, 40, 50], operator: 'avg' })
      .expect(200);
    expect(res.body.data).toBe(30);
  });

  test('POST /comparator/compute calculates sum', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: [5, 10, 15], operator: 'sum' })
      .expect(200);
    expect(res.body.data).toBe(30);
  });

  test('POST /comparator/compute finds max', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: [3, 7, 2, 9, 1], operator: 'max' })
      .expect(200);
    expect(res.body.data).toBe(9);
  });

  test('POST /comparator/compute calculates median', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({ value: [1, 2, 3, 4, 5], operator: 'median' })
      .expect(200);
    expect(res.body.data).toBe(3);
  });


  test('POST /comparator/compute maps array with split', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({
        value: ['2024-11-13T18:27:00Z', '2024-11-13T18:29:00Z', '2024-11-13T18:40:00Z'],
        operator: 'map',
        mapSubOperation: 'split',
        arg2: 'T',
        mapIndex: '0'
      })
      .expect(200);

    expect(res.body.data).toEqual(['2024-11-13', '2024-11-13', '2024-11-13']);
  });

  test('POST /comparator/compute maps array with upper', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({
        value: ['hello', 'world'],
        operator: 'map',
        mapSubOperation: 'upper'
      })
      .expect(200);

    expect(res.body.data).toEqual(['HELLO', 'WORLD']);
  });

  test('POST /comparator/compute maps array with getProperty', async () => {
    const app = express();
    app.use(express.json());
    app.use('/comparator', comparatorRoutes);

    const res = await request(app)
      .post('/comparator/compute')
      .send({
        value: [{ name: 'Alice', age: 30 }, { name: 'Bob', age: 25 }],
        operator: 'map',
        mapSubOperation: 'getProperty',
        arg2: 'name'
      })
      .expect(200);

    expect(res.body.data).toEqual(['Alice', 'Bob']);
  });

  test('ControlFlowExecutor executes Compute node with avg', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'compute1',
      name: 'Compute',
      type: 'Compute',
      category: 'ControlFlow',
      values: { value: [10, 20, 30], operator: 'avg' }
    } as any;
    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data).toBe(20);
  });
});
