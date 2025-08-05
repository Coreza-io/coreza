import { describe, test, expect } from '@jest/globals';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

describe('Loop node Backend Executor', () => {
  test('ControlFlowExecutor executes Loop node and returns metadata', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'loop1',
      type: 'Loop',
      category: 'ControlFlow',
      values: {
        inputArray: 'items',
        batchSize: 2,
        parallel: true,
        continueOnError: true,
        throttleMs: 100
      }
    } as any;

    const input = { items: [1, 2, 3, 4, 5] };

    const result = await executor.execute(node, input, {});
    
    // Loop executor should return clean metadata only
    expect(result.success).toBe(true);
    expect(result.data.items).toEqual([1, 2, 3, 4, 5]);
    expect(result.data.batchSize).toBe(2);
    expect(result.data.parallel).toBe(true);
    expect(result.data.continueOnError).toBe(true);
    expect(result.data.throttleMs).toBe(100);
    expect(result.data.isLoopNode).toBe(true);
    expect(result.data.totalItems).toBe(5);
  });

  test('ControlFlowExecutor handles missing items gracefully', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'loop1',
      type: 'Loop',
      category: 'ControlFlow',
      values: {
        inputArray: 'nonexistent',
        batchSize: 1
      }
    } as any;

    const input = { otherData: [1, 2, 3] };

    const result = await executor.execute(node, input, {});
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('No array found for field: nonexistent');
  });

  test('ControlFlowExecutor uses default values for missing config', async () => {
    const executor = new ControlFlowExecutor();
    const node = {
      id: 'loop1',
      type: 'Loop',
      category: 'ControlFlow',
      values: {
        inputArray: 'items'
        // Missing batchSize, parallel, continueOnError, throttleMs
      }
    } as any;

    const input = { items: [1, 2, 3] };

    const result = await executor.execute(node, input, {});
    
    expect(result.success).toBe(true);
    expect(result.data.batchSize).toBe(1); // default
    expect(result.data.parallel).toBe(false); // default
    expect(result.data.continueOnError).toBe(false); // default
    expect(result.data.throttleMs).toBe(200); // default
  });
});
