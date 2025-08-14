import { describe, test, expect } from '@jest/globals';
import { WorkflowEngine } from '../../coreza-backend/src/services/workflowEngine';
import { INodeExecutor, WorkflowNode, NodeResult } from '../../coreza-backend/src/nodes/types';
import { ControlFlowExecutor } from '../../coreza-backend/src/nodes/executors/ControlFlowExecutor';

type WorkflowEdge = { id: string; source: string; target: string; sourceHandle?: string };

// Simple Switch node executor for testing
class MockSwitchExecutor implements INodeExecutor {
  readonly category = 'ControlFlow';
  
  async execute(node: WorkflowNode, input: any, context?: any): Promise<NodeResult> {
    const value = input.value || input;
    console.log('🔀 Mock Switch processing:', value);
    
    if (value > 5) {
      return { success: true, data: 'high' };
    } else {
      return { success: true, data: 'low' };
    }
  }
}

// Simple output collector for testing
class MockCollectorExecutor implements INodeExecutor {
  readonly category = 'Output';
  
  async execute(node: WorkflowNode, input: any): Promise<NodeResult> {
    console.log('📤 Mock Collector received:', input);
    return { success: true, data: input };
  }
}

describe('Simplified Loop Node Implementation', () => {
  test('Loop processes array items through Switch node and aggregates results', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'loop1',
        type: 'Loop',
        category: 'ControlFlow',
        values: { 
          inputArray: 'items',
          batchSize: 1,
          parallel: false,
          continueOnError: true,
          throttleMs: 0
        },
      },
      { 
        id: 'switch1', 
        type: 'Switch', 
        category: 'ControlFlow',
        values: { inputValue: '{{input.value}}' }
      },
      { 
        id: 'final', 
        type: 'Collector', 
        category: 'Output',
        values: {}
      },
    ];
    
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'loop1', target: 'switch1', sourceHandle: 'loop' },
      { id: 'e2', source: 'switch1', target: 'loop1' }, // feedback to loop
      { id: 'e3', source: 'loop1', target: 'final', sourceHandle: 'done' },
    ];

    const engine = new WorkflowEngine('test-run', 'test-workflow', 'test-user', nodes, edges as any);
    engine.registerExecutor('ControlFlow', new ControlFlowExecutor());
    engine.registerExecutor('Output', new MockCollectorExecutor());

    // Start with initial data
    const initialInput = { items: [{ value: 3 }, { value: 7 }, { value: 2 }, { value: 9 }] };
    const result = await engine.execute(initialInput);

    expect(result.success).toBe(true);
    console.log('Final result:', result.result);
    
    // Should have processed all items and collected the results
    expect(result.result?.final).toBeDefined();
    expect(Array.isArray(result.result.final)).toBe(true);
    expect(result.result.final.length).toBe(4); // 4 processed items
  });

  test('Loop handles empty array gracefully', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'loop1',
        type: 'Loop',
        category: 'ControlFlow',
        values: { 
          inputArray: 'items',
          batchSize: 1
        },
      },
    ];
    
    const edges: WorkflowEdge[] = [];

    const engine = new WorkflowEngine('test-run', 'test-workflow', 'test-user', nodes, edges as any);
    engine.registerExecutor('ControlFlow', new ControlFlowExecutor());

    const initialInput = { items: [] };
    const result = await engine.execute(initialInput);

    expect(result.success).toBe(false);
    expect(result.error).toContain('array is empty');
  });

  test('Loop processes batches correctly', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'loop1',
        type: 'Loop',
        category: 'ControlFlow',
        values: { 
          inputArray: 'items',
          batchSize: 2 // Process 2 items at a time
        },
      },
      { 
        id: 'final', 
        type: 'Collector', 
        category: 'Output',
        values: {}
      },
    ];
    
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'loop1', target: 'final', sourceHandle: 'done' },
    ];

    const engine = new WorkflowEngine('test-run', 'test-workflow', 'test-user', nodes, edges as any);
    engine.registerExecutor('ControlFlow', new ControlFlowExecutor());
    engine.registerExecutor('Output', new MockCollectorExecutor());

    const initialInput = { items: [1, 2, 3, 4, 5] };
    const result = await engine.execute(initialInput);

    expect(result.success).toBe(true);
    expect(result.result?.final).toBeDefined();
  });
});