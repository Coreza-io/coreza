import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import type { Node, Edge } from '@xyflow/react';
import ExecutionContext from '../../src/utils/executionContext';
import { handleN8NLoopExecution } from '../../src/utils/handleN8NLoopExecution';

describe('N8N-style Loop Execution', () => {
  let execCtx: ExecutionContext;
  let mockNodes: Node[];
  let mockEdges: Edge[];
  let mockExecuteNode: jest.MockedFunction<(id: string, executed: Set<string>) => Promise<any>>;

  beforeEach(() => {
    execCtx = new ExecutionContext();
    mockExecuteNode = jest.fn() as jest.MockedFunction<(id: string, executed: Set<string>) => Promise<any>>;

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
  });

  test('processes items in batches respecting configuration', async () => {
    const config = {
      items: [1, 2, 3, 4, 5],
      batchSize: 2,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];

    await handleN8NLoopExecution(
      execCtx,
      { nodes: mockNodes, edges: mockEdges },
      'loop1',
      config,
      outgoingEdges,
      new Set(),
      mockExecuteNode
    );

    expect(mockExecuteNode).toHaveBeenCalledTimes(10); // 2 nodes * 5 items
    const loopData = execCtx.getNodeData('loop1');
    expect(loopData.loopItems).toBeUndefined();
    expect(loopData.loopIndex).toBeUndefined();
  });

  test('handles parallel execution', async () => {
    const config = {
      items: [1, 2, 3],
      batchSize: 3,
      parallel: true,
      continueOnError: false,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];

    await handleN8NLoopExecution(
      execCtx,
      { nodes: mockNodes, edges: mockEdges },
      'loop1',
      config,
      outgoingEdges,
      new Set(),
      mockExecuteNode
    );

    expect(mockExecuteNode).toHaveBeenCalledTimes(6); // 2 nodes * 3 items
  });

  test('continues on error when continueOnError is true', async () => {
    mockExecuteNode
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Test error'))
      .mockResolvedValue(undefined);

    const config = {
      items: [1, 2, 3],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];

    await expect(
      handleN8NLoopExecution(
        execCtx,
        { nodes: mockNodes, edges: mockEdges },
        'loop1',
        config,
        outgoingEdges,
        new Set(),
        mockExecuteNode
      )
    ).resolves.toBeUndefined();
  });

  test('stops on error when continueOnError is false', async () => {
    mockExecuteNode
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Test error'));

    const config = {
      items: [1, 2, 3],
      batchSize: 1,
      parallel: false,
      continueOnError: false,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];

    await expect(
      handleN8NLoopExecution(
        execCtx,
        { nodes: mockNodes, edges: mockEdges },
        'loop1',
        config,
        outgoingEdges,
        new Set(),
        mockExecuteNode
      )
    ).rejects.toThrow('Test error');
  });

  test('cleans up loop node state after completion', async () => {
    const config = {
      items: [1],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];

    await handleN8NLoopExecution(
      execCtx,
      { nodes: mockNodes, edges: mockEdges },
      'loop1',
      config,
      outgoingEdges,
      new Set(),
      mockExecuteNode
    );

    const loopData = execCtx.getNodeData('loop1');
    expect(loopData.loopItems).toBeUndefined();
    expect(loopData.loopIndex).toBeUndefined();
    expect(loopData.loopItem).toBeUndefined();
    expect(loopData.output).toBeUndefined();
  });

  test('handles empty items array gracefully', async () => {
    const config = {
      items: [],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];

    await handleN8NLoopExecution(
      execCtx,
      { nodes: mockNodes, edges: mockEdges },
      'loop1',
      config,
      outgoingEdges,
      new Set(),
      mockExecuteNode
    );

    expect(mockExecuteNode).not.toHaveBeenCalled();
  });
});
