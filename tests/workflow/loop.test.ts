import { describe, test, expect } from '@jest/globals';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

describe('Loop node', () => {
  test('ControlFlowExecutor resolves dynamic loop data', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'loop1',
      type: 'Loop',
      category: 'ControlFlow',
      values: {
        array_selector: 'list',
        item_output_field: 'item',
        index_output_field: 'i',
        loop_limit: 2
      }
    } as any;

    const input = { list: [1, 2, 3] };
    const result = await executor.execute(node, input, {});
    expect(result.success).toBe(true);
    expect(result.data.items).toEqual([1, 2]);
    expect(result.data.itemKey).toBe('item');
    expect(result.data.indexKey).toBe('i');
  });
});
