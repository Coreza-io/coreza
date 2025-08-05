import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { handleN8NLoopExecution } from '../../src/utils/handleN8NLoopExecution';
import type { ExecutionContext } from '../../src/utils/workflowExecutor';
import type { Node, Edge } from '@xyflow/react';

// Mock the sleep function to make tests faster
jest.mock('../../src/utils/handleN8NLoopExecution', () => {
  const originalModule = jest.requireActual('../../src/utils/handleN8NLoopExecution');
  return {
    ...originalModule,
    // Override sleep to be instant in tests
    __esModule: true,
    handleN8NLoopExecution: jest.fn()
  };
});

describe('N8N-style Loop Execution', () => {
  let mockContext: ExecutionContext;
  let mockNodes: Node[];
  let mockEdges: Edge[];
  let mockSetNodes: jest.Mock;
  let mockExecuteNode: jest.Mock;

  beforeEach(() => {
    mockSetNodes = jest.fn();
    mockExecuteNode = jest.fn();
    
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

    mockContext = {
      nodes: mockNodes,
      edges: mockEdges,
      setNodes: mockSetNodes,
      setEdges: jest.fn(),
      setExecutingNode: jest.fn(),
      executeNode: mockExecuteNode,
      toast: jest.fn()
    };
  });

  test('should process items in batches with correct configuration', async () => {
    const loopConfig = {
      items: [1, 2, 3, 4, 5],
      batchSize: 2,
      parallel: false,
      continueOnError: true,
      throttleMs: 0 // Disable throttling for tests
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];
    const globalExecuted = new Set<string>();

    // Use the real implementation for this test
    const { handleN8NLoopExecution: realHandleN8NLoopExecution } = jest.requireActual('../../src/utils/handleN8NLoopExecution');
    
    await realHandleN8NLoopExecution(
      mockContext,
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted
    );

    // Should have called setNodes to set loop context for each item
    expect(mockSetNodes).toHaveBeenCalledTimes(6); // 5 items + 1 cleanup
    
    // Should have executed downstream nodes for each item
    expect(mockExecuteNode).toHaveBeenCalledTimes(10); // 2 nodes * 5 items
  });

  test('should handle parallel execution correctly', async () => {
    const loopConfig = {
      items: [1, 2, 3],
      batchSize: 3, // Process all in one batch
      parallel: true,
      continueOnError: false,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];
    const globalExecuted = new Set<string>();

    const { handleN8NLoopExecution: realHandleN8NLoopExecution } = jest.requireActual('../../src/utils/handleN8NLoopExecution');
    
    await realHandleN8NLoopExecution(
      mockContext,
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted
    );

    // Should process all items
    expect(mockExecuteNode).toHaveBeenCalledTimes(6); // 2 nodes * 3 items
  });

  test('should continue on error when continueOnError is true', async () => {
    // Mock executeNode to fail on the second call
    mockExecuteNode
      .mockResolvedValueOnce(undefined) // First call succeeds
      .mockRejectedValueOnce(new Error('Test error')) // Second call fails
      .mockResolvedValue(undefined); // Remaining calls succeed

    const loopConfig = {
      items: [1, 2, 3],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];
    const globalExecuted = new Set<string>();

    const { handleN8NLoopExecution: realHandleN8NLoopExecution } = jest.requireActual('../../src/utils/handleN8NLoopExecution');
    
    // Should not throw error despite failure
    await expect(realHandleN8NLoopExecution(
      mockContext,
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted
    )).resolves.toBeUndefined();
  });

  test('should stop on error when continueOnError is false', async () => {
    // Mock executeNode to fail on the second iteration
    mockExecuteNode
      .mockResolvedValueOnce(undefined) // First iteration succeeds
      .mockResolvedValueOnce(undefined) // First node of first item
      .mockRejectedValueOnce(new Error('Test error')); // Second iteration fails

    const loopConfig = {
      items: [1, 2, 3],
      batchSize: 1,
      parallel: false,
      continueOnError: false,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];
    const globalExecuted = new Set<string>();

    const { handleN8NLoopExecution: realHandleN8NLoopExecution } = jest.requireActual('../../src/utils/handleN8NLoopExecution');
    
    // Should throw error and stop processing
    await expect(realHandleN8NLoopExecution(
      mockContext,
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted
    )).rejects.toThrow('Test error');
  });

  test('should clean up loop node state after completion', async () => {
    const loopConfig = {
      items: [1],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];
    const globalExecuted = new Set<string>();

    const { handleN8NLoopExecution: realHandleN8NLoopExecution } = jest.requireActual('../../src/utils/handleN8NLoopExecution');
    
    await realHandleN8NLoopExecution(
      mockContext,
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted
    );

    // Check that the final call to setNodes cleans up loop state
    const lastCall = mockSetNodes.mock.calls[mockSetNodes.mock.calls.length - 1];
    const lastUpdateFunction = lastCall[0];
    
    // Apply the function to see what it would do to nodes
    const updatedNodes = lastUpdateFunction(mockNodes);
    const loopNode = updatedNodes.find(n => n.id === 'loop1');
    
    expect(loopNode?.data?.loopItems).toBeUndefined();
    expect(loopNode?.data?.loopIndex).toBeUndefined();
    expect(loopNode?.data?.loopItem).toBeUndefined();
    expect(loopNode?.data?.output).toBeUndefined();
  });

  test('should handle empty items array gracefully', async () => {
    const loopConfig = {
      items: [],
      batchSize: 1,
      parallel: false,
      continueOnError: true,
      throttleMs: 0
    };

    const outgoingEdges = [{ id: 'e1', source: 'loop1', target: 'node1' }];
    const globalExecuted = new Set<string>();

    const { handleN8NLoopExecution: realHandleN8NLoopExecution } = jest.requireActual('../../src/utils/handleN8NLoopExecution');
    
    await realHandleN8NLoopExecution(
      mockContext,
      'loop1',
      loopConfig,
      outgoingEdges,
      globalExecuted
    );

    // Should only call setNodes for cleanup
    expect(mockSetNodes).toHaveBeenCalledTimes(1);
    expect(mockExecuteNode).not.toHaveBeenCalled();
  });
});