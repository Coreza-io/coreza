import { describe, test, expect } from '@jest/globals';
import { WorkflowEngine } from '../../coreza-backend/src/services/workflowEngine';
import { INodeExecutorV2, Item, WorkflowNode, NodeExecutionOutput } from '../../coreza-backend/src/nodes/types';
import { LoopExecutorV2 } from '../../coreza-backend/src/nodes/executors/LoopExecutorV2';

type WorkflowEdge = { id: string; source: string; target: string; sourceHandle?: string };

class PassExecutor implements INodeExecutorV2 {
  readonly category = 'passthrough';
  async execute(node: WorkflowNode, params: any, input: Item[]): Promise<NodeExecutionOutput> {
    return { output: input };
  }
}

describe('WorkflowEngine Loop re-queue behaviour', () => {
  test('processes items in batches and emits final result on done handle', async () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'loop1',
        type: 'Loop',
        category: 'control',
        values: { items: [{ v: 1 }, { v: 2 }, { v: 3 }], batchSize: 2, aggregate: true },
      },
      { id: 'final', type: 'noop', category: 'passthrough' },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'e1', source: 'loop1', target: 'final', sourceHandle: 'done' },
    ];
    const engine = new WorkflowEngine('test-run', 'test-workflow', 'test-user', nodes, edges as any);
    engine.registerExecutor('control', new LoopExecutorV2());
    engine.registerExecutor('passthrough', new PassExecutor());

    const result = await engine.execute();

    expect(result.success).toBe(true);
    expect(result.result?.final).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }]);
  });
});
