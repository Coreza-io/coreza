import { describe, test, expect } from '@jest/globals';
import { WorkflowEngine } from '../../coreza-backend/src/services/workflowEngine';
import { WorkflowNode, WorkflowEdge } from '../../coreza-backend/src/nodes/types';

describe('WorkflowEngine Single Queue Loop Logic', () => {
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

    const engine = new WorkflowEngine('test-run', 'test-workflow', 'test-user', nodes, edges);

    // Register custom test executors
    engine.registerExecutor('IO', {
      execute: async (node: any, input: any) => {
        if (node.type === 'Input') return node.values?.items || input;
        if (node.type === 'Output') return input;
        return input;
      }
    });
    
    engine.registerExecutor('ControlFlow', {
      execute: async (node: any, input: any) => {
        if (node.type === 'Math') {
          const value = node.values?.value || 2;
          if (Array.isArray(input)) {
            return input.map((item: any) => ({ ...item, v: item.v * value }));
          }
          return { ...input, v: input.v * value };
        }
        return input;
      }
    });

    const result = await engine.execute();

    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    
    // Check that output node received aggregated results
    expect(result.result?.output).toEqual([
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

    const engine = new WorkflowEngine('test-run', 'test-workflow', 'test-user', nodes, edges);

    // Register custom test executors
    engine.registerExecutor('IO', {
      execute: async (node: any, input: any) => {
        if (node.type === 'Input') return node.values || input;
        if (node.type === 'Output') return input;
        return input;
      }
    });
    
    engine.registerExecutor('ControlFlow', {
      execute: async (node: any, input: any) => {
        if (node.type === 'If') {
          // Simple condition evaluation - return boolean for router
          return input.value > 3; // returns true, should fire 'true' edge only
        }
        return input;
      }
    });

    const result = await engine.execute();

    expect(result.success).toBe(true);
    
    // Only true_path should have been executed
    expect(result.result?.true_path).toBeDefined();
    expect(result.result?.false_path).toBeUndefined();
  });
});