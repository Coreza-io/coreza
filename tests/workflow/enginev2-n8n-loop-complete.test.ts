import { describe, test, expect } from '@jest/globals';
import { WorkflowEngine } from '../../coreza-backend/src/services/workflowEngine';
import { WorkflowNode, WorkflowEdge } from '../../coreza-backend/src/nodes/types';

describe('WorkflowEngine N8N-Level Loop Features', () => {
  test('handles Loop with parallel execution and error recovery', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'start',
        type: 'Input',
        category: 'IO',
        values: { items: [{ id: 1, value: 10 }, { id: 2, value: 20 }, { id: 3, value: 0 }] },
      },
      {
        id: 'loop1',
        type: 'Loop',
        category: 'control',
        values: { 
          batchSize: 1, 
          parallel: true, 
          continueOnError: true,
          throttleMs: 100,
          inputArray: 'items'
        },
      },
      {
        id: 'process',
        type: 'Math',
        category: 'ControlFlow',
        values: { operation: 'divide', value: 5 },
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

    // Register test executors
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
          if (Array.isArray(input)) {
            return input.map((item: any) => {
              // Simulate division by zero error
              if (item.value === 0) {
                throw new Error('Division by zero');
              }
              return { 
                ...item, 
                result: item.value / (node.values?.value || 1),
                processedWithContext: !!item.$loopContext
              };
            });
          }
          return input;
        }
        return input;
      }
    });

    const result = await engine.execute();

    expect(result.success).toBe(true);
    
    // Should have processed valid items and skipped the error item
    const finalOutput = result.result?.output;
    expect(finalOutput).toBeDefined();
    expect(finalOutput.length).toBe(2); // Only 2 items processed (1 failed)
    
    // Check that items were processed with loop context
    expect(finalOutput[0].processedWithContext).toBe(true);
    expect(finalOutput[1].processedWithContext).toBe(true);
    
    // Check results
    expect(finalOutput[0].result).toBe(2); // 10 / 5
    expect(finalOutput[1].result).toBe(4); // 20 / 5
  });

  test('handles conditional branching with If nodes', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'start',
        type: 'Input',
        category: 'IO',
        values: { value: 15 },
      },
      {
        id: 'if1',
        type: 'If',
        category: 'ControlFlow',
        values: { condition: 'value > 10' },
      },
      {
        id: 'true_path',
        type: 'Math',
        category: 'ControlFlow',
        values: { operation: 'multiply', value: 2 },
      },
      {
        id: 'false_path',
        type: 'Math',
        category: 'ControlFlow',
        values: { operation: 'add', value: 5 },
      },
      {
        id: 'output',
        type: 'Output',
        category: 'IO',
      },
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'start', target: 'if1' },
      { id: 'e2', source: 'if1', target: 'true_path', sourceHandle: 'true' },
      { id: 'e3', source: 'if1', target: 'false_path', sourceHandle: 'false' },
      { id: 'e4', source: 'true_path', target: 'output' },
      { id: 'e5', source: 'false_path', target: 'output' },
    ];

    const engine = new WorkflowEngine('test-run', 'test-workflow', 'test-user', nodes, edges);

    // Register test executors
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
          return input.value > 10;
        }
        if (node.type === 'Math') {
          const operation = node.values?.operation;
          const value = node.values?.value || 0;
          if (operation === 'multiply') {
            return { ...input, value: input.value * value };
          } else if (operation === 'add') {
            return { ...input, value: input.value + value };
          }
        }
        return input;
      }
    });

    const result = await engine.execute();

    expect(result.success).toBe(true);
    
    // Should have taken the true path (15 > 10) and multiplied by 2
    expect(result.result?.output?.value).toBe(30); // 15 * 2
  });

  test('handles persistent fields with Edit Fields nodes', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'start',
        type: 'Input',
        category: 'IO',
        values: { counter: 1 },
      },
      {
        id: 'edit1',
        type: 'Edit Fields',
        category: 'ControlFlow',
        values: { 
          persistent: true,
          fields: [
            { left: 'globalCounter', operator: 'set', right: '{{ $getPersistentValue("globalCounter") || 0 + 1 }}' }
          ]
        },
      },
      {
        id: 'output',
        type: 'Output',
        category: 'IO',
      },
    ];

    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'start', target: 'edit1' },
      { id: 'e2', source: 'edit1', target: 'output' },
    ];

    const engine = new WorkflowEngine('test-run', 'test-workflow', 'test-user', nodes, edges);

    // Register test executors with persistent field support
    engine.registerExecutor('IO', {
      execute: async (node: any, input: any) => {
        if (node.type === 'Input') return node.values || input;
        if (node.type === 'Output') return input;
        return input;
      }
    });
    
    engine.registerExecutor('ControlFlow', {
      execute: async (node: any, input: any, context: any) => {
        if (node.type === 'Edit Fields') {
          const fields = node.values?.fields || [];
          const result = { ...input };
          
          for (const field of fields) {
            if (field.left === 'globalCounter') {
              const currentValue = await context.getPersistentValue('globalCounter') || 0;
              const newValue = currentValue + 1;
              await context.setPersistentValue('globalCounter', newValue);
              result[field.left] = newValue;
            }
          }
          
          return result;
        }
        return input;
      }
    });

    const result = await engine.execute();

    expect(result.success).toBe(true);
    expect(result.result?.output?.globalCounter).toBe(1);
  });
});