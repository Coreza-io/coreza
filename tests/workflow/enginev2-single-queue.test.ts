import { describe, test, expect } from '@jest/globals';
import { WorkflowEngineV2 } from '../../coreza-backend/src/services/workflowEngineV2';
import { WorkflowNode, WorkflowEdge } from '../../coreza-backend/src/nodes/types';

describe('WorkflowEngineV2 Single Queue Loop Logic', () => {
  test('processes Loop with single queue and edge buffer aggregation', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'start',
        type: 'Input',
        category: 'IO',
        values: { items: [{ v: 1 }, { v: 2 }, { v: 3 }] },
      },
      {
        id: 'loop1',
        type: 'Loop',
        category: 'ControlFlow',
        values: { batchSize: 1 },
      },
      {
        id: 'process',
        type: 'Math',
        category: 'ControlFlow', 
        values: { operation: 'multiply', value: 2 },
      },
      {
        id: 'output',
        type: 'Output',
        category: 'IO',
      },
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'start', target: 'loop1' },
      { id: 'e2', source: 'loop1', target: 'process', sourceHandle: 'loop' },
      { id: 'e3', source: 'process', target: 'loop1' }, // feedback edge
      { id: 'e4', source: 'loop1', target: 'output', sourceHandle: 'done' },
    ];

    const engine = new WorkflowEngineV2('test-run', 'test-workflow', 'test-user', nodes, edges);

    // Mock implementations for testing
    engine['impls']['Input'] = async (input: any) => input.items || input;
    engine['impls']['Math'] = async (input: any) => {
      const value = input.value || 2;
      if (Array.isArray(input)) {
        return input.map((item: any) => ({ ...item, v: item.v * value }));
      }
      return { ...input, v: input.v * value };
    };
    engine['impls']['Output'] = async (input: any) => input;

    const result = await engine.run(['start']);

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    
    // Check that output node received aggregated results
    const outputResult = engine.getNodeResult('output');
    expect(outputResult).toEqual([
      { v: 2 }, // 1 * 2
      { v: 4 }, // 2 * 2  
      { v: 6 }, // 3 * 2
    ]);
  });

  test('handles branch nodes with edge-specific routing', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'start',
        type: 'Input',
        category: 'IO',
        values: { value: 5 },
      },
      {
        id: 'if1',
        type: 'If',
        category: 'ControlFlow',
        values: { condition: '{{value}} > 3' },
      },
      {
        id: 'true_path',
        type: 'Output',
        category: 'IO',
      },
      {
        id: 'false_path',
        type: 'Output', 
        category: 'IO',
      },
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'start', target: 'if1' },
      { id: 'e2', source: 'if1', target: 'true_path', sourceHandle: 'true' },
      { id: 'e3', source: 'if1', target: 'false_path', sourceHandle: 'false' },
    ];

    const engine = new WorkflowEngineV2('test-run', 'test-workflow', 'test-user', nodes, edges);

    // Mock implementations
    engine['impls']['Input'] = async (input: any) => input;
    engine['impls']['If'] = async (input: any) => {
      // Simple condition evaluation
      return input.value > 3; // returns true, should fire 'true' edge only
    };
    engine['impls']['Output'] = async (input: any) => input;

    const result = await engine.run(['start']);

    expect(result.success).toBe(true);
    
    // Only true_path should have been executed
    expect(engine.getNodeResult('true_path')).toBeDefined();
    expect(engine.getNodeResult('false_path')).toBeUndefined();
  });
});