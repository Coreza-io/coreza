import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';
import type { Node, Edge } from '@xyflow/react';
import { handleLoopExecution } from '../../src/utils/loopExecution';
import type { ExecutionContext } from '../../src/utils/workflowExecutor';

function createContext(nodes: Node[], edges: Edge[], exec: jest.Mock): ExecutionContext {
  return {
    nodes,
    edges,
    setNodes: (updater) => {
      const updated = updater(nodes);
      nodes.splice(0, nodes.length, ...updated);
    },
    setEdges: () => {},
    setExecutingNode: () => {},
    toast: () => {},
    executeNode: exec,
  } as ExecutionContext;
}

describe('handleLoopExecution', () => {
  test('processes single item serially', async () => {
    const nodes: Node[] = [
      { id: 'loop', data: {} } as any,
      { id: 'child', data: {} } as any,
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'loop', target: 'child' } as any,
    ];
    const exec = jest.fn(async () => {});
    const ctx = createContext(nodes, edges, exec);

    const input = { items: [1], batchSize: 1, parallel: false, continueOnError: false, throttleMs: 0 };
    await handleLoopExecution(ctx, 'loop', input, edges, new Set());
    expect(exec).toHaveBeenCalledTimes(1);
    expect(nodes.find(n => n.id === 'loop')?.data.loopItems).toBeUndefined();
  });

  test('respects batchSize, parallel and throttle', async () => {
    const nodes: Node[] = [
      { id: 'loop', data: {} } as any,
      { id: 'child', data: {} } as any,
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'loop', target: 'child' } as any,
    ];
    const exec = jest.fn(async () => {});
    const ctx = createContext(nodes, edges, exec);

    const input = { items: [1, 2, 3, 4], batchSize: 2, parallel: true, continueOnError: false, throttleMs: 100 };
    const start = Date.now();
    await handleLoopExecution(ctx, 'loop', input, edges, new Set());
    const duration = Date.now() - start;
    expect(exec).toHaveBeenCalledTimes(4);
    expect(duration).toBeGreaterThanOrEqual(100);
  });

  test('continueOnError skips failures', async () => {
    const nodes: Node[] = [
      { id: 'loop', data: {} } as any,
      { id: 'child', data: {} } as any,
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'loop', target: 'child' } as any,
    ];
    const exec = jest.fn(async () => {});
    exec
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);
    const ctx = createContext(nodes, edges, exec);

    const input = { items: [1, 2, 3], batchSize: 1, parallel: false, continueOnError: true, throttleMs: 0 };
    await handleLoopExecution(ctx, 'loop', input, edges, new Set());
    expect(exec).toHaveBeenCalledTimes(3);
  });
});
