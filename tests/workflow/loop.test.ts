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
      .send({ array: [1, 2, 3], loop_limit: 2, index_output_field: 'i' })
      .expect(200);

    expect(res.body.items).toEqual([1, 2]);
    expect(res.body.indexKey).toBe('i');
  });

  test('ControlFlowExecutor executes Loop node', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'loop1',
      type: 'Loop',
      category: 'ControlFlow',
      values: {
        array_selector: 'items',
        item_output_field: 'item',
        index_output_field: 'i',
        loop_limit: 2
      }
    } as any;

    const input = { items: [1, 2, 3] };

    const result = await executor.execute(node, input, {});
    expect(result.success).toBe(true);
    expect(result.data.items).toEqual([1, 2]);
    expect(result.data.itemKey).toBe('item');
    expect(result.data.indexKey).toBe('i');
  });
});
