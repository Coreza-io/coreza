import { describe, test, expect } from '@jest/globals';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

describe('Loop node', () => {
  test('ControlFlowExecutor executes Loop node', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'loop1',
      type: 'Loop',
      category: 'ControlFlow',
      values: { iterations: 3 }
    } as any;

    const result = await executor.execute(node, {}, {});
    expect(result.success).toBe(true);
    expect(result.data.iterations).toBe(3);
  });
});
