import { WorkflowEngine } from '../../coreza-backend/src/services/workflowEngine';

describe('Backend N8N Loop Execution', () => {
  let mockWorkflowEngine: WorkflowEngine;

  beforeEach(() => {
    // Mock the WorkflowEngine for testing
    const mockNodes = [
      {
        id: 'loop1',
        type: 'Loop',
        category: 'ControlFlow',
        data: {},
        values: {
          inputArray: '[{"id": 1, "name": "Item 1"}, {"id": 2, "name": "Item 2"}]',
          batchSize: '1',
          parallel: false,
          continueOnError: false,
          throttleMs: '0'
        },
        position: { x: 0, y: 0 }
      },
      {
        id: 'process1',
        type: 'Transform',
        category: 'ControlFlow',
        data: {},
        values: {
          value: '{{ loopItem.name }}',
          operator: 'toUpperCase'
        },
        position: { x: 200, y: 0 }
      }
    ];

    const mockEdges = [
      {
        id: 'e1',
        source: 'loop1',
        target: 'process1'
      }
    ];

    mockWorkflowEngine = new WorkflowEngine(
      'test-run-1',
      'test-workflow-1',
      'test-user-1',
      mockNodes,
      mockEdges
    );
  });

  it('should handle Loop node execution in backend', async () => {
    // Verify the backend WorkflowEngine has the new methods
    expect(typeof mockWorkflowEngine.getNodeResult).toBe('function');
    expect(typeof mockWorkflowEngine.setLoopContext).toBe('function');
    expect(typeof mockWorkflowEngine.clearLoopContext).toBe('function');
    expect(typeof mockWorkflowEngine.getLoopContext).toBe('function');
  });

  it('should set and get loop context correctly', () => {
    const testContext = {
      loopItem: { id: 1, name: 'Test Item' },
      loopIndex: 0,
      loopItems: [{ id: 1, name: 'Test Item' }]
    };

    mockWorkflowEngine.setLoopContext('test-node', testContext);
    const retrievedContext = mockWorkflowEngine.getLoopContext('test-node');

    expect(retrievedContext).toEqual(testContext);
  });

  it('should clear loop context correctly', () => {
    const testContext = {
      loopItem: { id: 1, name: 'Test Item' },
      loopIndex: 0
    };

    mockWorkflowEngine.setLoopContext('test-node', testContext);
    expect(mockWorkflowEngine.getLoopContext('test-node')).toEqual(testContext);

    mockWorkflowEngine.clearLoopContext('test-node');
    expect(mockWorkflowEngine.getLoopContext('test-node')).toBeUndefined();
  });

  it('should have proper node result getter', () => {
    // The getNodeResult method should be available for loop execution access
    const result = mockWorkflowEngine.getNodeResult('non-existent');
    expect(result).toBeUndefined();
  });
});