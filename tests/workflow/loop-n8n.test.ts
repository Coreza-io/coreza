import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { handleN8NLoopExecution } from '../../src/utils/handleN8NLoopExecution';
import ExecutionContext from '../../src/utils/executionContext';
import type { Node, Edge } from '@xyflow/react';

describe('N8N-style Loop Execution', () => {
  let execution: ExecutionContext;
  let mockNodes: Node[];
  let mockEdges: Edge[];
  let mockExecuteNode: jest.MockedFunction<(id: string, executed: Set<string>) => Promise<any>>;

  beforeEach(() => {
    mockExecuteNode = jest.fn(async (_id: string, _set: Set<string>) => undefined) as jest.MockedFunction<(id: string, executed: Set<string>) => Promise<any>>;

    mockNodes = [
      {
        id: 'loop1',
        type: 'Loop',
        position: { x: 0, y: 0 },
        data: { definition: { name: 'Loop' } }
      },
      {
        id: 'node1',
        type: 'default',
        position: { x: 100, y: 0 },
        data: {}
      },
      {
        id: 'node2',
        type: 'default',
        position: { x: 200, y: 0 },
        data: {}
      }
    ];

    mockEdges = [
      { id: 'e1', source: 'loop1', target: 'node1' },
      { id: 'e2', source: 'node1', target: 'node2' }
    ];

    execution = new ExecutionContext();
  });

  test('should process items in batches with correct configuration', async () => {
    const loopConfig = {
      items: [1, 2, 3, 4, 5],
      batchSize: 2,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' } as Edge];
    const globalExecuted = new Set<string>();

    await handleN8NLoopExecution(
      execution,
      { nodes: mockNodes, edges: mockEdges },
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted,
      mockExecuteNode
    );

    expect(mockExecuteNode).toHaveBeenCalledTimes(10); // 2 nodes * 5 items
  });

  test('should handle parallel execution correctly', async () => {
    const loopConfig = {
      items: [1, 2, 3],
      batchSize: 3,
      parallel: true,
      continueOnError: false,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' } as Edge];
    const globalExecuted = new Set<string>();

    await handleN8NLoopExecution(
      execution,
      { nodes: mockNodes, edges: mockEdges },
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted,
      mockExecuteNode
    );

    expect(mockExecuteNode).toHaveBeenCalledTimes(6); // 2 nodes * 3 items
  });

  test('should continue on error when continueOnError is true', async () => {
    mockExecuteNode
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Test error'))
      .mockResolvedValue(undefined);

    const loopConfig = {
      items: [1, 2, 3],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' } as Edge];
    const globalExecuted = new Set<string>();

    await expect(
      handleN8NLoopExecution(
        execution,
        { nodes: mockNodes, edges: mockEdges },
        'loop1',
        loopConfig,
        outgoingEdges,
        globalExecuted,
        mockExecuteNode
      )
    ).resolves.toBeUndefined();
  });

  test('should stop on error when continueOnError is false', async () => {
    mockExecuteNode
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Test error'));

    const loopConfig = {
      items: [1, 2, 3],
      batchSize: 1,
      parallel: false,
      continueOnError: false,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' } as Edge];
    const globalExecuted = new Set<string>();

    await expect(
      handleN8NLoopExecution(
        execution,
        { nodes: mockNodes, edges: mockEdges },
        'loop1',
        loopConfig,
        outgoingEdges,
        globalExecuted,
        mockExecuteNode
      )
    ).rejects.toThrow('Test error');
  });

  test('should clean up loop node state after completion', async () => {
    const loopConfig = {
      items: [1],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' } as Edge];
    const globalExecuted = new Set<string>();

    await handleN8NLoopExecution(
      execution,
      { nodes: mockNodes, edges: mockEdges },
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted,
      mockExecuteNode
    );

    expect(execution.getNodeData('loop1')).toEqual({
      loopItems: undefined,
      loopIndex: undefined,
      loopItem: undefined,
      output: undefined,
    });
  });

  test('should handle empty items array gracefully', async () => {
    const loopConfig = {
      items: [],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' } as Edge];
    const globalExecuted = new Set<string>();

    await handleN8NLoopExecution(
      execution,
      { nodes: mockNodes, edges: mockEdges },
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted,
      mockExecuteNode
    );

    expect(mockExecuteNode).not.toHaveBeenCalled();
  });
});
